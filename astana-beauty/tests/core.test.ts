import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { settings, localDate, dateLabel, money } from "../src/shared";
import {
  selectedProcedures,
  candidateSlots,
  occupiedSegments,
  availableSlots,
  zonedEpoch,
  AppError,
} from "../worker/schedule";
import { createBooking, cancelBooking, findBooking } from "../worker/bookings";
import { processNotifications } from "../worker/notifications";
import { handleTelegram } from "../worker/telegram";
import worker from "../worker/index";
import { sign } from "../worker/security";
import type { Env } from "../worker/types";

// Реальная SQLite с теми же SQL и транзакциями, что D1; внешние API заменены.
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("drizzle")
    .filter((x) => x.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(`drizzle/${name}`, "utf8"));
  class Statement {
    args: unknown[] = [];
    constructor(public sql: string) {}
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    }
    async first() {
      return sqlite.prepare(this.sql).get(...(this.args as any[])) || null;
    }
    async all() {
      return { results: sqlite.prepare(this.sql).all(...(this.args as any[])) };
    }
    async run() {
      const result = sqlite.prepare(this.sql).run(...(this.args as any[]));
      return { success: true, meta: { changes: Number(result.changes) } };
    }
  }
  return {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = [];
        for (const s of statements)
          result.push(sqlite.prepare(s.sql).run(...(s.args as any[])));
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
function environment(): Env {
  return {
    DB: database(),
    ASSETS: {} as Fetcher,
    BOOKING_ENABLED: "true",
    NOTIFICATIONS_ENABLED: "false",
    WHATSAPP_ENABLED: "true",
    SESSION_SECRET: "s".repeat(40),
    ADMIN_PASSWORD: "p".repeat(20),
    TELEGRAM_WEBHOOK_SECRET: "t".repeat(40),
    TELEGRAM_BOT_TOKEN: "test",
    TELEGRAM_CHAT_ID: "123",
    TELEGRAM_OWNER_ID: "123",
    TWILIO_ACCOUNT_SID: "ACtest",
    TWILIO_AUTH_TOKEN: "twilio-token",
    TWILIO_WHATSAPP_FROM: "whatsapp:+77000000000",
    TWILIO_REMINDER_RU: "HXreminder",
    TWILIO_CANCEL_RU: "HXcancel",
  };
}
function futureSlot(duration = 60) {
  for (let days = 1; days <= 10; days++) {
    const date = localDate(Date.now() + days * 86400000);
    const result = candidateSlots(date, duration);
    if (result.length) return result[0];
  }
  throw new Error("no_future_slot");
}
const request = () =>
  new Request("https://example.com/api/bookings", {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "cf-connecting-ip": crypto.randomUUID(),
    },
  });
const payload = (start: number, token = "a".repeat(64)) => ({
  name: "Тестовый клиент",
  phone: "+77011234567",
  lang: "ru",
  start,
  procedureIds: ["ultrasound"],
  consent: true,
  whatsappConsent: true,
  website: "",
  token,
});

