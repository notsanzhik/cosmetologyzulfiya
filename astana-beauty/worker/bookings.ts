import { settings, localDate, totalAmount, type Lang, type Snapshot } from "../src/shared";
import type { Env, Booking } from "./types";
import {
  AppError,
  selectedProcedures,
  candidateSlots,
  occupiedSegments,
} from "./schedule";
import { sha256, rateLimit, validateTurnstile } from "./security";

export async function findBooking(env: Env, id: string) {
  return env.DB.prepare("SELECT * FROM bookings WHERE id=?")
    .bind(id)
    .first<Booking>();
}
export function publicBooking(b: Booking) {
  return {
    id: b.id,
    name: b.name,
    phone: b.phone,
    lang: b.lang,
    services: JSON.parse(b.services),
    total: b.total,
    duration: b.duration,
    start_at: b.start_at,
    status: b.status,
    whatsappConsent: b.whatsapp_consent_at != null,
  };
}
async function bookingRequestHash(body: Record<string, unknown>, snapshot: Snapshot[]) {
  return sha256(JSON.stringify([
    (body.name as string).trim(),
    body.phone,
    body.lang,
    snapshot,
    body.start,
    body.whatsappConsent === true,
  ]));
}
async function matchesOriginalRequest(b: Booking, body: Record<string, unknown>) {
  const snapshot = JSON.parse(b.services) as Snapshot[];
  const ids = body.procedureIds;
  if (
    !Array.isArray(ids) ||
    ids.length !== snapshot.length ||
    ids.some((id, index) => id !== snapshot[index].id)
  ) return false;
  // Каталог мог измениться после принятия записи. Проверяем повтор по тому
  // снимку, который реально сохранили, сохраняя исходные данные и их порядок.
  return b.request_hash === await bookingRequestHash(body, snapshot);
}
export async function createBooking(
  env: Env,
  request: Request,
  body: Record<string, unknown>,
) {
  if (env.BOOKING_ENABLED !== "true")
    throw new AppError("bookingDisabled", 503);
  if (
    typeof body.name !== "string" ||
    body.name.trim().length < 2 ||
    body.name.trim().length > 80 ||
    /[\x00-\x1f<>]/.test(body.name)
  )
    throw new AppError("invalid");
  if (typeof body.phone !== "string" || !/^\+7[67]\d{9}$/.test(body.phone))
    throw new AppError("invalid");
  if (body.lang !== "ru" && body.lang !== "kk") throw new AppError("invalid");
  if (body.consent !== true) throw new AppError("consent");
  if (body.whatsappConsent != null && typeof body.whatsappConsent !== "boolean")
    throw new AppError("invalid");
  const whatsappConsent = false;
  if (body.website) throw new AppError("invalid");
  if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token))
    throw new AppError("invalid");
  if (
    typeof body.start !== "number" ||
    !Number.isSafeInteger(body.start) ||
    !Number.isFinite(new Date(body.start).getTime())
  )
    throw new AppError("invalid");
  const tokenHash = await sha256(body.token);
  // Проверяем сохранённый результат до текущего каталога и расписания:
  // повтор принятого запроса не должен сломаться при смене цены или длительности.
  const existing = await env.DB.prepare(
    "SELECT * FROM bookings WHERE token_hash=?",
  )
    .bind(tokenHash)
    .first<Booking>();
  if (existing) {
    if (!(await matchesOriginalRequest(existing, body))) throw new AppError("invalid");
    return publicBooking(existing);
  }
  const procedures = selectedProcedures(body.procedureIds);
  const snapshot = procedures.map(
    ({ id, name, duration, durationConfirmed, price, priceType, placeholderPrice }) => ({
      id,
      name,
      duration,
      durationConfirmed,
      price,
      priceType,
      placeholderPrice,
    }),
  );
  const duration = procedures.reduce((n, p) => n + p.duration, 0),
    total = totalAmount(procedures);
  const requestHash = await bookingRequestHash(body, snapshot);
  await rateLimit(env, request, "booking", 5, 3600);
  await rateLimit(env, request, "phone", 3, 86400, body.phone);
  await validateTurnstile(env, body.turnstile, request);
  const now = Date.now();
  if (
    !candidateSlots(localDate(body.start), duration, now).includes(body.start)
  )
    throw new AppError("expired");
  const id = crypto.randomUUID();
  const lang = body.lang as Lang;
  const statements = [
    env.DB.prepare(
      "INSERT INTO bookings (id,token_hash,request_hash,name,phone,lang,services,total,duration,start_at,end_at,reserved_until,status,consent_at,created_at,whatsapp_consent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      id,
      tokenHash,
      requestHash,
      body.name.trim(),
      body.phone,
      lang,
      JSON.stringify(snapshot),
      total,
      duration,
      body.start,
      body.start + duration * 60000,
      body.start + (duration + settings.bufferMinutes) * 60000,
      "confirmed",
      now,
      now,
      whatsappConsent ? now : null,
    ),
  ];
  for (const at of occupiedSegments(body.start, duration))
    statements.push(
      env.DB.prepare(
        "INSERT INTO occupancy (start_at,booking_id) VALUES (?,?)",
      ).bind(at, id),
    );
  const notificationsEnabled = env.NOTIFICATIONS_ENABLED === "true";
  statements.push(env.DB.prepare("INSERT INTO notifications (id,booking_id,kind,status,due_at) VALUES (?,?,?,?,?)")
    .bind(crypto.randomUUID(), id, "telegram", notificationsEnabled ? "pending" : "disabled", now));

  try {
    await env.DB.batch(statements);
  } catch (error) {
    const repeated = await env.DB.prepare(
      "SELECT * FROM bookings WHERE token_hash=?",
    )
      .bind(tokenHash)
      .first<Booking>();
    if (repeated) {
      if (!(await matchesOriginalRequest(repeated, body))) throw new AppError("invalid");
      return publicBooking(repeated);
    }
    if (String(error).includes("UNIQUE constraint"))
      throw new AppError("busy", 409);
    throw error;
  }
  return publicBooking((await findBooking(env, id))!);
}

export async function finishCancellation(env: Env, id?: string) {
  // Не завершаем отмену, пока запрос напоминания к провайдеру в полёте.
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE bookings SET status='cancelled',cancelled_at=COALESCE(cancelled_at,?) WHERE status='cancel_pending' AND (? IS NULL OR id=?) AND NOT EXISTS (SELECT 1 FROM notifications WHERE booking_id=bookings.id AND kind='reminder' AND status='sending')",
    ).bind(Date.now(), id ?? null, id ?? null),
    env.DB.prepare(
      "DELETE FROM occupancy WHERE booking_id IN (SELECT id FROM bookings WHERE status='cancelled')",
    ),
    env.DB.prepare(
      "UPDATE notifications SET status='skipped' WHERE kind='reminder' AND status='pending' AND booking_id IN (SELECT id FROM bookings WHERE status!='confirmed')",
    ),
  ]);
}
export async function cancelBooking(env: Env, id: string) {
  const row = await findBooking(env, id);
  if (!row) throw new AppError("notFound", 404);
  await env.DB.prepare(
    "UPDATE bookings SET status='cancel_pending' WHERE id=? AND status='confirmed'",
  )
    .bind(id)
    .run();
  await finishCancellation(env, id);
  return publicBooking((await findBooking(env, id))!);
}
