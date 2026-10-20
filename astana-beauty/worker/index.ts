import { settings, localDate, translations } from "../src/shared";
import type { Env, Booking } from "./types";
import {
  AppError,
  selectedProcedures,
  availableSlots,
  zonedEpoch,
  validDate,
} from "./schedule";
import {
  sha256,
  equalSecret,
  sign,
  checkOrigin,
  jsonBody,
  rateLimit,
  requireAdmin,
  adminConfigured,
  sessionCookie,
} from "./security";
import {
  createBooking,
  findBooking,
  publicBooking,
  cancelBooking,
} from "./bookings";
import { processNotifications } from "./notifications";
import { handleTelegram } from "./telegram";
import { reviewApi } from "./reviews";
import { isAppPath } from "../src/routes";
import { createTelegramPairing, telegramPairingStatus } from "./telegram-pairing";

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}
function runtimeConfig(env: Env) {
  return {
    bookingEnabled: env.BOOKING_ENABLED === "true",
    notificationsEnabled: env.NOTIFICATIONS_ENABLED === "true",
    whatsappEnabled: false,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || "",
    adminConfigured: adminConfigured(env),
  };
}
async function api(request: Request, env: Env, ctx: ExecutionContext) {
  const url = new URL(request.url),
    path = url.pathname,
    method = request.method;
  if (!env.DB) throw new AppError("setup", 503);
  const reviewResponse = await reviewApi(request, env);
  if (reviewResponse) return reviewResponse;
  if (path === "/api/config" && method === "GET")
    return json(runtimeConfig(env));
  if (path === "/api/slots" && method === "GET") {
    await rateLimit(env, request, "slots", 90, 60);
    const date = url.searchParams.get("date") || "";
    validDate(date);
    const procedures = selectedProcedures(
      (url.searchParams.get("ids") || "").split(","),
    );
    const duration = procedures.reduce((n, p) => n + p.duration, 0);
    const start = zonedEpoch(date, "00:00");
    const busy = await env.DB.prepare(
      "SELECT start_at FROM occupancy WHERE start_at>=? AND start_at<?",
    )
      .bind(start, start + 86400000)
      .all<{ start_at: number }>();
    return json({
      slots: availableSlots(
        date,
        duration,
        new Set(busy.results.map((x) => x.start_at)),
      ),
    });
  }
  if (path === "/api/bookings" && method === "POST") {
    checkOrigin(request);
    const result = await createBooking(env, request, await jsonBody(request));
    ctx.waitUntil(
      processNotifications(env, url.origin).catch(() =>
        console.error("notification_job_failed"),
      ),
    );
    return json(result, 201);
  }
  if (path.startsWith("/api/bookings/") && method === "GET") {
    await rateLimit(env, request, "confirmation", 60, 60);
    const b = await findBooking(env, path.split("/").pop()!);
    const token =
      request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
    if (
      !b ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !(await equalSecret(await sha256(token), b.token_hash))
    )
      throw new AppError("notFound", 404);
    return json(publicBooking(b));
  }
  if (path === "/api/admin/login" && method === "POST") {
    checkOrigin(request);
    if (!adminConfigured(env)) throw new AppError("setup", 503);
    await rateLimit(env, request, "login", 8, 900);
    const body = await jsonBody(request);
    if (
      typeof body.password !== "string" ||
      body.password.length > 200 ||
      !(await equalSecret(body.password, env.ADMIN_PASSWORD!))
    )
      throw new AppError("unauthorized", 401);
    return json({ ok: true }, 200, {
      "Set-Cookie": await sessionCookie(env, request),
    });
  }
  if (path === "/api/admin/logout" && method === "POST") {
    checkOrigin(request);
    return json({ ok: true }, 200, {
      "Set-Cookie":
        "aru_admin=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0",
    });
  }
  if (path.startsWith("/api/admin/")) {
    await requireAdmin(env, request);
    if (path === "/api/admin/telegram/pairing" && method === "POST") {
      checkOrigin(request);
      await rateLimit(env, request, "telegram-pairing", 6, 3600);
      return json(await createTelegramPairing(env, (await jsonBody(request)).username), 201);
    }
    if (/^\/api\/admin\/telegram\/pairing\/[a-f0-9-]{36}$/.test(path) && method === "GET")
      return json(await telegramPairingStatus(env, path.split("/").pop()!));
    if (path === "/api/admin/test-config" && method === "GET")
      return json({ ...runtimeConfig(env), bookingEnabled: true, whatsappEnabled: false });
    if (path === "/api/admin/test-bookings" && method === "POST") {
      checkOrigin(request);
      const body = await jsonBody(request);
      if (typeof body.name === "string")
        body.name = `${translations[body.lang === "kk" ? "kk" : "ru"].telegram.testPrefix} ${body.name.trim()}`;
      // Проверка использует обычную валидацию и занятость, но никогда не отправляет WhatsApp.
      const result = await createBooking(
        { ...env, BOOKING_ENABLED: "true", WHATSAPP_ENABLED: "false" }, request, body,
      );
      ctx.waitUntil(processNotifications(env, url.origin).catch(() => console.error("notification_job_failed")));
      return json(result, 201);
    }
    if (path === "/api/admin/bookings" && method === "GET") {
      const date = url.searchParams.get("date"),
        status = url.searchParams.get("status");
      const page = Number(url.searchParams.get("page") || "0");
      if (!Number.isSafeInteger(page) || page < 0 || page > 100000)
        throw new AppError("invalid");
      if (
        date &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(date)))
      )
        throw new AppError("invalid");
      if (
        status &&
        !["confirmed", "cancel_pending", "cancelled"].includes(status)
      )
        throw new AppError("invalid");
      const start = date ? zonedEpoch(date, "00:00") : 0;
      const result = await env.DB.prepare(
        "SELECT * FROM bookings WHERE (? IS NULL OR (start_at>=? AND start_at<?)) AND (? IS NULL OR status=?) ORDER BY start_at DESC,id DESC LIMIT 101 OFFSET ?",
      )
        .bind(date, start, start + 86400000, status, status, page * 100)
        .all<Booking>();
      const rows = result.results.slice(0, 100);
      const notices = rows.length
        ? await env.DB.prepare(
            `SELECT booking_id,kind,status,provider_id,delivery,error FROM notifications WHERE booking_id IN (${rows.map(() => "?").join(",")})`,
          )
            .bind(...rows.map((b) => b.id))
            .all<{ booking_id: string }>()
        : { results: [] };
      return json({
        rows: rows.map((b) => ({
          ...publicBooking(b),
          notifications: notices.results.filter((n) => n.booking_id === b.id),
        })),
        hasMore: result.results.length > 100,
      });
    }
    if (
      /^\/api\/admin\/bookings\/[a-f0-9-]{36}\/cancel$/.test(path) &&
      method === "POST"
    ) {
      checkOrigin(request);
      const result = await cancelBooking(env, path.split("/")[4]);
      ctx.waitUntil(
        processNotifications(env, url.origin).catch(() =>
          console.error("notification_job_failed"),
        ),
      );
      return json(result);
    }
  }
  if (path === "/api/telegram/webhook" && method === "POST") {
    await handleTelegram(env, request);
    ctx.waitUntil(
      processNotifications(env, url.origin).catch(() =>
        console.error("notification_job_failed"),
      ),
    );
    return json({ ok: true });
  }
  if (path === "/api/cron" && method === "POST") {
    if (
      !env.CRON_SECRET ||
      env.CRON_SECRET.length < 32 ||
      env.CRON_SECRET.startsWith("replace-") ||
      !(await equalSecret(
        request.headers.get("authorization") || "",
        "Bearer " + env.CRON_SECRET,
      ))
    )
      throw new AppError("forbidden", 403);
    return json(await processNotifications(env, url.origin));
  }
  return json({ code: "notFound" }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!new URL(request.url).pathname.startsWith("/api/")) {
      const url = new URL(request.url);
      const appPath = isAppPath(url.pathname);
      // На прямой вход и обновление любой страницы отдаём оболочку приложения.
      // Это не зависит от различий SPA fallback у Workers и Pages.
      const assetUrl = new URL(url);
      if (appPath) assetUrl.pathname = "/";
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      const headers = new Headers(response.headers);
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "SAMEORIGIN");
      headers.set(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=()",
      );
      const html = response.headers.get("Content-Type")?.includes("text/html");
      return new Response(response.body, { status: html && !appPath ? 404 : response.status, headers });
    }
    try {
      return await api(request, env, ctx);
    } catch (error) {
      if (error instanceof AppError)
        return json({ code: error.code }, error.status);
      // Не печатаем телефоны, имена и секреты в журналы хостинга.
      console.error("api_operation_failed", {
        path: new URL(request.url).pathname,
        type: error instanceof Error ? error.name : "unknown",
      });
      return json({ code: "unavailable" }, 503);
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    // Адрес сайта задаётся в окружении; cron обслуживает только очередь Telegram.
    const origin = (env as Env & { SITE_URL?: string }).SITE_URL;
    if (!origin) {
      console.error("cron_requires_SITE_URL");
      return;
    }
    ctx.waitUntil(processNotifications(env, origin));
  },
};
