import type { Env } from "./types";
import { AppError } from "./schedule";
import { sha256 } from "./security";

export async function createTelegramPairing(env: Env, username: unknown) {
  if (typeof username !== "string") throw new AppError("invalid");
  const normalized = username.replace(/^@/, "").toLowerCase();
  if (!/^[a-z][a-z0-9_]{4,31}$/.test(normalized)) throw new AppError("invalid");
  const id = crypto.randomUUID();
  const token = [...crypto.getRandomValues(new Uint8Array(24))]
    .map(n => n.toString(16).padStart(2, "0")).join("");
  const now = Date.now(), expiresAt = now + 24 * 60 * 60 * 1000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM telegram_pairings WHERE expires_at<? OR username=?").bind(now, normalized),
    env.DB.prepare("INSERT INTO telegram_pairings (id,token_hash,username,created_at,expires_at) VALUES (?,?,?,?,?)")
      .bind(id, await sha256(token), normalized, now, expiresAt),
  ]);
  return { id, username: normalized, start: `connect_${token}`, expiresAt };
}

export async function telegramPairingStatus(env: Env, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new AppError("invalid");
  const row = await env.DB.prepare(
    "SELECT id,username,expires_at AS expiresAt,chat_id AS chatId,owner_id AS ownerId,connected_at AS connectedAt FROM telegram_pairings WHERE id=?",
  ).bind(id).first<{ expiresAt: number; connectedAt: number | null }>();
  if (!row) throw new AppError("notFound", 404);
  return { ...row, expired: row.expiresAt < Date.now(), connected: row.connectedAt != null };
}

export async function captureTelegramPairing(env: Env, value: unknown) {
  // Вызывается только после проверки секретного заголовка webhook Telegram.
  if (!value || typeof value !== "object") return;
  const message = value as {
    text?: unknown; date?: unknown;
    from?: { id?: unknown; username?: unknown; is_bot?: unknown };
    chat?: { id?: unknown; type?: unknown };
  };
  if (typeof message.text !== "string" || !/^\/start connect_[a-f0-9]{48}$/.test(message.text)) return;
  if (
    !Number.isSafeInteger(message.from?.id) || !Number.isSafeInteger(message.chat?.id) ||
    message.from!.id !== message.chat!.id || message.chat!.type !== "private" ||
    message.from!.is_bot !== false || typeof message.from!.username !== "string" ||
    typeof message.date !== "number" || !Number.isSafeInteger(message.date)
  ) return;
  const now = Date.now();
  if (message.date * 1000 < now - 15 * 60 * 1000 || message.date * 1000 > now + 60_000) return;
  const token = message.text.slice("/start connect_".length);
  // Ссылка одноразовая, привязана к согласованному username и не даёт прав сама по себе.
  await env.DB.prepare(
    "UPDATE telegram_pairings SET chat_id=?,owner_id=?,connected_at=? WHERE token_hash=? AND username=? AND expires_at>? AND connected_at IS NULL",
  ).bind(String(message.chat!.id), String(message.from!.id), now, await sha256(token),
    message.from!.username.toLowerCase(), now).run();
}
