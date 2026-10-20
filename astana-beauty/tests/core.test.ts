import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { settings, localDate, dateLabel, money, catalog, priceLabel, totalLabel } from "../src/shared";
import {
  selectedProcedures,
  candidateSlots,
  occupiedSegments,
  availableSlots,
  zonedEpoch,
  AppError,
} from "../worker/schedule";
import { createBooking, cancelBooking, findBooking } from "../worker/bookings";
import { rateLimit } from "../worker/security";
import { processNotifications } from "../worker/notifications";
import { handleTelegram } from "../worker/telegram";
import worker from "../worker/index";
import type { Env } from "../worker/types";

test("public page deep links load the app, missing pages are 404, assets and API stay separate", async () => {
  const env = environment();
  const seen: string[] = [];
  env.ASSETS = { fetch: async (req: Request) => {
    const path = new URL(req.url).pathname;
    seen.push(path);
    return new Response(path === "/fonts/example.woff2" ? "font" : "<div id='root'></div>", {
      headers: { "Content-Type": path.endsWith(".woff2") ? "font/woff2" : "text/html" },
    });
  } } as unknown as Fetcher;
  const ctx = { waitUntil() {} } as unknown as ExecutionContext;
  for (const path of ["/", "/about", "/about/", "/procedures", "/reviews", "/privacy", "/admin", "/admin/test-booking", "/confirmation/example"]) {
    const result = await worker.fetch(new Request(`https://example.com${path}`), env, ctx);
    assert.equal(result.status, 200, path);
    assert.equal(seen.at(-1), "/", path);
    assert.match(await result.text(), /id='root'/);
  }
  assert.equal((await worker.fetch(new Request("https://example.com/missing"), env, ctx)).status, 404);
  const font = await worker.fetch(new Request("https://example.com/fonts/example.woff2"), env, ctx);
  assert.equal(font.status, 200);
  assert.equal(await font.text(), "font");
  const count = seen.length;
  const config = await worker.fetch(new Request("https://example.com/api/config"), env, ctx);
  assert.equal(config.status, 200);
  assert.equal(seen.length, count);
});

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
  procedureIds: ["nine-step-cleansing"],
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
  const procedure = catalog.procedures.find(p => p.id === "biorevitalization")!;
  procedure.enabled = false;
  try { assert.throws(() => selectedProcedures([procedure.id]), AppError); }
  finally { procedure.enabled = true; }
  for (const ids of [
    ["nine-step-cleansing", "nine-step-cleansing"],
    ["fake"],
    [],
  ])
    assert.throws(() => selectedProcedures(ids), AppError);
  assert.throws(
    () =>
      selectedProcedures(["nine-step-cleansing", "plasmolifting", "biorevitalization", "mesotherapy", "microneedling"]),
    /tooLong/,
  );
});
test("minimum and unquoted prices are formatted in both languages, preserving legacy fixed bookings", () => {
  const known = selectedProcedures(["nine-step-cleansing", "yellow-peel"]);
  const unquoted = selectedProcedures(["papilloma-removal"]);
  const normalized = (text: string) => text.replaceAll("\u00a0", " ");
  assert.equal(normalized(priceLabel(known[0], "ru")), "от 8 000 ₸");
  assert.equal(priceLabel(unquoted[0], "ru"), "Цена уточняется");
  assert.equal(normalized(totalLabel(known, "ru")), "от 18 000 ₸");
  assert.equal(totalLabel(unquoted, "ru"), "Цена уточняется");
  assert.equal(normalized(totalLabel([...known, ...unquoted], "ru")), "от 18 000 ₸ + цена уточняется");
  assert.equal(normalized(totalLabel(known, "kk")), "18 000 ₸-ден бастап");
  assert.equal(totalLabel(unquoted, "kk"), "Бағасы нақтыланады");
  assert.equal(totalLabel([{ price: 12000 }], "ru", 12000), money(12000, "ru"));
});
test("server persists minimum and unknown price snapshots; Telegram receives the estimate, not a free service", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  env.WHATSAPP_ENABLED = "false";
  const b = await createBooking(env, request(), {
    ...payload(futureSlot(180)), procedureIds: ["nine-step-cleansing", "chemical-peel", "papilloma-removal"], total: 1,
  });
  assert.equal(b.total, 13000);
  assert.equal(b.duration, 180);
  assert.equal(b.services[0].priceType, "from");
  assert.equal(b.services[0].durationConfirmed, true);
  assert.equal(b.services[2].price, null);
  assert.equal(b.services[2].priceType, "on_request");
  const stored = await findBooking(env, b.id);
  assert.equal(JSON.parse(stored!.services)[2].price, null);
  let sentText = "";
  const mock = (async (_url: any, init: any) => {
    sentText = JSON.parse(init.body).text;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  assert(sentText.includes(totalLabel(b.services, "ru", b.total)));
  assert(sentText.includes("Удаление папиллом и бородавок"));
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
    1,
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
    0,
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
test("malformed booking timestamps are client errors and never reach storage", async () => {
  const env = environment(), ctx = { waitUntil() {} } as unknown as ExecutionContext;
  for (const start of [Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, "tomorrow", null, 1.5]) {
    const response = await worker.fetch(new Request("https://example.com/api/bookings", {
      method: "POST",
      headers: { Origin: "https://example.com", "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload(futureSlot()), start }),
    }), env, ctx);
    assert.equal(response.status, 400, String(start));
    assert.deepEqual(await response.json(), { code: "invalid" });
  }
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM bookings").first<{n:number}>())?.n, 0);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM rate_limits").first<{n:number}>())?.n, 0);
});
test("server rejects slots across lunch, outside working hours and off the slot grid", async () => {
  // Ищем ближайший будний день, чтобы тест не зависел от дня запуска.
  let date = "";
  for (let days = 1; days <= 7; days++) {
    const candidate = localDate(Date.now() + days * 86400000);
    const weekday = new Date(`${candidate}T12:00:00Z`).getUTCDay();
    if (weekday >= 1 && weekday <= 5) { date = candidate; break; }
  }
  const starts = [
    zonedEpoch(date, "09:45"),
    zonedEpoch(date, "12:00"),
    zonedEpoch(date, "18:00"),
    zonedEpoch(date, "10:00") + 1,
    Date.now() - 86400000,
  ];
  for (const start of starts) {
    const env = environment();
    await assert.rejects(createBooking(env, request(), payload(start)), (error: unknown) =>
      error instanceof AppError && error.code === "expired");
    assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM bookings").first<{n:number}>())?.n, 0);
  }
});
test("the preparation buffer blocks overlap but permits the immediately following slot", async () => {
  const env = environment(), start = futureSlot();
  await createBooking(env, request(), payload(start));
  await assert.rejects(createBooking(env, request(), payload(start + 60 * 60000, "b".repeat(64))), /busy/);
  const next = await createBooking(env, request(), payload(start + 75 * 60000, "c".repeat(64)));
  assert.equal(next.start_at, start + 75 * 60000);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM bookings").first<{n:number}>())?.n, 2);
});
test("concurrent retries of the same request return one booking and one notification", async () => {
  const env = environment(), data = payload(futureSlot());
  const results = await Promise.all([
    createBooking(env, request(), data),
    createBooking(env, request(), data),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM bookings").first<{n:number}>())?.n, 1);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM notifications").first<{n:number}>())?.n, 1);
  await assert.rejects(createBooking(env, request(), { ...data, name: "Другой клиент" }), /invalid/);
});
test("rate limits are atomic and phone limits also apply across different IP addresses", async () => {
  const env = environment(), sameIp = request();
  const results = await Promise.allSettled(Array.from({ length: 6 }, () =>
    rateLimit(env, sameIp, "booking", 5, 3600)));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 5);
  const denied = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.equal(denied.reason.status, 429);
  for (let n = 0; n < 3; n++) await rateLimit(env, request(), "phone", 3, 86400, "+77011234567");
  await assert.rejects(rateLimit(env, request(), "phone", 3, 86400, "+77011234567"),
    (error: unknown) => error instanceof AppError && error.status === 429);
  await rateLimit(env, request(), "phone", 3, 86400, "+77011234568");
});
test("malformed admin cookies are rejected as unauthorized without a server error", async () => {
  const env = environment(), ctx = { waitUntil() {} } as unknown as ExecutionContext;
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  for (const cookie of [`aru_admin=${expiry}.nonce.%`, `aru_admin=NaN.nonce.signature`]) {
    const response = await worker.fetch(new Request("https://example.com/api/admin/bookings", {
      headers: { Cookie: cookie },
    }), env, ctx);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { code: "unauthorized" });
  }
});
test("unknown provider response is quarantined, never retried", async () => {
  const env = environment();
  env.NOTIFICATIONS_ENABLED = "true";
  const b = await createBooking(env, request(), payload(futureSlot()));
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
        "SELECT status FROM notifications WHERE kind='telegram'",
      ).first<{ status: string }>()
    )?.status,
    "uncertain",
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
      0,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retired WhatsApp jobs never send, while Telegram sends once with old provider credentials present", async () => {
  const env = environment(); env.NOTIFICATIONS_ENABLED = "true"; env.WHATSAPP_ENABLED = "true";
  const b = await createBooking(env, request(), payload(futureSlot()));
  assert.equal(b.whatsappConsent, false);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM notifications WHERE kind='reminder'").first<{n:number}>())?.n, 0);
  await env.DB.prepare("INSERT INTO notifications (id,booking_id,kind,status,due_at) VALUES (?,?,?,'pending',0)").bind("old-reminder", b.id, "reminder").run();
  let calls = 0;
  const mock = (async (url: any) => { assert(String(url).startsWith("https://api.telegram.org/")); calls++;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 11 } }));
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  await processNotifications(env, "https://example.com", mock);
  assert.equal(calls, 1);
  assert.equal((await env.DB.prepare("SELECT status FROM notifications WHERE id='old-reminder'").first<{status:string}>())?.status, "disabled");
  await cancelBooking(env, b.id); await processNotifications(env, "https://example.com", mock);
  assert.equal(calls, 1);
  const ctx = { waitUntil() {} } as unknown as ExecutionContext;
  const config = await worker.fetch(new Request("https://example.com/api/config"), env, ctx);
  assert.equal((await config.json() as {whatsappEnabled:boolean}).whatsappEnabled, false);
});

