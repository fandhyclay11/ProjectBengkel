import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, readdir, rm, stat, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Client, Pool } from "pg";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";

const LOCK_CLASS = 48271;
const LOCK_OBJECT = 19029;
const DUMP_PREFIX = "projectbengkel-";
const DUMP_SUFFIX = ".dump";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAINTENANCE_FILE = ".projectbengkel-maintenance";

function backupDirectory(): string {
  const configured = process.env.APP_BACKUP_DIR?.trim() || "./backups";
  const resolved = path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured);
  const publicDirectory = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "public");
  if (resolved === publicDirectory || resolved.startsWith(`${publicDirectory}${path.sep}`)) {
    throw new Error("Backup directory cannot be inside public/.");
  }
  return resolved;
}

function databaseUrl(databaseName?: string): URL {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is required.");
  const url = new URL(source);
  if (databaseName) url.pathname = `/${databaseName}`;
  return url;
}

function restoreAdminUrl(databaseName = "postgres"): URL {
  const source = process.env.DATABASE_RESTORE_ADMIN_URL;
  if (!source) throw new Error("A separate PostgreSQL restore administrator connection is required.");
  const url = new URL(source);
  url.pathname = `/${databaseName}`;
  return url;
}

function databaseRole(url: URL): string {
  const role = decodeURIComponent(url.username);
  if (!role || !/^[A-Za-z0-9_]+$/.test(role)) throw new Error("Database role must use letters, digits and underscores.");
  return role;
}

function pgEnvironment(url: URL): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (url.hostname) env.PGHOST = url.hostname;
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  if (url.searchParams.has("sslmode")) env.PGSSLMODE = url.searchParams.get("sslmode") ?? undefined;
  env.PGAPPNAME = "ProjectBengkel";
  return env;
}

function databaseName(url: URL): string {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name || !/^[A-Za-z0-9_]+$/.test(name)) throw new Error("Database name must use letters, digits and underscores.");
  return name;
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Unsafe PostgreSQL identifier.");
  return `"${value}"`;
}

async function runTool(executable: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", (error) => {
      console.error("PostgreSQL maintenance command could not start.", { executable, code: "code" in error ? error.code : undefined });
      reject(new Error("PostgreSQL command could not be started."));
    });
    child.once("close", (code) => {
      if (code === 0) resolve();
      else {
        console.error("PostgreSQL maintenance command failed.", { executable, exitCode: code });
        reject(new Error("PostgreSQL command failed."));
      }
    });
  });
}

async function acquireLock<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const maintenanceUrl = databaseUrl("postgres").toString();
  const client = new Client({ connectionString: maintenanceUrl, application_name: "ProjectBengkel maintenance" });
  await client.connect();
  try {
    const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1, $2) AS locked", [LOCK_CLASS, LOCK_OBJECT]);
    if (!result.rows[0]?.locked) throw new Error("Another backup or restore operation is already running.");
    try {
      return await work(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [LOCK_CLASS, LOCK_OBJECT]).catch(() => undefined);
    }
  } finally {
    await client.end();
  }
}

async function makeDumpLocked(): Promise<{ filename: string; sizeBytes: number }> {
  const directory = backupDirectory();
  await mkdir(/*turbopackIgnore: true*/ directory, { recursive: true, mode: 0o700 });
  const now = new Date();
  const stamp = now.toISOString().replaceAll(":", "").replaceAll("-", "").replace(/\.\d{3}Z$/, "Z");
  const filename = `${DUMP_PREFIX}${stamp}-${randomBytes(3).toString("hex")}${DUMP_SUFFIX}`;
  const file = path.join(directory, filename);
  const url = databaseUrl();
  try {
    const dbName = databaseName(url);
    await runTool(process.env.PG_DUMP_PATH || "pg_dump", ["--no-password", "--format=custom", `--file=${file}`, `--dbname=${dbName}`], pgEnvironment(url));
    const info = await stat(/*turbopackIgnore: true*/ file);
    await pruneOldBackupsLocked(directory, now.getTime());
    return { filename, sizeBytes: info.size };
  } catch (error) {
    await rm(/*turbopackIgnore: true*/ file, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function pruneOldBackupsLocked(directory: string, now = Date.now()): Promise<void> {
  const entries = await readdir(/*turbopackIgnore: true*/ directory, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.startsWith(DUMP_PREFIX) && entry.name.endsWith(DUMP_SUFFIX)).map(async (entry) => {
    const file = path.join(directory, entry.name);
    const info = await stat(/*turbopackIgnore: true*/ file);
    if (now - info.mtimeMs > RETENTION_MS) await unlink(/*turbopackIgnore: true*/ file);
  }));
}

export async function createManualBackup(actor: { id: bigint; username: string }) {
  return acquireLock(async () => {
    try {
      const backup = await makeDumpLocked();
      await prisma.$transaction((tx) => writeAudit(tx, {
        actorId: actor.id,
        actorUsername: actor.username,
        action: "BACKUP_SUCCEEDED",
        objectType: "DATABASE_BACKUP",
        objectId: backup.filename,
        context: { sizeBytes: backup.sizeBytes },
      }));
      return backup;
    } catch {
      await prisma.$transaction((tx) => writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "BACKUP_FAILED", objectType: "DATABASE_BACKUP" })).catch(() => undefined);
      throw new Error("Backup gagal. Periksa konfigurasi server dan log teknis.");
    }
  });
}

