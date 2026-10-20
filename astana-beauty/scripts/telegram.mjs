// Настройка бота с вашего компьютера. Секреты читаются из .dev.vars.
import { existsSync } from "node:fs";
if (existsSync(".dev.vars")) process.loadEnvFile(".dev.vars");
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error("Заполните TELEGRAM_BOT_TOKEN в .dev.vars");
const [command, url] = process.argv.slice(2);
async function call(method, body = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!result.ok)
    throw new Error(
      `Telegram отклонил запрос, код ${result.error_code}. Проверьте токен и параметры.`,
    );
  return result.result;
}
if (command === "ids") {
  const updates = await call("getUpdates");
  console.log(
    updates
      .filter((x) => x.message?.chat?.type === "private")
      .map((x) => ({
        name: x.message.from.first_name,
        TELEGRAM_CHAT_ID: String(x.message.chat.id),
        TELEGRAM_OWNER_ID: String(x.message.from.id),
      })),
  );
} else if (command === "register") {
  if (
    !url?.startsWith("https://") ||
    !process.env.TELEGRAM_WEBHOOK_SECRET ||
    process.env.TELEGRAM_WEBHOOK_SECRET.startsWith("replace-")
  )
    throw new Error(
      "Нужны HTTPS-адрес сайта и настоящий TELEGRAM_WEBHOOK_SECRET.",
    );
  await call("setWebhook", {
    url: new URL("/api/telegram/webhook", url).href,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query"],
  });
  console.log("Webhook установлен.");
} else if (command === "status") {
  const result = await call("getWebhookInfo");
  console.log({
    url: result.url,
    pending_update_count: result.pending_update_count,
    last_error_message: result.last_error_message,
  });
} else {
  console.log(
    "Команды: node scripts/telegram.mjs ids | register https://ВАШ-САЙТ | status",
  );
}