test("public reviews require consent, stay unpublished until admin approval, and cannot bypass auth or CSRF", async () => {
  const env = environment(), ctx = { waitUntil() {} } as unknown as ExecutionContext;
  const run = (path: string, body?: object, cookie = "", origin = "https://example.com") => worker.fetch(new Request("https://example.com"+path, {
    method: body ? "POST" : "GET", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    ...(body ? {body: JSON.stringify(body)} : {}),
  }), env, ctx);
  const data = { name:"Клиент", text:"Спасибо за внимательный приём!", lang:"ru", consent:true, website:"" };
  assert.equal((await run("/api/reviews", {...data, consent:false})).status, 400);
  const created = await run("/api/reviews", data); assert.equal(created.status, 201);
  const {id} = await created.json() as {id:string};
  assert.deepEqual((await (await run("/api/reviews")).json() as {rows:unknown[]}).rows, []);
  assert.equal((await run("/api/admin/reviews")).status, 401);
  assert.equal((await run(`/api/admin/reviews/${id}/status`, {status:"published"})).status, 401);
  const login = await run("/api/admin/login", {password:env.ADMIN_PASSWORD});
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await run(`/api/admin/reviews/${id}/status`, {status:"published"}, cookie, "https://evil.com")).status, 403);
  assert.equal((await run(`/api/admin/reviews/${id}/status`, {status:"published"}, cookie)).status, 200);
  assert.equal((await (await run("/api/reviews")).json() as {rows:{text:string}[]}).rows[0].text, data.text);
  await run(`/api/admin/reviews/${id}/status`, {status:"hidden"}, cookie);
  assert.deepEqual((await (await run("/api/reviews")).json() as {rows:unknown[]}).rows, []);
});

