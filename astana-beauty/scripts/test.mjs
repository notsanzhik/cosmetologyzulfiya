import { build } from "esbuild";
import { mkdir, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir(".sites-runtime", { recursive: true });
const tests = (await readdir("tests")).filter(name => name.endsWith(".test.ts")).sort();
if (!tests.length) throw new Error("Не найдены тесты в tests/");
await build({
  entryPoints: tests.map(name => `tests/${name}`),
  outdir: ".sites-runtime",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
});
const result = spawnSync(
  process.execPath,
  ["--test", ...tests.map(name => `.sites-runtime/${name.replace(/\.ts$/, ".cjs")}`)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
