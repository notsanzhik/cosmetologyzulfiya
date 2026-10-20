import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { localDate, translations } from "../src/shared";
import { candidateSlots } from "../worker/schedule";
import { createBooking, findBooking } from "../worker/bookings";
import { handleTelegram } from "../worker/telegram";
import { processNotifications } from "../worker/notifications";
import worker from "../worker/index";
import type { Env } from "../worker/types";
import { createTelegramPairing, telegramPairingStatus } from "../worker/telegram-pairing";
import { sessionCookie } from "../worker/security";

// Только изолированная SQLite в памяти. Ни Cloudflare, ни настоящие сообщения.
function environment(): Env {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync("drizzle").filter(n => n.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(`drizzle/${name}`, "utf8"));
  class Statement {
    args: unknown[] = [];
    constructor(public sql: string) {}
    bind(...args: unknown[]) { this.args = args; return this; }
    async first() { return sqlite.prepare(this.sql).get(...this.args as any[]) || null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.args as any[]) }; }
    async run() { return { success: true, meta: { changes: Number(sqlite.prepare(this.sql).run(...this.args as any[]).changes) } }; }
  }
  const DB = {
    prepare: (sql: string) => new Statement(sql),
    async batch(statements: Statement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = statements.map(s => sqlite.prepare(s.sql).run(...s.args as any[]));
        sqlite.exec("COMMIT"); return result;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return {
    DB, ASSETS: {} as Fetcher, BOOKING_ENABLED: "true", NOTIFICATIONS_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "test", TELEGRAM_CHAT_ID: "123", TELEGRAM_OWNER_ID: "123",
    TELEGRAM_WEBHOOK_SECRET: "t".repeat(40), ADMIN_PASSWORD: "p".repeat(20), SESSION_SECRET: "s".repeat(40),
  };
}
async function booking(env: Env) {
  let start = 0;
  for (let day = 1; day < 10 && !start; day++)
    start = candidateSlots(localDate(Date.now() + day * 86400000), 90)[0] || 0;
  assert(start > 0);
  return createBooking(env, new Request("https://example.com/api/bookings", {
    method: "POST", headers: { origin: "https://example.com" },
  }), {
    name: "Тестовый клиент", phone: "+77011234567", lang: "ru",
    start, procedureIds: ["nine-step-cleansing"], consent: true, token: "a".repeat(64),
  });
}
const callback = (env: Env, data: string) => new Request("https://example.com/api/telegram/webhook", {
  method: "POST",
  headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET! },
  body: JSON.stringify({ callback_query: {
    id: "q", from: { id: 123 }, data,
    message: { message_id: 1, chat: { id: 123, type: "private" } },
  } }),
});

test("an explicit Telegram 429 is delayed and retried once, without immediate duplicate sends", async () => {
  const env = environment(), b = await booking(env);
  let calls = 0;
  const mock = (async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ ok: false, error_code: 429, parameters: { retry_after: 120 } }), { status: 429 })
      : new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }));
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  const waiting = await env.DB.prepare("SELECT status,due_at,error FROM notifications WHERE booking_id=?")
    .bind(b.id).first<{ status: string; due_at: number; error: string }>();
  assert.equal(waiting?.status, "pending");
  assert.equal(waiting.error, "telegram_rate_limited");
  assert(waiting.due_at > Date.now() + 110000);
  await processNotifications(env, "https://example.com", mock);
  assert.equal(calls, 1);
  await env.DB.prepare("UPDATE notifications SET due_at=0 WHERE booking_id=?").bind(b.id).run();
  await processNotifications(env, "https://example.com", mock);
  await processNotifications(env, "https://example.com", mock);
  assert.equal(calls, 2);
  const sent = await env.DB.prepare("SELECT status,provider_id,error FROM notifications WHERE booking_id=?")
    .bind(b.id).first<{ status: string; provider_id: string; error: string | null }>();
  assert.equal(sent?.status, "sent");
  assert.equal(sent.provider_id, "42");
  assert.equal(sent.error, null);
});

