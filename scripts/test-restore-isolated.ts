import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const sourceName = process.argv[2];
if (!sourceName || path.basename(sourceName) !== sourceName || !/^projectbengkel-[A-Za-z0-9T._-]+\.dump$/.test(sourceName)) {
  throw new Error("Provide a backup filename from the ProjectBengkel backup folder.");
}

const appSource = process.env.DATABASE_URL;
const restoreAdminSource = process.env.DATABASE_RESTORE_ADMIN_URL;
if (!appSource || !restoreAdminSource) throw new Error("DATABASE_URL and DATABASE_RESTORE_ADMIN_URL are required.");

const appBase = new URL(appSource);
const adminBase = new URL(restoreAdminSource);
if (appBase.hostname !== adminBase.hostname || (appBase.port || "5432") !== (adminBase.port || "5432")) {
  throw new Error("The application and restore administrator must use the same PostgreSQL server.");
}
const appRole = decodeURIComponent(appBase.username);
if (!/^[A-Za-z0-9_]+$/.test(appRole)) throw new Error("The application database role has an unsupported name.");
const suffix = randomBytes(4).toString("hex");
const prefix = `pbrt${suffix}`;
const successTarget = `${prefix}_ok`;
const failureTarget = `${prefix}_fail`;
const failureSource = `${prefix}_src`;
const backupRoot = path.resolve(process.cwd(), "backups");
const testDirectory = path.join(backupRoot, `${prefix}_files`);
if (!testDirectory.startsWith(`${backupRoot}${path.sep}`)) throw new Error("Unsafe isolated restore test directory.");
const sourceDirectory = path.resolve(process.cwd(), process.env.APP_BACKUP_DIR?.trim() || "./backups");
const sourceArchive = path.join(sourceDirectory, sourceName);
await stat(sourceArchive);
await mkdir(testDirectory, { recursive: false });
await copyFile(sourceArchive, path.join(testDirectory, sourceName));
process.env.APP_BACKUP_DIR = testDirectory;

function urlFor(source: URL, dbName: string): URL {
  const result = new URL(source);
  result.pathname = `/${dbName}`;
  return result;
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Unsafe database identifier.");
  return `"${value}"`;
}

async function grantApplicationAccess(admin: pg.Client, dbName: string): Promise<void> {
  await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(dbName)} TO ${quoteIdentifier(appRole)}`);
  const db = new pg.Client({ connectionString: urlFor(adminBase, dbName).toString() });
  try {
    await db.connect();
    await db.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quoteIdentifier(appRole)}`);
  } finally {
    await db.end().catch(() => undefined);
  }
}

async function createDatabase(admin: pg.Client, dbName: string): Promise<void> {
  await admin.query(`CREATE DATABASE ${quoteIdentifier(dbName)} TEMPLATE template0 OWNER ${quoteIdentifier(appRole)}`);
  await grantApplicationAccess(admin, dbName);
}

function toolEnv(url: URL): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGAPPNAME: "ProjectBengkel isolated restore verification",
  };
}

function runTool(executable: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(executable, args, { env, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error || result.status !== 0) throw new Error("A PostgreSQL verification utility failed.");
  return result.stdout;
}

function runRestoreWorker(mode: "expect-success" | "expect-failure", dbName: string, filename: string): { result: string } {
  const result = spawnSync(
    process.execPath,
    ["./node_modules/tsx/dist/cli.mjs", "scripts/restore-isolated-worker.ts", mode, filename],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: urlFor(appBase, dbName).toString(), APP_BACKUP_DIR: testDirectory },
      encoding: "utf8",
      windowsHide: true,
      timeout: 180_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error || result.status !== 0) throw new Error("An isolated restore worker did not complete as expected.");
  const payload = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!payload) throw new Error("Isolated restore worker returned no result.");
  return JSON.parse(payload) as { result: string };
}

const adminUrl = urlFor(adminBase, "postgres");
const admin = new pg.Client({ connectionString: adminUrl.toString(), application_name: "ProjectBengkel restore verification setup" });
let adminConnected = false;
const appTargets: string[] = [];
const results: Record<string, string> = {};