export async function listBackups() {
  const directory = backupDirectory();
  await mkdir(/*turbopackIgnore: true*/ directory, { recursive: true, mode: 0o700 });
  const entries = await readdir(/*turbopackIgnore: true*/ directory, { withFileTypes: true });
  const files = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.startsWith(DUMP_PREFIX) && entry.name.endsWith(DUMP_SUFFIX)).map(async (entry) => {
    const info = await stat(/*turbopackIgnore: true*/ path.join(directory, entry.name));
    return { filename: entry.name, sizeBytes: info.size, createdAt: info.mtime.toISOString() };
  }));
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return files;
}

async function restoreArchiveLocked(filename: string, actor: { id: bigint; username: string }) {
  const directory = backupDirectory();
  const normalizedName = path.basename(filename);
  if (normalizedName !== filename || normalizedName.startsWith(".") || normalizedName.includes("..")) throw new Error("Invalid restore file.");
  const archivePath = path.join(directory, normalizedName);
  const archiveInfo = await lstat(/*turbopackIgnore: true*/ archivePath).catch(() => null);
  if (!archiveInfo?.isFile() || archiveInfo.isSymbolicLink()) throw new Error("Restore file not found.");

  const appUrl = databaseUrl();
  const env = pgEnvironment(appUrl);
  await runTool(process.env.PG_RESTORE_PATH || "pg_restore", ["--list", archivePath], env);

  const target = databaseName(databaseUrl());
  const suffix = randomBytes(4).toString("hex");
  const stage = `${target.slice(0, 30)}_restore_${suffix}`;
  const previous = `${target.slice(0, 30)}_before_${suffix}`;
  const adminUrl = restoreAdminUrl();
  if (adminUrl.hostname !== appUrl.hostname || (adminUrl.port || "5432") !== (appUrl.port || "5432")) {
    throw new Error("The restore administrator must connect to the same PostgreSQL server as the application.");
  }
  const adminEnv = pgEnvironment(adminUrl);
  const appRole = databaseRole(appUrl);
  const maintenance = new Pool({ connectionString: adminUrl.toString(), max: 1, application_name: "ProjectBengkel restore" });
  let stageExists = false;
  let previousExists = false;
  let appDisconnected = false;
  const maintenancePath = path.join(directory, MAINTENANCE_FILE);
  let maintenanceMarkerCreated = false;
  try {
    const adminIdentity = await maintenance.query<{ is_superuser: boolean }>(
      "SELECT rolsuper AS is_superuser FROM pg_roles WHERE rolname = current_user",
    );
    if (!adminIdentity.rows[0]?.is_superuser) {
      throw new Error("The separate restore connection must use a PostgreSQL superuser for database swapping.");
    }

    await writeFile(/*turbopackIgnore: true*/ maintenancePath, JSON.stringify({ processId: process.pid, startedAt: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    maintenanceMarkerCreated = true;
    const before = await makeDumpLocked();
    await maintenance.query(`CREATE DATABASE ${quoteIdentifier(stage)} TEMPLATE template0`);
    stageExists = true;
    const stageUrl = databaseUrl(stage);
    await maintenance.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(stage)} TO ${quoteIdentifier(appRole)}`);
    const stageAdmin = new Pool({ connectionString: restoreAdminUrl(stage).toString(), max: 1, application_name: "ProjectBengkel restore staging" });
    try {
      await stageAdmin.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${quoteIdentifier(appRole)}`);
    } finally {
      await stageAdmin.end();
    }
    await runTool(process.env.PG_RESTORE_PATH || "pg_restore", ["--no-password", "--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${stage}`, `--role=${appRole}` , archivePath], adminEnv);

    const stagePool = new Pool({ connectionString: stageUrl.toString(), max: 1, application_name: "ProjectBengkel restore verification" });
    try {
      const result = await stagePool.query<{ admins: string; sessions: string; audits: string }>(
        "SELECT (SELECT COUNT(*) FROM users WHERE role = 'ADMIN')::text AS admins, to_regclass('public.sessions')::text AS sessions, to_regclass('public.audit_logs')::text AS audits",
      );
      if (Number(result.rows[0]?.admins ?? 0) < 1 || !result.rows[0]?.sessions || !result.rows[0]?.audits) throw new Error("Restore archive does not contain a valid application database.");
    } finally {
      await stagePool.end();
    }

    await prisma.$disconnect();
    appDisconnected = true;
    const connections = await maintenance.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [target]);
    if (Number(connections.rows[0]?.count ?? 0) > 0) throw new Error("Database still has active application connections; restore was stopped safely.");

    await maintenance.query(`ALTER DATABASE ${quoteIdentifier(target)} RENAME TO ${quoteIdentifier(previous)}`);
    previousExists = true;
    await maintenance.query(`ALTER DATABASE ${quoteIdentifier(stage)} RENAME TO ${quoteIdentifier(target)}`);
    stageExists = false;

    await prisma.$connect();
    appDisconnected = false;
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany();
      await writeAudit(tx, { actorUsername: actor.username, action: "RESTORE_SUCCEEDED", objectType: "DATABASE_BACKUP", objectId: normalizedName, context: { preRestoreBackup: before.filename } });
    });
    await maintenance.query(`DROP DATABASE ${quoteIdentifier(previous)}`);
    previousExists = false;
    return { restored: normalizedName, preRestoreBackup: before.filename };
  } catch {
    if (previousExists) {
      if (!appDisconnected) {
        await prisma.$disconnect().catch(() => undefined);
        appDisconnected = true;
      }
      const databases = async () => (await maintenance.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname = ANY($1::text[])", [[target, stage, previous]])).rows.map((row) => row.datname);
      const present: string[] = await databases().catch((): string[] => []);
      if (present.includes(target) && present.includes(stage)) {
        const failed = `${target.slice(0, 18)}_failed_${randomBytes(4).toString("hex")}`;
        await maintenance.query(`ALTER DATABASE ${quoteIdentifier(target)} RENAME TO ${quoteIdentifier(failed)}`).catch(() => undefined);
      } else if (present.includes(target) && !present.includes(stage)) {
        await maintenance.query(`ALTER DATABASE ${quoteIdentifier(target)} RENAME TO ${quoteIdentifier(stage)}`).then(() => { stageExists = true; }).catch(() => undefined);
      }
      const afterMove: string[] = await databases().catch((): string[] => []);
      if (previousExists && afterMove.includes(previous) && !afterMove.includes(target)) {
        await maintenance.query(`ALTER DATABASE ${quoteIdentifier(previous)} RENAME TO ${quoteIdentifier(target)}`).then(() => { previousExists = false; }).catch(() => undefined);
      }
      appDisconnected = true;
    }
    if (appDisconnected && !previousExists) {
      await prisma.$connect().catch(() => undefined);
      appDisconnected = false;
    }
    if (stageExists && !previousExists) await maintenance.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(stage)}`).catch(() => undefined);
    throw new Error("Restore gagal dan database sebelumnya dipertahankan. Periksa konfigurasi server dan log teknis.");
  } finally {
    if (maintenanceMarkerCreated && !previousExists) await unlink(/*turbopackIgnore: true*/ maintenancePath).catch(() => undefined);
    await maintenance.end();
  }
}

export async function restoreBackup(filename: string, actor: { id: bigint; username: string }) {
  try {
    return await acquireLock(async () => restoreArchiveLocked(filename, actor));
  } catch {
    await prisma.$transaction((tx) => writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "RESTORE_FAILED", objectType: "DATABASE_BACKUP", objectId: path.basename(filename) })).catch(() => undefined);
    throw new Error("Restore gagal dan database sebelumnya dipertahankan. Periksa konfigurasi server dan log teknis.");
  }
}

let scheduledBackupRunning = false;

export async function runScheduledBackupIfDue(propagateFailure = false) {
  if (scheduledBackupRunning) return;
  scheduledBackupRunning = true;
  try {
    const directory = backupDirectory();
    await mkdir(/*turbopackIgnore: true*/ directory, { recursive: true, mode: 0o700 });
    const backups = await listBackups();
    const last = backups[0] ? Date.parse(backups[0].createdAt) : 0;
    if (Date.now() - last < WEEK_MS) return;
    await acquireLock(async () => {
      const latest = await listBackups();
      const lastAfterLock = latest[0] ? Date.parse(latest[0].createdAt) : 0;
      if (Date.now() - lastAfterLock < WEEK_MS) return;
      const backup = await makeDumpLocked();
      await prisma.$transaction((tx) => writeAudit(tx, { actorUsername: "SYSTEM", action: "BACKUP_SUCCEEDED", objectType: "DATABASE_BACKUP", objectId: backup.filename, context: { sizeBytes: backup.sizeBytes, scheduled: true } }));
    });
  } catch {
    await prisma.$transaction((tx) => writeAudit(tx, { actorUsername: "SYSTEM", action: "BACKUP_FAILED", objectType: "DATABASE_BACKUP", context: { scheduled: true } })).catch(() => undefined);
    console.error("Scheduled database backup failed.");
    if (propagateFailure) throw new Error("Scheduled database backup failed.");
  } finally {
    scheduledBackupRunning = false;
  }
}