test("an explicit Telegram permission rejection is a failure and never auto-retried", async () => {
  const env = environment(); await booking(env);
  let calls = 0;
  const mock = (async () => {
    calls++;
    return new Response(JSON.stringify({ ok: false, error_code: 403, description: "test only" }), { status: 403 });
  }) as typeof fetch;
  await processNotifications(env, "https://example.com", mock);
  await processNotifications(env, "https://example.com", mock);
  assert.equal(calls, 1);
  const failed = await env.DB.prepare("SELECT status,error FROM notifications").first<{ status: string; error: string }>();
  assert.equal(failed?.status, "failed");
  assert.equal(failed.error, "telegram_rejected_403");
});

test("a concurrent worker with a stale pending snapshot cannot bypass Telegram retry_after", async () => {
  const env = environment(), b = await booking(env);
  let snapshotReady!: () => void, releaseSnapshot!: () => void;
  const captured = new Promise<void>(resolve => { snapshotReady = resolve; });
  const resume = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  const delayedEnv: Env = { ...env, DB: {
    ...env.DB,
    prepare(sql: string) {
      const statement = env.DB.prepare(sql);
      if (sql.startsWith("SELECT * FROM notifications WHERE status='pending'")) {
        const originalAll = statement.all.bind(statement);
        statement.all = async () => {
          // Второй обработчик уже прочитал pending, но пока не начал claim.
          const snapshot = await originalAll();
          snapshotReady();
          await resume;
          return snapshot;
        };
      }
      return statement;
    },
  } as D1Database };
  let calls = 0;
  const mock = (async () => {
    calls++;
    return new Response(JSON.stringify({
      ok: false, error_code: 429, parameters: { retry_after: 120 },
    }), { status: 429 });
  }) as typeof fetch;
  const staleWorker = processNotifications(delayedEnv, "https://example.com", mock);
  await captured;
  try {
    const first = await processNotifications(env, "https://example.com", mock);
    assert.equal(first.processed, 1);
  } finally { releaseSnapshot(); }
  const second = await staleWorker;
  assert.equal(second.processed, 0);
  assert.equal(calls, 1);
  const waiting = await env.DB.prepare("SELECT status,due_at FROM notifications WHERE booking_id=?")
    .bind(b.id).first<{ status: string; due_at: number }>();
  assert.equal(waiting?.status, "pending");
  assert(waiting.due_at > Date.now() + 110000);
});

test("expired cancellation buttons recover after nonce cleanup, while rejection and confirmation stay one-time", async () => {
  const env = environment(), b = await booking(env);
  const messages: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    messages.push(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ ok: true, result: {} }));
  }) as typeof fetch;
  try {
    await handleTelegram(env, callback(env, `ask:${b.id}`));
    const buttons = () => messages.filter(m => m.reply_markup).at(-1).reply_markup.inline_keyboard;
    const firstYes = buttons()[0][0].callback_data;
    assert.equal(new TextEncoder().encode(firstYes).length, 63);
    await env.DB.prepare("DELETE FROM cancel_confirmations").run();
    await handleTelegram(env, callback(env, firstYes));
    assert.equal(buttons()[0][0].callback_data, `ask:${b.id}`);
    assert.equal(messages.at(-1).text, translations.ru.telegram.expired);
    assert.equal((await findBooking(env, b.id))?.status, "confirmed");
    await handleTelegram(env, callback(env, `ask:${b.id}`));
    const rejectedYes = buttons()[0][0].callback_data;
    await handleTelegram(env, callback(env, `no:${b.id}`));
    await handleTelegram(env, callback(env, rejectedYes));
    assert.equal((await findBooking(env, b.id))?.status, "confirmed");
    await handleTelegram(env, callback(env, `ask:${b.id}`));
    const finalYes = buttons()[0][0].callback_data;
    await handleTelegram(env, callback(env, finalYes));
    await handleTelegram(env, callback(env, finalYes));
    assert.equal((await findBooking(env, b.id))?.status, "cancelled");
    assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM occupancy").first<{ n: number }>())?.n, 0);
    assert.deepEqual(buttons(), []);
    assert.equal(messages.at(-1).text, translations.ru.telegram.cancelled);
  } finally { globalThis.fetch = original; }
});