test("Asia/Almaty conversion, holidays, lunch, preparation buffer", () => {
  assert.equal(
    new Date(zonedEpoch("2026-10-02", "10:00")).toISOString(),
    "2026-10-02T05:00:00.000Z",
  );
  assert.equal(
    candidateSlots("2027-01-01", 60, zonedEpoch("2026-12-31", "10:00")).length,
    0,
  );
  const times = candidateSlots(
    "2026-10-02",
    60,
    zonedEpoch("2026-10-01", "10:00"),
  );
  assert(!times.includes(zonedEpoch("2026-10-02", "12:00"))); // визит + уборка пересекают обед
  assert(times.includes(zonedEpoch("2026-10-02", "11:45")));
  assert.equal(occupiedSegments(times[0], 60).length, 5);
});
test("RU and KZ dates use translated months and Astana time, independent of locale support", () => {
  const at = zonedEpoch("2026-10-03", "10:00");
  assert.equal(dateLabel(at, "ru"), "3 октября 2026 г., 10:00");
  assert.equal(dateLabel(at, "kk"), "2026 жылғы 3 қазан, 10:00");
  assert.equal(money(27000, "ru"), money(27000, "kk"));
});
test("server rejects duplicate, disabled and invented procedure IDs", () => {
  for (const ids of [
    ["ultrasound", "ultrasound"],
    ["fake"],
    ["biorevitalization"],
    [],
  ])
    assert.throws(() => selectedProcedures(ids), AppError);
  assert.throws(
    () =>
      selectedProcedures(["combined", "ultrasound", "hydration", "massage"]),
    /tooLong/,
  );
});
test("database collision rolls back the entire second booking; retry is idempotent", async () => {
  const env = environment(),
    start = futureSlot();
  const b = await createBooking(env, request(), payload(start));
  await assert.rejects(
    createBooking(env, request(), payload(start + 15 * 60000, "b".repeat(64))),
    /busy/,
  );
  assert.equal(
    (
      await env.DB.prepare("SELECT count(*) AS n FROM bookings").first<{
        n: number;
      }>()
    )?.n,
    1,
  );
  const repeated = await createBooking(env, request(), payload(start));
  assert.equal(repeated.id, b.id);
  assert.equal(
    (
      await env.DB.prepare("SELECT count(*) AS n FROM notifications").first<{
        n: number;
      }>()
    )?.n,
    2,
  );
  const occupied = await env.DB.prepare("SELECT start_at FROM occupancy").all<{
    start_at: number;
  }>();
  const slots = availableSlots(
    localDate(start),
    60,
    new Set(occupied.results.map((x) => x.start_at)),
  );
  assert.equal(slots.find((x) => x.start === start)?.available, false);
});
test("cancellation frees all segments and is idempotent", async () => {
  const env = environment(),
    start = futureSlot();
  const b = await createBooking(env, request(), payload(start));
  assert.equal((await cancelBooking(env, b.id)).status, "cancelled");
  assert.equal(
    (
      await env.DB.prepare("SELECT count(*) AS n FROM occupancy").first<{
        n: number;
      }>()
    )?.n,
    0,
  );
  await cancelBooking(env, b.id);
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT count(*) AS n FROM notifications WHERE kind='cancel'",
      ).first<{ n: number }>()
    )?.n,
    1,
  );
  await createBooking(env, request(), payload(start, "c".repeat(64)));
});
test("simultaneous overlapping requests produce exactly one booking", async () => {
  const env = environment(),
    start = futureSlot();
  const result = await Promise.allSettled([
    createBooking(env, request(), payload(start)),
    createBooking(env, request(), payload(start, "b".repeat(64))),
  ]);
  assert.equal(result.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    (
      await env.DB.prepare("SELECT count(*) AS n FROM bookings").first<{
        n: number;
      }>()
    )?.n,
    1,
  );
});
test("late booking queues reminder immediately and cron sends it once", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  const b = await createBooking(env, request(), payload(futureSlot()));
  await env.DB.prepare("UPDATE bookings SET start_at=? WHERE id=?")
    .bind(Date.now() + 2 * 3600000, b.id)
    .run();
  await env.DB.prepare(
    "UPDATE notifications SET due_at=? WHERE kind='reminder'",
  )
    .bind(Date.now() - 1)
    .run();
  let calls = 0;
  const mock = (async (url: any) => {
    if (String(url).includes("twilio.com")) calls++;
    return new Response(
      JSON.stringify(
        String(url).includes("telegram.org")
          ? { ok: true, result: { message_id: 1 } }
          : { sid: "SMonce" },
      ),
      { status: 201 },
    );
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  await processNotifications(env, "https://example.com", mock);
  assert.equal(calls, 1);
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT status FROM notifications WHERE kind='reminder'",
      ).first<{ status: string }>()
    )?.status,
    "sent",
  );
});
test("cancelled booking has no reminder, but receives one cancellation message", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  const b = await createBooking(env, request(), payload(futureSlot()));
  await cancelBooking(env, b.id);
  await env.DB.prepare("UPDATE notifications SET due_at=0").run();
  const contents: string[] = [];
  const mock = (async (_url: any, init: any) => {
    contents.push(String(init.body));
    return new Response(JSON.stringify({ sid: "SMcancel" }), { status: 201 });
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  await processNotifications(env, "https://example.com", mock);
  assert.equal(contents.length, 1);
  assert(contents[0].includes("HXcancel"));
});
test("unknown provider response is quarantined, never retried", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  const b = await createBooking(env, request(), payload(futureSlot()));
  await env.DB.prepare(
    "UPDATE notifications SET status='sent' WHERE kind='telegram'",
  ).run();
  await env.DB.prepare(
    "UPDATE notifications SET due_at=0 WHERE kind='reminder'",
  ).run();
  let calls = 0;
  const mock = (async () => {
    calls++;
    throw new Error("timeout");
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  await processNotifications(env, "https://example.com", mock);
  assert.equal(calls, 1);
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT status FROM notifications WHERE kind='reminder'",
      ).first<{ status: string }>()
    )?.status,
    "uncertain",
  );
});
test("cancellation during reminder request waits, then frees slot and queues cancellation", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  const b = await createBooking(env, request(), payload(futureSlot()));
  await env.DB.prepare(
    "UPDATE notifications SET status='sent' WHERE kind='telegram'",
  ).run();
  await env.DB.prepare(
    "UPDATE notifications SET due_at=0 WHERE kind='reminder'",
  ).run();
  const mock = (async () => {
    assert.equal((await cancelBooking(env, b.id)).status, "cancel_pending");
    return new Response(JSON.stringify({ sid: "SMrace" }), { status: 201 });
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  assert.equal((await findBooking(env, b.id))?.status, "cancelled");
  assert.equal(
    (
      await env.DB.prepare("SELECT count(*) AS n FROM occupancy").first<{
        n: number;
      }>()
    )?.n,
    0,
  );
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT status FROM notifications WHERE kind='cancel'",
      ).first<{ status: string }>()
    )?.status,
    "pending",
  );
});
test("Telegram requires owner and an unexpired one-time confirmation", async () => {
  const env = environment();
  const b = await createBooking(env, request(), payload(futureSlot()));
  const originalFetch = globalThis.fetch;
  const buttons: any[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    const data = JSON.parse(init.body);
    if (data.reply_markup) buttons.push(data.reply_markup);
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as typeof fetch;
  const callback = (data: string, owner = 123) =>
    new Request("https://example.com/api/telegram/webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET!,
      },
      body: JSON.stringify({
        callback_query: {
          id: "q",
          from: { id: owner },
          data,
          message: { message_id: 1, chat: { id: 123, type: "private" } },
        },
      }),
    });
  try {
    await handleTelegram(env, callback(`ask:${b.id}`, 999));
    assert.equal(buttons.length, 0);
    await handleTelegram(env, callback(`ask:${b.id}`));
    assert.equal((await findBooking(env, b.id))?.status, "confirmed");
    const yes = buttons[0].inline_keyboard[0][0].callback_data;
    await handleTelegram(env, callback(yes));
    assert.equal((await findBooking(env, b.id))?.status, "cancelled");
    await handleTelegram(env, callback(yes));
    assert.equal(
      (
        await env.DB.prepare(
          "SELECT count(*) AS n FROM notifications WHERE kind='cancel'",
        ).first<{ n: number }>()
      )?.n,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("admin auth, CSRF, confirmation capability and Twilio signature", async () => {
  const env = environment();
  const ctx = { waitUntil() {} } as unknown as ExecutionContext;
  assert.equal(
    (
      await worker.fetch(
        new Request("https://example.com/api/admin/bookings"),
        env,
        ctx,
      )
    ).status,
    401,
  );
  const login = new Request("https://example.com/api/admin/login", {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "content-type": "application/json",
    },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
  });
  const result = await worker.fetch(login, env, ctx);
  assert.equal(result.status, 200);
  const cookie = result.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (
      await worker.fetch(
        new Request("https://example.com/api/admin/bookings", {
          headers: { cookie },
        }),
        env,
        ctx,
      )
    ).status,
    200,
  );
  const bad = new Request("https://example.com/api/admin/login", {
    method: "POST",
    headers: { origin: "https://evil.com" },
  });
  assert.equal((await worker.fetch(bad, env, ctx)).status, 403);
  const b = await createBooking(env, request(), payload(futureSlot()));
  assert.equal(
    (
      await worker.fetch(
        new Request(`https://example.com/api/bookings/${b.id}`),
        env,
        ctx,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(`https://example.com/api/bookings/${b.id}`, {
          headers: { authorization: "Bearer " + "a".repeat(64) },
        }),
        env,
        ctx,
      )
    ).status,
    200,
  );
  const url = "https://example.com/api/twilio/status?id=test";
  const data = new URLSearchParams({
    MessageSid: "SM1",
    MessageStatus: "delivered",
  });
  const signature = await sign(
    url + "MessageSidSM1MessageStatusdelivered",
    env.TWILIO_AUTH_TOKEN!,
    "SHA-1",
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(url, {
          method: "POST",
          body: data,
          headers: { "x-twilio-signature": signature },
        }),
        env,
        ctx,
      )
    ).status,
    204,
  );
  assert.equal(
    (
      await worker.fetch(
        new Request(url, { method: "POST", body: data }),
        env,
        ctx,
      )
    ).status,
    403,
  );
});

