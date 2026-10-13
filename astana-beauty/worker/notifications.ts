import { translations, totalLabel, dateLabel } from "../src/shared";
import type { Env, Notification, Booking } from "./types";
import { serviceSnapshot } from "./types";
import { findBooking, finishCancellation } from "./bookings";

export async function telegram(
  env: Env,
  method: string,
  body: object,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    },
  );
  const result = (await response.json()) as {
    ok: boolean;
    result?: { message_id?: number };
  };
  if (!response.ok || !result.ok) throw new Error("telegram_rejected");
  return result.result;
}
export async function dispatch(
  env: Env,
  n: Notification,
  b: Booking,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  if (n.kind === "telegram") {
    if (
      !env.TELEGRAM_BOT_TOKEN ||
      !env.TELEGRAM_CHAT_ID ||
      !env.TELEGRAM_OWNER_ID
    )
      return { status: "failed", error: "telegram_not_configured" };
    const t = translations.ru.telegram;
    const text = `${t.new} #${b.id.slice(0, 8)}\n${t.name}: ${b.name}\n${t.phone}: ${b.phone}\n${t.procedures}: ${serviceSnapshot(
      b,
    )
      .map((p) => p.name.ru)
      .join(
        ", ",
      )}\n${t.total}: ${totalLabel(serviceSnapshot(b), "ru", b.total)}\n${t.date}: ${dateLabel(b.start_at, "ru")}`;
    const result = await telegram(
      env,
      "sendMessage",
      {
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        reply_markup: {
          inline_keyboard: [[{ text: t.cancel, callback_data: `ask:${b.id}` }]],
        },
      },
      fetcher,
    );
    return { status: "sent", providerId: String(result?.message_id || "") };
  }
  // WhatsApp-автоматизация снята: даже старые задачи не вызывают платные API.
  return { status: "disabled" };
}

export async function processNotifications(
  env: Env,
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  const now = Date.now();
  await env.DB.prepare("UPDATE notifications SET status='disabled' WHERE kind!='telegram' AND status IN ('pending','sending')").run();
  // Процесс мог завершиться после отправки, но до сохранения ответа.
  // Безопасный выбор: не повторять неопределённую отправку автоматически.
  await env.DB.prepare(
    "UPDATE notifications SET status='uncertain',error='interrupted_send' WHERE status='sending' AND claimed_at<?",
  )
    .bind(now - 120000)
    .run();
  await finishCancellation(env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(now),
    env.DB.prepare("DELETE FROM cancel_confirmations WHERE expires_at<?").bind(
      now,
    ),
    env.DB.prepare(
      "UPDATE notifications SET status='expired' WHERE kind='reminder' AND status='pending' AND booking_id IN (SELECT id FROM bookings WHERE start_at<=?)",
    ).bind(now),
  ]);
  if (env.NOTIFICATIONS_ENABLED !== "true") return { processed: 0 };
  const due = await env.DB.prepare(
    "SELECT * FROM notifications WHERE status='pending' AND due_at<=? ORDER BY due_at LIMIT 12",
  )
    .bind(now)
    .all<Notification>();
  let processed = 0;
  for (const n of due.results) {
    const token = crypto.randomUUID();
    // Один атомарный UPDATE: два cron не смогут получить одну задачу.
    const claimed = await env.DB.prepare(
      "UPDATE notifications SET status='sending',claimed_at=?,claim_token=? WHERE id=? AND status='pending' AND EXISTS (SELECT 1 FROM bookings WHERE id=notifications.booking_id AND ((notifications.kind='cancel' AND status='cancelled') OR (notifications.kind!='cancel' AND status='confirmed')) AND (notifications.kind!='reminder' OR start_at>?)) RETURNING id",
    )
      .bind(Date.now(), token, n.id, Date.now())
      .first();
    if (!claimed) {
      await env.DB.prepare(
        "UPDATE notifications SET status='skipped' WHERE id=? AND status='pending' AND booking_id IN (SELECT id FROM bookings WHERE status!='confirmed')",
      )
        .bind(n.id)
        .run();
      continue;
    }
    const b = await findBooking(env, n.booking_id);
    let result: { status: string; error?: string; providerId?: string };
    if (
      !b ||
      (n.kind !== "cancel" && b.status !== "confirmed") ||
      (n.kind === "reminder" && b.start_at <= Date.now())
    )
      result = { status: "skipped" };
    else {
      try {
        result = await dispatch(env, n, b, origin, fetcher);
      } catch {
        result = { status: "uncertain", error: "provider_response_unknown" };
      }
    }
    await env.DB.prepare(
      "UPDATE notifications SET status=?,provider_id=COALESCE(?,provider_id),error=? WHERE id=? AND status='sending' AND claim_token=?",
    )
      .bind(
        result.status,
        result.providerId || null,
        result.error || null,
        n.id,
        token,
      )
      .run();
    await finishCancellation(env, n.booking_id);
    processed++;
  }
  return { processed };
}
