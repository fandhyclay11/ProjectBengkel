import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { hashPassword } from "@/server/password";

const port = 3210; const baseUrl = `http://localhost:${port}`;
const dbUrlFor = (source: string, name: string) => { const url = new URL(source); url.pathname = `/${name}`; return url.toString(); };
const quote = (value: string) => { if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Unsafe identifier"); return `"${value}"`; };
async function wait(server: ChildProcess) { const deadline = Date.now() + 30000; while (Date.now() < deadline) { if (server.exitCode !== null) throw new Error(`server exited ${server.exitCode}`); try { await fetch(`${baseUrl}/api/auth/session`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } } throw new Error("server timeout"); }
function cookies(response: Response) { return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; "); }
async function login(username: string, password: string) { const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); assert.equal(response.status, 200); const cookie = cookies(response); const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } }); return { cookie, csrf: (await session.json()).csrfToken as string }; }

test("R6.2 report API and exports enforce Admin authorization and safe formats", async (t) => {
  const source = process.env.DATABASE_URL; const adminUrl = process.env.DATABASE_RESTORE_ADMIN_URL;
  if (!source || !adminUrl) { t.skip("DATABASE_URL and DATABASE_RESTORE_ADMIN_URL are required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12); const database = `pbr62${suffix}`; const url = dbUrlFor(source, database); const password = `R62-${suffix}-Password!`; const admin = new pg.Client({ connectionString: adminUrl }); admin.on("error", () => undefined); let server: ChildProcess | undefined;
  try { await admin.connect(); await admin.query(`CREATE DATABASE ${quote(database)} TEMPLATE ${quote(new URL(source).pathname.slice(1))}`); const fixture = new pg.Client({ connectionString: url }); fixture.on("error", () => undefined); await fixture.connect(); const passwordHash = await hashPassword(password); await fixture.query("INSERT INTO users(username, password_hash, role, updated_at) VALUES ($1, $2, 'ADMIN', CURRENT_TIMESTAMP), ($3, $2, 'USER', CURRENT_TIMESTAMP)", [`it_r62_admin_${suffix}`, passwordHash, `it_r62_user_${suffix}`]); await fixture.end(); server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "test", DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }); let output = ""; server.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); }); server.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); }); try { await wait(server); } catch (error) { throw new Error(`${(error as Error).message}\nNext.js output:\n${output}`); }
    const adminSession = await login(`it_r62_admin_${suffix}`, password); const userSession = await login(`it_r62_user_${suffix}`, password);
    const user = await fetch(`${baseUrl}/api/admin/reports/services?from=2026-10-01&to=2026-10-01`, { headers: { cookie: userSession.cookie } }); assert.equal(user.status, 403);
    const report = await fetch(`${baseUrl}/api/admin/reports/services?from=2026-10-01&to=2026-10-01`, { headers: { cookie: adminSession.cookie } }); assert.equal(report.status, 200); assert.equal((await report.json()).report, "services");
    const exportHeaders = { cookie: adminSession.cookie, origin: baseUrl, "x-csrf-token": adminSession.csrf };
    const csrfRejected = await fetch(`${baseUrl}/api/admin/reports/services/export/pdf?from=2026-10-01&to=2026-10-01`, { method: "POST", headers: { cookie: adminSession.cookie, origin: baseUrl } }); assert.equal(csrfRejected.status, 403);
    const pdf = await fetch(`${baseUrl}/api/admin/reports/services/export/pdf?from=2026-10-01&to=2026-10-01`, { method: "POST", headers: exportHeaders }); assert.equal(pdf.status, 200); assert.equal((await pdf.arrayBuffer()).byteLength > 0, true); assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);
    const excel = await fetch(`${baseUrl}/api/admin/reports/services/export/xlsx?from=2026-10-01&to=2026-10-01`, { method: "POST", headers: exportHeaders }); assert.equal(excel.status, 200); assert.equal((await excel.arrayBuffer()).byteLength > 0, true); assert.match(excel.headers.get("content-type") ?? "", /spreadsheetml/);
    const slsPdf = await fetch(`${baseUrl}/api/admin/reports/sls/export/pdf?from=2026-10-01&to=2026-10-01`, { method: "POST", headers: exportHeaders }); assert.equal(slsPdf.status, 200); assert.equal((await slsPdf.arrayBuffer()).byteLength > 0, true);
    const slsExcel = await fetch(`${baseUrl}/api/admin/reports/sls/export/xlsx?from=2026-10-01&to=2026-10-01`, { method: "POST", headers: exportHeaders }); assert.equal(slsExcel.status, 200); assert.equal((await slsExcel.arrayBuffer()).byteLength > 0, true);
    const userExport = await fetch(`${baseUrl}/api/admin/reports/services/export/xlsx?from=2026-10-01&to=2026-10-01`, { method: "POST", headers: { cookie: userSession.cookie } }); assert.equal(userExport.status, 403);
  } finally { if (server && server.exitCode === null) { if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else server.kill("SIGTERM"); } await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]).catch(() => undefined); await admin.query(`DROP DATABASE IF EXISTS ${quote(database)}`).catch(() => undefined); await admin.end().catch(() => undefined); }
});
