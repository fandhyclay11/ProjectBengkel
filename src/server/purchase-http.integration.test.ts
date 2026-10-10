import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { hashPassword } from "@/server/password";

const port = 3200;
const baseUrl = `http://localhost:${port}`;

function quote(value: string) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Unsafe identifier");
  return `"${value}"`;
}

function dbUrl(source: string, name: string) {
  const url = new URL(source);
  url.pathname = `/${name}`;
  return url.toString();
}

async function waitForServer(server: ChildProcess, output: () => string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`HTTP test server exited with ${server.exitCode}.\n${output()}`);
    try {
      await fetch(`${baseUrl}/api/auth/session`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`HTTP test server timeout.\n${output()}`);
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    await new Promise<void>((resolve) => server.once("exit", () => resolve()));
    return;
  }
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
}

function cookies(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
}

async function login(username: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200);
  const cookie = cookies(response);
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { cookie } });
  assert.equal(session.status, 200);
  const body = await session.json() as { csrfToken: string };
  return { cookie, csrf: body.csrfToken };
}

test("Purchase HTTP date filter preserves Admin/User visibility and invalid-date validation", async (t) => {
  const sourceUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_RESTORE_ADMIN_URL;
  if (!sourceUrl || !adminUrl) { t.skip("DATABASE_URL and DATABASE_RESTORE_ADMIN_URL are required"); return; }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const dbName = `purch${suffix}`;
  const testUrl = dbUrl(sourceUrl, dbName);
  const password = `Purchase-${suffix}-Password!`;
  const admin = new pg.Client({ connectionString: adminUrl });
  admin.on("error", () => undefined);
  let server: ChildProcess | undefined;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quote(dbName)} TEMPLATE ${quote(new URL(sourceUrl).pathname.slice(1))}`);
    const fixture = new pg.Client({ connectionString: testUrl });
    fixture.on("error", () => undefined);
    await fixture.connect();
    const passwordHash = await hashPassword(password);
    await fixture.query("INSERT INTO users(username, password_hash, role, updated_at) VALUES ($1, $2, 'ADMIN', CURRENT_TIMESTAMP), ($3, $2, 'USER', CURRENT_TIMESTAMP)", [`it_purchase_admin_${suffix}`, passwordHash, `it_purchase_user_${suffix}`]);
    const adminRow = await fixture.query<{ id: string }>("SELECT id FROM users WHERE username = $1", [`it_purchase_admin_${suffix}`]);
    const part = await fixture.query<{ id: string }>("INSERT INTO spare_parts(code, name, selling_price, stock_on_hand, updated_at) VALUES ($1, $2, 2500, 0, CURRENT_TIMESTAMP) RETURNING id", [`PPUR${suffix}`, `Purchase HTTP Part ${suffix}`]);
    await fixture.end();

    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "test", DATABASE_URL: testUrl, APP_WORKSHOP_TIMEZONE: "Asia/Jakarta" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let output = "";
    server.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    server.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    await waitForServer(server, () => output);

    const adminSession = await login(`it_purchase_admin_${suffix}`, password);
    const userSession = await login(`it_purchase_user_${suffix}`, password);
    const body = { transactionAt: "2000-01-01T10:15", supplierName: "Historical Supplier", items: [{ sparePartId: part.rows[0]!.id, quantity: "2", unitBuyPrice: "1200" }] };
    const create = await fetch(`${baseUrl}/api/admin/purchases`, { method: "POST", headers: { "content-type": "application/json", cookie: adminSession.cookie, origin: baseUrl, "x-csrf-token": adminSession.csrf, "idempotency-key": `purchase-http-${suffix}` }, body: JSON.stringify(body) });
    assert.equal(create.status, 201);
    const created = (await create.json()).purchase as { id: string };

    const defaultAdmin = await fetch(`${baseUrl}/api/purchases`, { headers: { cookie: adminSession.cookie } });
    assert.equal(defaultAdmin.status, 200);
    assert.deepEqual((await defaultAdmin.json()).purchases, []);
    const historicalAdmin = await fetch(`${baseUrl}/api/purchases?date=2000-01-01`, { headers: { cookie: adminSession.cookie } });
    assert.equal(historicalAdmin.status, 200);
    const adminPurchases = (await historicalAdmin.json()).purchases as Array<Record<string, unknown>>;
    assert.equal(adminPurchases.length, 1);
    assert.equal(adminPurchases[0]!.id, created.id);
    assert.equal(adminPurchases[0]!.status, "DRAFT");
    assert.equal("unitBuyPrice" in (adminPurchases[0]!.items as Array<Record<string, unknown>>)[0]!, true);

    const userHistorical = await fetch(`${baseUrl}/api/purchases?date=2000-01-01`, { headers: { cookie: userSession.cookie } });
    assert.equal(userHistorical.status, 200);
    assert.deepEqual((await userHistorical.json()).purchases, []);
    const invalidDate = await fetch(`${baseUrl}/api/purchases?date=2000-02-31`, { headers: { cookie: userSession.cookie } });
    assert.equal(invalidDate.status, 400);
    const detail = await fetch(`${baseUrl}/api/purchases/${created.id}`, { headers: { cookie: adminSession.cookie } });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).purchase.id, created.id);
  } finally {
    if (server) await stopServer(server);
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [dbName]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${quote(dbName)}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
});
