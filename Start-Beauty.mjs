import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

const project = join(dirname(fileURLToPath(import.meta.url)), "astana-beauty");
const env = {
  ...process.env,
  WRANGLER_SEND_METRICS: "false",
  WRANGLER_WRITE_LOGS: "false",
  WRANGLER_LOG_PATH: join(project, ".wrangler", "logs"),
  CLOUDFLARE_CF_FETCH_ENABLED: "false",
};

function run(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(project, script), ...args], {
      cwd: project, env, stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Код завершения: ${code}`)));
  });
}

try {
  if (!existsSync(join(project, "node_modules", "vite", "bin", "vite.js"))) {
    throw new Error("Зависимости отсутствуют. В папке astana-beauty выполните npm ci по инструкции START_HERE.md.");
  }
  try {
    const response = await fetch("http://127.0.0.1:5173/api/config", { signal: AbortSignal.timeout(1000) });
    if (response.ok && typeof (await response.json()).bookingEnabled === "boolean") {
      console.log("Сайт уже работает: http://127.0.0.1:5173\nАдминка: http://127.0.0.1:5173/admin");
      process.exit(0);
    }
  } catch { /* Отсутствие сервера при первом запуске — ожидаемая ситуация. */ }
  const vars = join(project, ".dev.vars");
  if (!existsSync(vars)) {
    // Пароли создаются только локально и не выводятся в консоль.
    writeFileSync(vars, [
      "BOOKING_ENABLED=true", "NOTIFICATIONS_ENABLED=false", "WHATSAPP_ENABLED=false",
      "SITE_URL=http://127.0.0.1:5173",
      `ADMIN_PASSWORD=${randomBytes(24).toString("hex")}`,
      `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
      `CRON_SECRET=${randomBytes(32).toString("hex")}`, "",
    ].join("\n"), { flag: "wx" });
  }
  await run("node_modules/wrangler/bin/wrangler.js", ["d1", "migrations", "apply", "astana-beauty-db", "--local"]);
  console.log("\nСайт: http://127.0.0.1:5173\nАдминка: http://127.0.0.1:5173/admin\nПароль админки: строка ADMIN_PASSWORD в astana-beauty/.dev.vars.\nДля остановки нажмите Ctrl+C в этом окне.\n");
  await run("node_modules/vite/bin/vite.js", ["--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
} catch (error) {
  console.error(`\nЗапуск остановлен: ${error.message}`);
  process.exitCode = 1;
}
