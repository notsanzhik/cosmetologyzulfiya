import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { catalog, localDate, settings } from "../src/shared";
import { candidateSlots } from "../worker/schedule";
import { createBooking, findBooking } from "../worker/bookings";
import type { Env } from "../worker/types";

// Воспроизводим смену версии каталога только в памяти и локальной SQLite.
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
  return {
    DB: {
      prepare: (sql: string) => new Statement(sql),
      async batch(statements: Statement[]) {
        sqlite.exec("BEGIN IMMEDIATE");
        try {
          const result = statements.map(s => sqlite.prepare(s.sql).run(...s.args as any[]));
          sqlite.exec("COMMIT"); return result;
        } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      },
    } as unknown as D1Database,
    ASSETS: {} as Fetcher, BOOKING_ENABLED: "true", NOTIFICATIONS_ENABLED: "false",
  };
}
const request = () => new Request("https://example.com/api/bookings", {
  method: "POST", headers: { origin: "https://example.com", "cf-connecting-ip": "192.0.2.1" },
});
function payload(ids = ["nine-step-cleansing"], duration = 90) {
  let start = 0;
  for (let day = 1; day < 10 && !start; day++)
    start = candidateSlots(localDate(Date.now() + day * 86400000), duration)[0] || 0;
  assert(start > 0);
  return {
    name: "Тестовый клиент", phone: "+77011234567", lang: "ru",
    start, procedureIds: ids, consent: true, token: "a".repeat(64), whatsappConsent: false,
  };
}

test("replay after a catalog change returns the original snapshot and leaves old reservations untouched", async () => {
  const env = environment();
  const procedure = catalog.procedures.find(p => p.id === "nine-step-cleansing")!;
  const original = structuredClone(procedure), buffer = settings.bufferMinutes;
  try {
    procedure.duration = 60; settings.bufferMinutes = 15;
    const body = payload([procedure.id], 60);
    const first = await createBooking(env, request(), body);
    const before = await findBooking(env, first.id);
    const locksBefore = await env.DB.prepare("SELECT * FROM occupancy ORDER BY start_at").all();
    // Новая версия: другие минуты, цена, название; услуга уже скрыта от новых клиентов.
    procedure.duration = 90;
    procedure.price = (procedure.price || 0) + 5000;
    procedure.name = { ru: "Новое название", kk: "Жаңа атау" };
    procedure.enabled = false;
    settings.bufferMinutes = 0;
    const repeated = await createBooking(env, request(), body);
    assert.deepEqual(repeated, first);
    assert.deepEqual(await findBooking(env, first.id), before);
    assert.deepEqual(await env.DB.prepare("SELECT * FROM occupancy ORDER BY start_at").all(), locksBefore);
    assert.equal(before?.duration, 60);
    assert.equal(before?.reserved_until, body.start + 75 * 60000);
    assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM bookings").first<{ n: number }>())?.n, 1);
    assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM notifications").first<{ n: number }>())?.n, 1);
  } finally { Object.assign(procedure, original); settings.bufferMinutes = buffer; }
});

test("reusing a token cannot alter client, language, time or any part of the original procedure list", async () => {
  const env = environment();
  const body = payload(["nine-step-cleansing", "plasmolifting"], 180);
  const first = await createBooking(env, request(), body);
  const before = await findBooking(env, first.id);
  for (const patch of [
    { name: "Другой клиент" },
    { phone: "+77011234568" },
    { lang: "kk" },
    { start: body.start + 90 * 60000 },
    { procedureIds: ["plasmolifting", "nine-step-cleansing"] },
    { procedureIds: ["nine-step-cleansing"] },
    { procedureIds: ["nine-step-cleansing", "biorevitalization"] },
    { procedureIds: ["nine-step-cleansing", "plasmolifting", "biorevitalization"] },
    { procedureIds: ["nine-step-cleansing", "nine-step-cleansing"] },
    { procedureIds: [] },
    { procedureIds: "nine-step-cleansing" },
    { whatsappConsent: true },
  ]) {
    await assert.rejects(createBooking(env, request(), { ...body, ...patch }), /invalid/);
  }
  assert.deepEqual(await findBooking(env, first.id), before);
  assert.deepEqual(await createBooking(env, request(), { ...body, name: ` ${body.name} ` }), first);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM bookings").first<{ n: number }>())?.n, 1);
});

test("a concurrent old-version request wins once and the new-version retry returns its saved booking", async () => {
  const env = environment(), db = env.DB;
  const body = payload();
  const procedure = catalog.procedures.find(p => p.id === body.procedureIds[0])!;
  const duration = procedure.duration, buffer = settings.bufferMinutes;
  let inserted = false;
  env.DB = {
    ...db,
    async batch(statements: D1PreparedStatement[]) {
      if (!inserted && (statements[0] as unknown as { sql: string }).sql.startsWith("INSERT INTO bookings")) {
        inserted = true;
        // Другая версия успела сохранить тот же запрос между SELECT и INSERT.
        procedure.duration = 60; settings.bufferMinutes = 15;
        try { await createBooking({ ...env, DB: db }, request(), body); }
        finally { procedure.duration = duration; settings.bufferMinutes = buffer; }
      }
      return db.batch(statements);
    },
  } as D1Database;
  const result = await createBooking(env, request(), body);
  assert.equal(result.duration, 60);
  const stored = await findBooking(env, result.id);
  assert.equal(stored?.reserved_until, body.start + 75 * 60000);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM bookings").first<{ n: number }>())?.n, 1);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM notifications").first<{ n: number }>())?.n, 1);
  assert.equal((await db.prepare("SELECT count(*) AS n FROM occupancy").first<{ n: number }>())?.n, 5);
});
