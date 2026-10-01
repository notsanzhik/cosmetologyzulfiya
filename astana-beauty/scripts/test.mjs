import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
await mkdir(".sites-runtime", { recursive: true });
await build({
  entryPoints: ["tests/core.test.ts"],
  outfile: ".sites-runtime/core.test.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});
const result = spawnSync(
  process.execPath,
  ["--test", ".sites-runtime/core.test.cjs"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
