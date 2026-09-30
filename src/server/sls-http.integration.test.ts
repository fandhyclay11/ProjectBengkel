import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { hashPassword } from "@/server/password";

const port = 3199; const baseUrl = `http://localhost:${port}`;
function quote(value: string) { if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Unsafe identifier"); return `"${value}"`; }
function dbUrl(source: string, name: string) { const url = new URL(source); url.pathname = `/${name}`; return url.toString(); }
async function waitForServer(server: ChildProcess) { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { if (server.exitCode !== null) throw new Error("HTTP test server exited"); try { await fetch(`${baseUrl}/api/auth/session`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } } throw new Error("HTTP test server timeout"); }
async function stopServer(server: ChildProcess) { if (server.exitCode !== null) return; if (process.platform === "win32" && server.pid) { spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); return; } server.kill("SIGTERM"); await new Promise<void>((resolve) => server.once("exit", () => resolve())); }
function cookies(response: Response) { return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; "); }
async function login(username: string, password: string) { const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); assert.equal(response.status, 200); const cookie = cookies(response); const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } }); const body = await session.json() as { csrfToken: string }; return { cookie, csrf: body.csrfToken }; }

test("O3.2 HTTP preview/create/list use safe USER DTO and idempotent save", async (t) => {
  const sourceUrl = process.env.DATABASE_URL; const adminUrl = process.env.DATABASE_RESTORE_ADMIN_URL;
  if (!sourceUrl || !adminUrl) { t.skip("DATABASE_URL and DATABASE_RESTORE_ADMIN_URL are required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12); const dbName = `pbo32${suffix}`; const testUrl = dbUrl(sourceUrl, dbName); const password = `O3.2-${suffix}-Password!`;
  const admin = new pg.Client({ connectionString: adminUrl }); admin.on("error", () => undefined); let server: ChildProcess | undefined;
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE ${quote(dbName)} TEMPLATE ${quote(new URL(sourceUrl).pathname.slice(1))}`);
    const fixture = new pg.Client({ connectionString: testUrl }); fixture.on("error", () => undefined); await fixture.connect(); const passwordHash = await hashPassword(password);
    await fixture.query("INSERT INTO users(username, password_hash, role, updated_at) VALUES ($1, $2, 'ADMIN', CURRENT_TIMESTAMP), ($3, $2, 'USER', CURRENT_TIMESTAMP)", [`it_sls_admin_${suffix}`, passwordHash, `it_sls_user_${suffix}`]);
    const adminRow = await fixture.query<{ id: string }>("SELECT id FROM users WHERE username = $1", [`it_sls_admin_${suffix}`]);
    const part = await fixture.query<{ id: string }>("INSERT INTO spare_parts(code, name, selling_price, latest_buy_price, average_cost, stock_on_hand, updated_at) VALUES ($1, $2, 2500, 2200, 1200, 4, CURRENT_TIMESTAMP) RETURNING id", [`SPO32${suffix}`, `O3.2 HTTP Part ${suffix}`]);
    await fixture.query("INSERT INTO stock_movements(spare_part_id, movement_type, quantity, unit_cost, valuation_delta, source_type, source_id, actor_id) VALUES ($1, 'OPENING_STOCK', 4, 1200, 4800, 'HTTP_TEST', $2, $3)", [part.rows[0]!.id, suffix, adminRow.rows[0]!.id]); await fixture.end();
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "test", DATABASE_URL: testUrl }, stdio: "ignore", windowsHide: true }); await waitForServer(server);
    const session = await login(`it_sls_user_${suffix}`, password); const body = { transactionAt: "2026-09-30T10:15", discount: "500", items: [{ sparePartId: part.rows[0]!.id, quantity: "2", sellingPrice: "2000" }] };
    const preview = await fetch(`${baseUrl}/api/sls/preview`, { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie, origin: baseUrl, "x-csrf-token": session.csrf }, body: JSON.stringify(body) }); assert.equal(preview.status, 200); const previewBody = (await preview.json()).preview; assert.equal(previewBody.totalAmount, "3500"); assert.equal("totalHpp" in previewBody, false);
    const key = `http-sls-${suffix}`; const save = await fetch(`${baseUrl}/api/sls`, { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie, origin: baseUrl, "x-csrf-token": session.csrf, "idempotency-key": key }, body: JSON.stringify(body) }); assert.equal(save.status, 201); const saved = (await save.json()).sls; assert.match(saved.slsNumber, /^SLS-20260930-\d{4}$/); assert.equal("totalHpp" in saved, false);
    const replay = await fetch(`${baseUrl}/api/sls`, { method: "POST", headers: { "content-type": "application/json", cookie: session.cookie, origin: baseUrl, "x-csrf-token": session.csrf, "idempotency-key": key }, body: JSON.stringify(body) }); assert.equal(replay.status, 201); assert.equal((await replay.json()).sls.id, saved.id);
    const list = await fetch(`${baseUrl}/api/sls`, { headers: { cookie: session.cookie } }); assert.equal(list.status, 200); assert.equal("totalHpp" in (await list.json()).sls[0], false);
  } finally { if (server) await stopServer(server); await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [dbName]).catch(() => undefined); await admin.query(`DROP DATABASE IF EXISTS ${quote(dbName)}`).catch(() => undefined); await admin.end().catch(() => undefined); }
});