test("malformed authenticated Telegram payloads are rejected as invalid, not transient server failures", async () => {
  const env = environment();
  const ctx = { waitUntil() { throw new Error("Invalid updates must not schedule jobs"); } } as unknown as ExecutionContext;
  for (const raw of ["{", "[]", JSON.stringify({ callback_query: { id: "q", data: "ask:bad" } })]) {
    const result = await worker.fetch(new Request("https://example.com/api/telegram/webhook", {
      method: "POST", headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET! }, body: raw,
    }), env, ctx);
    assert.equal(result.status, 400);
  }
  const tooLarge = await worker.fetch(new Request("https://example.com/api/telegram/webhook", {
    method: "POST", headers: { "x-telegram-bot-api-secret-token": env.TELEGRAM_WEBHOOK_SECRET! }, body: JSON.stringify({ padding: "x".repeat(12001) }),
  }), env, ctx);
  assert.equal(tooLarge.status, 413);
});

test("Telegram pairing requires a fresh private start from the expected account and does not change notification access", async () => {
  const env = environment();
  const link = await createTelegramPairing(env, "@example_mom");
  assert(link.start.length <= 64);
  const message = {
    text: `/start ${link.start}`, date: Math.floor(Date.now() / 1000),
    from: { id: 456, username: "example_mom", is_bot: false },
    chat: { id: 456, type: "private" },
  };
  const request = (value: object, secret = env.TELEGRAM_WEBHOOK_SECRET!) => new Request("https://example.com/api/telegram/webhook", {
    method: "POST", headers: { "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify({ message: value }),
  });
  await assert.rejects(handleTelegram(env, request(message, "wrong")));
  for (const wrong of [
    { ...message, from: { ...message.from, username: "someone_else" } },
    { ...message, chat: { id: 456, type: "group" } },
    { ...message, date: message.date - 3600 },
    { ...message, text: "/start connect_" + "0".repeat(48) },
  ]) {
    await handleTelegram(env, request(wrong));
    assert.equal((await telegramPairingStatus(env, link.id)).connected, false);
  }
  await handleTelegram(env, request(message));
  const linked = await telegramPairingStatus(env, link.id) as { connected: boolean; chatId: string; ownerId: string };
  assert.equal(linked.connected, true);
  assert.equal(linked.chatId, "456");
  assert.equal(linked.ownerId, "456");
  await handleTelegram(env, request({ ...message, from: { ...message.from, id: 789 }, chat: { id: 789, type: "private" } }));
  assert.equal((await telegramPairingStatus(env, link.id) as { chatId: string }).chatId, "456");
  assert.equal(env.TELEGRAM_OWNER_ID, "123");
  assert.equal(env.TELEGRAM_CHAT_ID, "123");
  const expired = await createTelegramPairing(env, "example_mom");
  await env.DB.prepare("UPDATE telegram_pairings SET expires_at=0 WHERE id=?").bind(expired.id).run();
  await handleTelegram(env, request({ ...message, text: `/start ${expired.start}` }));
  assert.equal((await telegramPairingStatus(env, expired.id)).connected, false);
});

test("only an authenticated same-origin administrator can issue a Telegram pairing link", async () => {
  const env = environment();
  const url = "https://example.com/api/admin/telegram/pairing";
  const request = (headers: Record<string, string>) => new Request(url, {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ username: "example_mom" }),
  });
  const ctx = { waitUntil() {} } as unknown as ExecutionContext;
  assert.equal((await worker.fetch(request({ Origin: "https://example.com" }), env, ctx)).status, 401);
  const cookie = (await sessionCookie(env, new Request(url))).split(";")[0];
  assert.equal((await worker.fetch(request({ Cookie: cookie, Origin: "https://evil.example" }), env, ctx)).status, 403);
  const created = await worker.fetch(request({ Cookie: cookie, Origin: "https://example.com" }), env, ctx);
  assert.equal(created.status, 201);
  const link = await created.json() as { id: string };
  assert.equal((await worker.fetch(new Request(url + "/" + link.id), env, ctx)).status, 401);
});
