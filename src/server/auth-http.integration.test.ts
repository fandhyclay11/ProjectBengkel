import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { hashPassword } from "@/server/password";

const port = 3213; const baseUrl = `http://localhost:${port}`;
const dbUrlFor = (source: string, name: string) => { const url = new URL(source); url.pathname = `/${name}`; return url.toString(); };
const quote = (value: string) => { if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Unsafe identifier"); return `"${value}"`; };
const cookies = (response: Response) => response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
async function wait(server: ChildProcess) { const deadline = Date.now() + 30_000; while (Date.now() < deadline) { if (server.exitCode !== null) throw new Error(`Auth server exited with ${server.exitCode}`); try { await fetch(`${baseUrl}/api/auth/session`); return; } catch { await new Promise((resolve) => setTimeout(resolve, 250)); } } throw new Error("Auth server timeout"); }
async function login(username: string, password: string) { const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); assert.equal(response.status, 200); const cookie = cookies(response); const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } }); return { cookie, csrf: (await session.json()).csrfToken as string }; }

test("Auth logout works for Admin and USER with CSRF protection", async (t) => {
  const source = process.env.DATABASE_URL; const adminUrl = process.env.DATABASE_RESTORE_ADMIN_URL;
  if (!source || !adminUrl) { t.skip("DATABASE_URL and DATABASE_RESTORE_ADMIN_URL are required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12); const database = `pbauth${suffix}`; const url = dbUrlFor(source, database); const password = `Auth-${suffix}-Password!`; const dbAdmin = new pg.Client({ connectionString: adminUrl }); dbAdmin.on("error", () => undefined); let server: ChildProcess | undefined;
  try {
    await dbAdmin.connect(); await dbAdmin.query(`CREATE DATABASE ${quote(database)} TEMPLATE ${quote(new URL(source).pathname.slice(1))}`); const fixture = new pg.Client({ connectionString: url }); fixture.on("error", () => undefined); await fixture.connect(); const passwordHash = await hashPassword(password); await fixture.query("INSERT INTO users(username, password_hash, role, updated_at) VALUES ($1, $2, 'ADMIN', CURRENT_TIMESTAMP), ($3, $2, 'USER', CURRENT_TIMESTAMP)", [`it_auth_admin_${suffix}`, passwordHash, `it_auth_user_${suffix}`]); await fixture.end(); server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "test", DATABASE_URL: url }, stdio: "ignore", windowsHide: true }); await wait(server);
    for (const username of [`it_auth_admin_${suffix}`, `it_auth_user_${suffix}`]) {
      const session = await login(username, password); const missingCsrf = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: session.cookie, origin: baseUrl } }); assert.equal(missingCsrf.status, 403); const invalidCsrf = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: session.cookie, origin: baseUrl, "x-csrf-token": "invalid" } }); assert.equal(invalidCsrf.status, 403); const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie: session.cookie, origin: baseUrl, "x-csrf-token": session.csrf } }); assert.equal(logout.status, 200); assert.ok((logout.headers.getSetCookie().join(";")).includes("pb_session=")); const after = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie: session.cookie } }); assert.equal((await after.json()).user, null);
    }
  } finally { if (server && server.exitCode === null) { if (process.platform === "win32" && server.pid) spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); else server.kill("SIGTERM"); } await dbAdmin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [database]).catch(() => undefined); await dbAdmin.query(`DROP DATABASE IF EXISTS ${quote(database)}`).catch(() => undefined); await dbAdmin.end().catch(() => undefined); }
});
