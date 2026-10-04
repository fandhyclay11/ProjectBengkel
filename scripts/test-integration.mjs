import { spawnSync } from "node:child_process";

const existingOptions = process.env.NODE_OPTIONS?.trim();
const env = {
  ...process.env,
  NODE_OPTIONS: [existingOptions, "--conditions=react-server"].filter(Boolean).join(" "),
};
const result = spawnSync(
  process.execPath,
  ["./node_modules/tsx/dist/cli.mjs", "--test", "--test-concurrency=1", "src/server/database.integration.test.ts", "src/server/sparepart-service.test.ts", "src/server/stock-service.test.ts", "src/server/purchase-service.test.ts", "src/server/stock-card-http.integration.test.ts", "src/server/service-service.test.ts", "src/server/service-http.integration.test.ts", "src/server/sls-service.test.ts", "src/server/sls-http.integration.test.ts", "src/server/o33-service-sls.test.ts", "src/server/expense-service.test.ts", "src/server/expense-http.integration.test.ts", "src/server/stock-opname-service.test.ts", "src/server/stock-opname-http.integration.test.ts", "src/server/report-query.integration.test.ts", "src/server/report-http.integration.test.ts"],
  { env, stdio: "inherit" },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
