import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { hashPassword } from "@/server/password";

const port = 3211;
const baseUrl = `http://localhost:${port}`;
const dbUrlFor = (source: string, name: string) => { const url = new URL(source); url.pathname = `/${name}`; return url.toString(); };
const quote = (value: string) => { if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Unsafe identifier"); return `"${value}"`; };
function cookies(response: Response) { return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; "); }
async function wait(server: ChildProcess, output: () => string) { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { if (server.exitCode !== null) throw new Error(`Dashboard HTTP server exited with ${server.exitCode}.\n${output()}`); try { await fetch(`${baseUrl}/api/admin/dashboard?preset=month`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } } throw new Error(`Dashboard HTTP server timeout.\n${output()}`); }
async function login(username: string, password: string) { const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); assert.equal(response.status, 200); const cookie = cookies(response); return { cookie }; }

test("R6.3 Dashboard HTTP enforces Admin access and safe current-state semantics", async (t) => {
  const source = process.env.DATABASE_URL; const adminUrl = process.env.DATABASE_RESTORE_ADMIN_URL;
  if (!source || !adminUrl) { t.skip("DATABASE_URL and DATABASE_RESTORE_ADMIN_URL are required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12); const database = `pbr63${suffix}`; const url = dbUrlFor(source, database); const password = `R63-${suffix}-Password!`; const admin = new pg.Client({ connectionString: adminUrl }); admin.on("error", () => undefined); let server: ChildProcess | undefined;
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE ${quote(database)} TEMPLATE ${quote(new URL(source).pathname.slice(1))}`);
    const fixture = new pg.Client({ connectionString: url }); fixture.on("error", () => undefined); await fixture.connect(); const passwordHash = await hashPassword(password);
    await fixture.query("INSERT INTO users(username, password_hash, role, updated_at) VALUES ($1, $2, 'ADMIN', CURRENT_TIMESTAMP), ($3, $2, 'USER', CURRENT_TIMESTAMP)", [`it_r63_admin_${suffix}`, passwordHash, `it_r63_user_${suffix}`]);
    await fixture.query("INSERT INTO purchases(purchase_number, transaction_at, supplier_name, status, total_amount, created_by_id, updated_at) SELECT $1, $2, 'R63', 'DRAFT', 0, id, CURRENT_TIMESTAMP FROM users WHERE username = $3", [`PUR-R63-${suffix}`, new Date("2026-09-30T10:00:00Z"), `it_r63_admin_${suffix}`]);
    await fixture.end(); server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "test", DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); let output = ""; server.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); }); server.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); }); await wait(server, () => output);
    const unauthenticated = await fetch(`${baseUrl}/api/admin/dashboard?preset=month`); assert.equal(unauthenticated.status, 401);
    const user = await login(`it_r63_user_${suffix}`, password); const userResponse = await fetch(`${baseUrl}/api/admin/dashboard?preset=month`, { headers: { cookie: user.cookie } }); assert.equal(userResponse.status, 403);
    const adminSession = await login(`it_r63_admin_${suffix}`, password); const adminResponse = await fetch(`${baseUrl}/api/admin/dashboard?preset=custom&from=2026-10-01&to=2026-10-01`, { headers: { cookie: adminSession.cookie } }); assert.equal(adminResponse.status, 200); const body = await adminResponse.json() as { dashboard: { kpis: Record<string, unknown> } }; assert.equal(body.dashboard.kpis.pendingPurchaseDraftCount, 1); assert.equal("expense" in body.dashboard.kpis, false); assert.equal("hpp" in body.dashboard.kpis, false); assert.equal("inventoryValue" in body.dashboard.kpis, false); assert.equal("averageCost" in body.dashboard, false);
  } finally { if (server && server.exitCode === null) { if (process.platform === "win32" && server.pid) { spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); await new Promise<void>((resolve) => server!.once("exit", () => resolve())); } else { server.kill("SIGTERM"); await new Promise<void>((resolve) => server!.once("exit", () => resolve())); } } await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]).catch(() => undefined); await admin.query(`DROP DATABASE IF EXISTS ${quote(database)}`).catch(() => undefined); await admin.end().catch(() => undefined); }
});
