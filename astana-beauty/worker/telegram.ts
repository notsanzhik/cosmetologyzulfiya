import { translations } from "../src/shared";
import type { Env } from "./types";
import { AppError } from "./schedule";
import { cancelBooking, findBooking } from "./bookings";
import { telegram } from "./notifications";
import { equalSecret } from "./security";

export async function handleTelegram(env: Env, request: Request) {
  if (
    !env.TELEGRAM_WEBHOOK_SECRET ||
    env.TELEGRAM_WEBHOOK_SECRET.startsWith("replace-") ||
    !(await equalSecret(
      request.headers.get("x-telegram-bot-api-secret-token") || "",
      env.TELEGRAM_WEBHOOK_SECRET,
    ))
  )
    throw new AppError("forbidden", 403);
  const raw = await request.text();
  if (raw.length > 12000) throw new AppError("invalid");
  const body = JSON.parse(raw) as {
    callback_query?: {
      id: string;
      from: { id: number };
      data?: string;
      message?: { message_id: number; chat: { id: number; type: string } };
    };
  };
  const q = body.callback_query;
  if (!q) return;
  const t = translations.ru.telegram;
  if (
    !q.message ||
    q.message.chat.type !== "private" ||
    String(q.message.chat.id) !== env.TELEGRAM_CHAT_ID ||
    String(q.from.id) !== env.TELEGRAM_OWNER_ID
  ) {
    await telegram(env, "answerCallbackQuery", {
      callback_query_id: q.id,
      text: t.denied,
    });
    return;
  }
  const [action, value] = (q.data || "").split(":");
  let answer = t.kept;
  const edit = (text: string, buttons: object[][]) =>
    telegram(env, "editMessageReplyMarkup", {
      chat_id: q.message!.chat.id,
      message_id: q.message!.message_id,
      reply_markup: { inline_keyboard: buttons },
    }).then(() => text);
  if (action === "ask" && /^[a-f0-9-]{36}$/.test(value || "")) {
    const b = await findBooking(env, value);
    if (!b || b.status !== "confirmed") answer = t.cancelled;
    else {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      await env.DB.prepare(
        "INSERT INTO cancel_confirmations (nonce,booking_id,expires_at) VALUES (?,?,?)",
      )
        .bind(nonce, b.id, Date.now() + 300000)
        .run();
      await edit(t.ask, [
        [
          { text: t.yes, callback_data: `yes:${nonce}` },
          { text: t.no, callback_data: `no:${b.id}` },
        ],
      ]);
      answer = t.ask;
    }
  } else if (action === "yes" && /^[a-f0-9]{32}$/.test(value || "")) {
    const confirmation = await env.DB.prepare(
      "DELETE FROM cancel_confirmations WHERE nonce=? AND expires_at>? RETURNING booking_id",
    )
      .bind(value, Date.now())
      .first<{ booking_id: string }>();
    if (!confirmation) answer = t.expired;
    else {
      const b = await cancelBooking(env, confirmation.booking_id);
      answer = b.status === "cancelled" ? t.cancelled : t.pending;
      await edit(answer, []);
    }
  } else if (action === "no" && /^[a-f0-9-]{36}$/.test(value || "")) {
    await env.DB.prepare("DELETE FROM cancel_confirmations WHERE booking_id=?")
      .bind(value)
      .run();
    const b = await findBooking(env, value);
    await edit(
      t.kept,
      b?.status === "confirmed"
        ? [[{ text: t.cancel, callback_data: `ask:${value}` }]]
        : [],
    );
  }
  await telegram(env, "answerCallbackQuery", {
    callback_query_id: q.id,
    text: answer,
    show_alert: true,
  });
}