test("Telegram-only mode sends once and never calls Twilio, including cancellation", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  env.WHATSAPP_ENABLED = "false";
  const b = await createBooking(env, request(), payload(futureSlot()));
  assert.equal(b.whatsappConsent, false);
  const calls: string[] = [];
  const mock = (async (url: any) => {
    calls.push(String(url));
    assert(String(url).includes("api.telegram.org"));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }));
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  await processNotifications(env, "https://example.com", mock);
  await cancelBooking(env, b.id);
  await processNotifications(env, "https://example.com", mock);
  assert.equal(calls.length, 1);
  const rows = await env.DB.prepare("SELECT kind,status FROM notifications").all<{ kind: string; status: string }>();
  assert.equal(rows.results.find(n => n.kind === "reminder")?.status, "disabled");
  assert.equal(rows.results.find(n => n.kind === "cancel")?.status, "disabled");
});

test("turning WhatsApp off also blocks previously queued jobs despite configured credentials", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  const b = await createBooking(env, request(), payload(futureSlot()));
  assert.equal(b.whatsappConsent, true);
  env.WHATSAPP_ENABLED = "false";
  await env.DB.prepare("UPDATE notifications SET due_at=0").run();
  let calls = 0;
  const mock = (async (url: any) => {
    assert(String(url).includes("telegram.org"));
    calls++;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  assert.equal(calls, 1);
  assert.equal((await env.DB.prepare("SELECT status FROM notifications WHERE kind='reminder'").first<{ status: string }>())?.status, "disabled");
});

test("enabling WhatsApp later does not message customers who did not opt in", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  env.WHATSAPP_ENABLED = "false";
  const b = await createBooking(env, request(), { ...payload(futureSlot()), whatsappConsent: false });
  env.WHATSAPP_ENABLED = "true";
  await cancelBooking(env, b.id);
  assert.equal((await env.DB.prepare("SELECT status FROM notifications WHERE kind='cancel'").first<{ status: string }>())?.status, "disabled");
  assert.equal((await findBooking(env, b.id))?.whatsapp_consent_at, null);
});

