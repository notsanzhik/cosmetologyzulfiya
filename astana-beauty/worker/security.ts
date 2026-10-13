import type { Env } from "./types";
import { AppError } from "./schedule";

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function equalSecret(a: string, b: string) {
  const x = await sha256(a),
    y = await sha256(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
export async function sign(
  value: string,
  secret: string,
  algorithm = "SHA-256",
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
      ),
    ),
  );
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new AppError("forbidden", 403);
}
export async function jsonBody(request: Request, maxBytes = 12000) {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("invalid");
  // Ограничиваем поток, а не только готовый текст: лимит действует и без Content-Length.
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("invalid");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new AppError("invalid", 413);
    }
    chunks.push(result.value);
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  const body = new TextDecoder().decode(all);
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AppError("invalid");
    return parsed;
  } catch {
    throw new AppError("invalid");
  }
}
export async function rateLimit(
  env: Env,
  request: Request,
  bucket: string,
  limit: number,
  seconds: number,
  suffix = "",
) {
  // CF-Connecting-IP задаётся прокси Cloudflare. X-Forwarded-For не доверяем.
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const period = Math.floor(Date.now() / (seconds * 1000));
  const key = `${bucket}:${period}:${await sha256(bucket === "phone" ? suffix : ip + suffix)}`;
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(key, Date.now() + seconds * 2000)
    .first<{ count: number }>();
  if (!row || row.count > limit) throw new AppError("rate", 429);
}
export function adminConfigured(env: Env) {
  return (
    !!env.ADMIN_PASSWORD &&
    env.ADMIN_PASSWORD.length >= 16 &&
    !!env.SESSION_SECRET &&
    env.SESSION_SECRET.length >= 32 &&
    !env.ADMIN_PASSWORD.startsWith("replace-") &&
    !env.SESSION_SECRET.startsWith("replace-")
  );
}
export async function sessionCookie(env: Env, request: Request) {
  const payload = `${Math.floor(Date.now() / 1000) + 8 * 3600}.${crypto.randomUUID()}`;
  const signature = encodeURIComponent(
    await sign(payload, env.SESSION_SECRET!),
  );
  return `aru_admin=${payload}.${signature}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=28800${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function requireAdmin(env: Env, request: Request) {
  if (!adminConfigured(env)) throw new AppError("setup", 503);
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("aru_admin="))
    ?.slice(10);
  if (!value) throw new AppError("unauthorized", 401);
  const [expiry, nonce, signature] = value.split(".");
  if (
    !expiry ||
    !nonce ||
    !signature ||
    Number(expiry) < Date.now() / 1000 ||
    !(await equalSecret(
      decodeURIComponent(signature),
      await sign(`${expiry}.${nonce}`, env.SESSION_SECRET!),
    ))
  )
    throw new AppError("unauthorized", 401);
}
export async function validateTurnstile(
  env: Env,
  token: unknown,
  request: Request,
) {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (typeof token !== "string" || token.length > 2048)
    throw new AppError("forbidden", 403);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get("cf-connecting-ip") || "",
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const result = (await response.json()) as {
    success: boolean;
    hostname?: string;
    action?: string;
  };
  if (
    !result.success ||
    result.hostname !== new URL(request.url).hostname ||
    result.action !== "booking"
  )
    throw new AppError("forbidden", 403);
}
