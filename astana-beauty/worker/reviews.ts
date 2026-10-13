import type { Env } from "./types";
import { AppError } from "./schedule";
import { checkOrigin, jsonBody, rateLimit, requireAdmin } from "./security";

type Review = {
  id: string; name: string; body: string; lang: string; status: string;
  image_data: string | null; image_type: string | null; created_at: number;
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const present = (r: Review, admin: boolean) => ({
  id: r.id, name: r.name, text: r.body, lang: r.lang, status: r.status, createdAt: r.created_at,
  imageUrl: r.image_type ? `/api/${admin ? "admin/" : ""}reviews/${r.id}/image` : null,
});

function image(value: unknown) {
  if (value == null) return { data: null, type: null };
  if (typeof value !== "object" || !value) throw new AppError("invalid");
  const { data, type } = value as { data?: unknown; type?: unknown };
  if (typeof data !== "string" || data.length > 1_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new AppError("imageInvalid");
  let bytes: string;
  try { bytes = atob(data); } catch { throw new AppError("imageInvalid"); }
  if (bytes.length > 750_000 || bytes.length < 12) throw new AppError("imageInvalid");
  const signature = [...bytes.slice(0, 8)].map(c => c.charCodeAt(0));
  const png = signature.join(",") === "137,80,78,71,13,10,26,10";
  const jpeg = signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
  const webp = bytes.slice(0, 4) === "RIFF" && bytes.slice(8, 12) === "WEBP";
  const actualType = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : null;
  if (!actualType || type !== actualType) throw new AppError("imageInvalid");
  return { data, type: actualType };
}

export async function reviewApi(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!/^\/api\/(admin\/)?reviews(?:\/|$)/.test(path)) return null;
  const admin = path.startsWith("/api/admin/");
  if (admin) await requireAdmin(env, request);
  const base = admin ? "/api/admin/reviews" : "/api/reviews";
  if (path === base && request.method === "GET") {
    const result = await env.DB.prepare(
      `SELECT id,name,body,lang,status,image_type,created_at FROM reviews ${admin ? "" : "WHERE status='published'"} ORDER BY created_at DESC,id DESC LIMIT ${admin ? 100 : 30}`,
    ).all<Review>();
    return response({ rows: result.results.map(r => present(r, admin)) });
  }
  if (path === base && request.method === "POST") {
    checkOrigin(request);
    await rateLimit(env, request, admin ? "review-upload" : "review", admin ? 40 : 5, 3600);
    const body = await jsonBody(request, admin ? 1_050_000 : 12000);
    if (body.consent !== true || body.website || !["ru", "kk"].includes(body.lang)) throw new AppError("invalid");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (name.length < 2 || name.length > 80 || /[\x00-\x1f<>]/.test(name) || text.length > 1500 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))
      throw new AppError("invalid");
    if (!admin && body.image != null) throw new AppError("forbidden", 403);
    const photo = image(admin ? body.image : null);
    if ((!photo.data && text.length < 10) || (photo.data && text.length !== 0 && text.length < 10))
      throw new AppError("invalid");
    const id = crypto.randomUUID(), now = Date.now();
    // Публичные отзывы сначала ждут проверки. Админ тоже явно публикует загруженный скриншот.
    await env.DB.prepare("INSERT INTO reviews (id,name,body,lang,status,image_data,image_type,created_at,consent_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .bind(id, name, text, body.lang, "pending", photo.data, photo.type, now, now).run();
    return response({ id, status: "pending" }, 201);
  }
  const match = path.slice(base.length).match(/^\/([a-f0-9-]{36})\/(image|status)$/);
  if (!match) throw new AppError("notFound", 404);
  const [, id, action] = match;
  if (action === "image" && request.method === "GET") {
    const row = await env.DB.prepare(`SELECT * FROM reviews WHERE id=? ${admin ? "" : "AND status='published'"}`).bind(id).first<Review>();
    if (!row?.image_data || !row.image_type) throw new AppError("notFound", 404);
    const bytes = Uint8Array.from(atob(row.image_data), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { "Content-Type": row.image_type, "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
  }
  if (admin && action === "status" && request.method === "POST") {
    checkOrigin(request);
    const body = await jsonBody(request);
    if (!["published", "hidden"].includes(body.status)) throw new AppError("invalid");
    const result = await env.DB.prepare("UPDATE reviews SET status=? WHERE id=? RETURNING id").bind(body.status, id).first();
    if (!result) throw new AppError("notFound", 404);
    return response({ ok: true });
  }
  throw new AppError("notFound", 404);
}