test("admin screenshot uploads validate image types and size; private and hidden images stay inaccessible", async () => {
  const env = environment(), ctx = {waitUntil() {}} as unknown as ExecutionContext;
  const run = (path:string, body?:object, cookie="") => worker.fetch(new Request("https://example.com"+path, {
    method:body ? "POST":"GET", headers:{Origin:"https://example.com", Cookie:cookie, "Content-Type":"application/json"}, ...(body ? {body:JSON.stringify(body)}:{}),
  }), env, ctx);
  const login = await run("/api/admin/login", {password:env.ADMIN_PASSWORD}); const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const data = {name:"Клиент", text:"", lang:"kk", consent:true, image:{type:"image/png", data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yj+0AAAAASUVORK5CYII="}};
  assert.equal((await run("/api/reviews", data)).status, 403);
  assert.equal((await run("/api/admin/reviews", {...data, image:{type:"image/svg+xml",data:btoa("<svg><script>alert(1)</script></svg>")}}, cookie)).status, 400);
  assert.equal((await run("/api/admin/reviews", {...data, image:{type:"image/png",data:"A".repeat(1_100_000)}}, cookie)).status, 413);
  const created = await run("/api/admin/reviews", data, cookie); assert.equal(created.status, 201);
  const {id} = await created.json() as {id:string};
  assert.equal((await run(`/api/reviews/${id}/image`)).status, 404);
  const preview = await run(`/api/admin/reviews/${id}/image`, undefined, cookie); assert.equal(preview.headers.get("content-type"), "image/png");
  assert.equal((await preview.arrayBuffer()).byteLength, atob(data.image.data).length);
  await run(`/api/admin/reviews/${id}/status`, {status:"published"}, cookie);
  assert.equal((await run(`/api/reviews/${id}/image`)).status, 200);
  await run(`/api/admin/reviews/${id}/status`, {status:"hidden"}, cookie);
  assert.equal((await run(`/api/reviews/${id}/image`)).status, 404);
});
test("admin auth, CSRF and confirmation capability", async () => {
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