try {
  await admin.connect();
  adminConnected = true;
  const roles = await admin.query<{ admin_is_superuser: boolean; app_is_superuser: boolean; app_createdb: boolean }>(
    "SELECT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS admin_is_superuser, (SELECT rolsuper FROM pg_roles WHERE rolname=$1) AS app_is_superuser, (SELECT rolcreatedb FROM pg_roles WHERE rolname=$1) AS app_createdb",
    [appRole],
  );
  assert.equal(roles.rows[0]?.admin_is_superuser, true, "separate restore credential must be a superuser");
  assert.equal(roles.rows[0]?.app_is_superuser, false, "application role must remain non-superuser");
  assert.equal(roles.rows[0]?.app_createdb, false, "application role must remain without CREATEDB");

  const existing = await admin.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE left(datname, length($1)) = $1",
    [prefix],
  );
  assert.equal(existing.rowCount, 0, "isolated test database prefix must be unused");

  const archivePath = path.join(testDirectory, sourceName);
  runTool(process.env.PG_RESTORE_PATH || "pg_restore", ["--list", archivePath], toolEnv(appBase));

  await createDatabase(admin, successTarget);
  appTargets.push(successTarget);
  const successSeed = new pg.Client({ connectionString: urlFor(appBase, successTarget).toString() });
  try {
    await successSeed.connect();
    await successSeed.query("CREATE TABLE restore_test_sentinel(value text PRIMARY KEY)");
    await successSeed.query("INSERT INTO restore_test_sentinel(value) VALUES ('original-test-database')");
  } finally {
    await successSeed.end().catch(() => undefined);
  }

  const successRun = runRestoreWorker("expect-success", successTarget, sourceName);
  assert.equal(successRun.result, "success", "valid application backup should restore into isolated database");
  const successVerify = new pg.Client({ connectionString: urlFor(appBase, successTarget).toString() });
  try {
    await successVerify.connect();
    const q = await successVerify.query<{ admins: number; sessions: string | null; audits: string | null; restored_audit: number; sentinel: string | null }>(
      "SELECT (SELECT COUNT(*)::int FROM users WHERE role='ADMIN') AS admins, to_regclass('public.sessions')::text AS sessions, to_regclass('public.audit_logs')::text AS audits, (SELECT COUNT(*)::int FROM audit_logs WHERE action='RESTORE_SUCCEEDED') AS restored_audit, to_regclass('public.restore_test_sentinel')::text AS sentinel",
    );
    assert.ok(q.rows[0]!.admins >= 1, "restored database should contain Admin");
    assert.ok(q.rows[0]!.sessions && q.rows[0]!.audits, "restored auth and audit tables should exist");
    assert.equal(q.rows[0]!.restored_audit, 1, "successful restore should leave an audit record");
    assert.equal(q.rows[0]!.sentinel, null, "isolated target should have been replaced by the backup");
  } finally {
    await successVerify.end().catch(() => undefined);
  }
  results.restoreIntoIsolatedDatabase = "PASS";

  await createDatabase(admin, failureTarget);
  appTargets.push(failureTarget);
  const failureSeed = new pg.Client({ connectionString: urlFor(appBase, failureTarget).toString() });
  try {
    await failureSeed.connect();
    await failureSeed.query("CREATE TABLE restore_test_sentinel(value text PRIMARY KEY)");
    await failureSeed.query("INSERT INTO restore_test_sentinel(value) VALUES ('must-survive-failed-restore')");
  } finally {
    await failureSeed.end().catch(() => undefined);
  }

  await createDatabase(admin, failureSource);
  appTargets.push(failureSource);
  const malformed = new pg.Client({ connectionString: urlFor(appBase, failureSource).toString() });
  try {
    await malformed.connect();
    await malformed.query("CREATE TABLE users(id bigint NOT NULL, role text NOT NULL)");
    await malformed.query("INSERT INTO users(id, role) VALUES (999999, 'ADMIN')");
    await malformed.query("CREATE VIEW sessions AS SELECT 1::bigint AS id");
    await malformed.query("CREATE TABLE audit_logs(id bigserial PRIMARY KEY, actor_id bigint, actor_username_snapshot varchar(80), action varchar(100) NOT NULL, object_type varchar(100), object_id varchar(100), before_after jsonb, context jsonb, created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  } finally {
    await malformed.end().catch(() => undefined);
  }
  const failedArchiveName = "restore-failure-fixture.dump";
  runTool(process.env.PG_DUMP_PATH || "pg_dump", ["--no-password", "--format=custom", `--file=${path.join(testDirectory, failedArchiveName)}`, `--dbname=${failureSource}`], toolEnv(urlFor(appBase, failureSource)));
  runTool(process.env.PG_RESTORE_PATH || "pg_restore", ["--list", path.join(testDirectory, failedArchiveName)], toolEnv(appBase));

  const failureRun = runRestoreWorker("expect-failure", failureTarget, failedArchiveName);
  assert.equal(failureRun.result, "failure", "malformed application archive should be rejected");
  const failureVerify = new pg.Client({ connectionString: urlFor(appBase, failureTarget).toString() });
  try {
    await failureVerify.connect();
    const sentinel = await failureVerify.query<{ value: string }>("SELECT value FROM restore_test_sentinel");
    assert.equal(sentinel.rows[0]?.value, "must-survive-failed-restore", "failed restore must return isolated target to its prior database");
  } finally {
    await failureVerify.end().catch(() => undefined);
  }
  results.failedRestoreRollback = "PASS";

  const after = await admin.query<{ datname: string }>(
    "SELECT datname FROM pg_database WHERE left(datname, length($1)) = $1",
    [prefix],
  );
  assert.ok(after.rows.every((row) => appTargets.includes(row.datname)), "restore staging/previous databases should be cleaned up");
  console.log(JSON.stringify({ isolatedRestoreTests: "PASS", applicationRoleCreatedb: false, ...results }));
} finally {
  if (adminConnected) {
    const allTestDatabases = await admin.query<{ datname: string }>(
      "SELECT datname FROM pg_database WHERE left(datname, length($1)) = $1",
      [prefix],
    ).catch(() => ({ rows: [] as { datname: string }[] }));
    for (const row of allTestDatabases.rows) {
      await admin.query(`DROP DATABASE ${quoteIdentifier(row.datname)}`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
  }
  await rm(testDirectory, { recursive: true, force: true });
}
