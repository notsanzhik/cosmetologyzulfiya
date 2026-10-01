import { settings, localDate, type Lang } from "../src/shared";
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
  const whatsappConsent = env.NOTIFICATIONS_ENABLED === "true" &&
    env.WHATSAPP_ENABLED === "true" && body.whatsappConsent === true;
  if (body.website) throw new AppError("invalid");
  if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token))
    throw new AppError("invalid");
  if (typeof body.start !== "number" || !Number.isSafeInteger(body.start))
    throw new AppError("invalid");
  const procedures = selectedProcedures(body.procedureIds);
  const snapshot = procedures.map(
    ({ id, name, duration, price, placeholderPrice }) => ({
      id,
      name,
      duration,
      price,
      placeholderPrice,
    }),
  );
  const duration = procedures.reduce((n, p) => n + p.duration, 0),
    total = procedures.reduce((n, p) => n + p.price, 0);
  const tokenHash = await sha256(body.token);
  const requestHash = await sha256(
    JSON.stringify([
      body.name.trim(),
      body.phone,
      body.lang,
      snapshot,
      body.start,
      body.whatsappConsent === true,
    ]),
  );
  // Повтор после потери ответа возвращает ту же запись и не занимает новый слот.
  const existing = await env.DB.prepare(
    "SELECT * FROM bookings WHERE token_hash=?",
  )
    .bind(tokenHash)
    .first<Booking>();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new AppError("invalid");
    return publicBooking(existing);
  }
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
  for (const [kind, due] of [
    ["telegram", now],
    ["reminder", Math.max(now, body.start - settings.reminderHours * 3600000)],
  ] as const) {
    statements.push(
      env.DB.prepare(
        "INSERT INTO notifications (id,booking_id,kind,status,due_at) VALUES (?,?,?,?,?)",
      ).bind(
        crypto.randomUUID(),
        id,
        kind,
        notificationsEnabled && (kind === "telegram" || whatsappConsent) ? "pending" : "disabled",
        due,
      ),
    );
  }
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const repeated = await env.DB.prepare(
      "SELECT * FROM bookings WHERE token_hash=?",
    )
      .bind(tokenHash)
      .first<Booking>();
    if (repeated?.request_hash === requestHash) return publicBooking(repeated);
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
    env.DB.prepare(
      "INSERT OR IGNORE INTO notifications (id,booking_id,kind,status,due_at) SELECT 'cancel:'||id,id,'cancel',CASE WHEN ?=1 AND whatsapp_consent_at IS NOT NULL THEN 'pending' ELSE 'disabled' END,? FROM bookings WHERE status='cancelled'",
    ).bind(
      env.NOTIFICATIONS_ENABLED === "true" && env.WHATSAPP_ENABLED === "true" ? 1 : 0,
      Date.now(),
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
