import { spawnSync } from "node:child_process";

const existingOptions = process.env.NODE_OPTIONS?.trim();
const env = {
  ...process.env,
  NODE_OPTIONS: [existingOptions, "--conditions=react-server"].filter(Boolean).join(" "),
};
const result = spawnSync(
  process.execPath,
  ["./node_modules/tsx/dist/cli.mjs", "--test", "src/server/database.integration.test.ts", "src/server/sparepart-service.test.ts", "src/server/stock-service.test.ts", "src/server/purchase-service.test.ts", "src/server/stock-card-http.integration.test.ts"],
  { env, stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
