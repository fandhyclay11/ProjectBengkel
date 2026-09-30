import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { hashPassword } from "@/server/password";

const port = 3197;
const baseUrl = `http://127.0.0.1:${port}`;

function quoteIdentifier(value: string) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Unsafe database identifier.");
  return `"${value}"`;
}

function databaseUrlFor(source: string, database: string) {
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

async function waitForServer(server: ChildProcess) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next.js test server exited with code ${server.exitCode}.`);
    try {
      await fetch(`${baseUrl}/api/auth/session`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Timed out waiting for the Next.js test server.");
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  if (process.platform === "win32" && server.pid) {
    spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    return;
  }
  server.kill("SIGTERM");
  await new Promise<void>((resolve) => server.once("exit", () => resolve()));
}

function cookieHeader(response: Response) {
  return response.headers.getSetCookie().map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function login(username: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, `login failed for ${username}`);
  return cookieHeader(response);
}

test("I2.5 movement endpoint allows Admin and denies USER over HTTP", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for HTTP integration tests");
    return;
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 14);
  const password = `Http-${suffix}-Password!`;
  const adminUsername = `it_http_admin_${suffix}`;
  const userUsername = `it_http_user_${suffix}`;
  const sourceId = `i2.5-http-${suffix}`;
  const sourceUrl = process.env.DATABASE_URL;
  const adminUrl = process.env.DATABASE_RESTORE_ADMIN_URL;
  if (!sourceUrl || !adminUrl) {
    t.skip("DATABASE_URL and DATABASE_RESTORE_ADMIN_URL are required for isolated HTTP integration tests");
    return;
  }
  const testDatabase = `pbi25${suffix}`;
  const testDatabaseUrl = databaseUrlFor(sourceUrl, testDatabase);
  const admin = new pg.Client({ connectionString: adminUrl });
  admin.on("error", () => undefined);
  let server: ChildProcess | undefined;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(testDatabase)} TEMPLATE ${quoteIdentifier(new URL(sourceUrl).pathname.slice(1))}`);

    const fixture = new pg.Client({ connectionString: testDatabaseUrl });
    fixture.on("error", () => undefined);
    await fixture.connect();
    const passwordHash = await hashPassword(password);
    const adminRow = await fixture.query<{ id: string }>(
      "INSERT INTO users(username, password_hash, role, updated_at) VALUES ($1, $2, 'ADMIN', CURRENT_TIMESTAMP) RETURNING id",
      [adminUsername, passwordHash],
    );
    await fixture.query(
      "INSERT INTO users(username, password_hash, role, updated_at) VALUES ($1, $2, 'USER', CURRENT_TIMESTAMP)",
      [userUsername, passwordHash],
    );
    const partRow = await fixture.query<{ id: string; code: string; name: string }>(
      "INSERT INTO spare_parts(code, name, selling_price, stock_on_hand, minimum_stock, updated_at) VALUES ($1, $2, 2500, 3, 0, CURRENT_TIMESTAMP) RETURNING id, code, name",
      [`SPHTTP${suffix}`, `HTTP Stock Card Test ${suffix}`],
    );
    await fixture.query(
      "INSERT INTO stock_movements(spare_part_id, movement_type, quantity, unit_cost, valuation_delta, source_type, source_id, actor_id) VALUES ($1, 'OPENING_STOCK', 3, 1500, 4500, 'INTEGRATION_TEST', $2, $3)",
      [partRow.rows[0]!.id, sourceId, adminRow.rows[0]!.id],
    );
    await fixture.end();

    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], {
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: testDatabaseUrl },
      stdio: "ignore",
      windowsHide: true,
    });
    await waitForServer(server);

    const adminCookies = await login(adminUsername, password);
    const adminResponse = await fetch(`${baseUrl}/api/admin/stock/movements?sparePartId=${partRow.rows[0]!.id}`, {
      headers: { cookie: adminCookies },
    });
    assert.equal(adminResponse.status, 200);
    const adminBody = await adminResponse.json() as { movements?: Array<Record<string, string | null>> };
    assert.ok(Array.isArray(adminBody.movements));
    assert.equal(adminBody.movements.length, 1);
    assert.deepEqual(adminBody.movements[0], {
      id: adminBody.movements[0]?.id,
      sparePartId: partRow.rows[0]!.id,
      code: partRow.rows[0]!.code,
      name: partRow.rows[0]!.name,
      type: "OPENING_STOCK",
      quantity: "3",
      unitCost: "1500",
      sourceType: "INTEGRATION_TEST",
      sourceId,
      occurredAt: adminBody.movements[0]?.occurredAt,
      valuationDelta: "4500",
      purchaseValueDelta: null,
    });

    const userCookies = await login(userUsername, password);
    const userResponse = await fetch(`${baseUrl}/api/admin/stock/movements?sparePartId=${partRow.rows[0]!.id}`, {
      headers: { cookie: userCookies },
    });
    assert.equal(userResponse.status, 403);
  } finally {
    if (server) await stopServer(server);
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [testDatabase]).catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(testDatabase)}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
});