test("protected test form requires admin and CSRF, uses normal booking rules and disables WhatsApp", async () => {
  const env = environment();
  env.BOOKING_ENABLED = "false";
  env.NOTIFICATIONS_ENABLED = "true";
  const jobs: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { jobs.push(p); } } as unknown as ExecutionContext;
  const origin = "https://example.com";
  const makeRequest = (path: string, body?: object, cookie = "", requestOrigin = origin) => new Request(origin + path, {
    method: body ? "POST" : "GET", headers: { Cookie: cookie, Origin: requestOrigin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = payload(futureSlot());
  assert.equal((await worker.fetch(makeRequest("/api/admin/test-bookings", data), env, ctx)).status, 401);
  assert.equal((await worker.fetch(makeRequest("/api/bookings", data), env, ctx)).status, 503);
  const login = await worker.fetch(makeRequest("/api/admin/login", { password: env.ADMIN_PASSWORD }), env, ctx);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const config = await worker.fetch(makeRequest("/api/admin/test-config", undefined, cookie), env, ctx);
  assert.equal((await config.json() as { whatsappEnabled: boolean }).whatsappEnabled, false);
  assert.equal((await worker.fetch(makeRequest("/api/admin/test-bookings", data, cookie, "https://evil.com"), env, ctx)).status, 403);
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    assert(String(url).includes("telegram.org"));
    return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }));
  }) as typeof fetch;
  try {
    const response = await worker.fetch(makeRequest("/api/admin/test-bookings", data, cookie), env, ctx);
    assert.equal(response.status, 201);
    const booking = await response.json() as { id: string; name: string; whatsappConsent: boolean };
    assert(booking.name.startsWith("[ТЕСТ]"));
    assert.equal(booking.whatsappConsent, false);
    await Promise.all(jobs);
    assert.equal((await env.DB.prepare("SELECT status FROM notifications WHERE booking_id=? AND kind='telegram'").bind(booking.id).first<{ status: string }>())?.status, "sent");
  } finally { globalThis.fetch = original; }
});
