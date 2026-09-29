import "dotenv/config";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/server/password";
import { writeAudit } from "../src/server/audit";

const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!username || !password) throw new Error("Set BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD for this one-time command.");
if (username.length > 80 || password.length < 12) throw new Error("Username must be at most 80 characters and bootstrap password at least 12 characters.");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const bootstrapLock = new Client({ connectionString: process.env.DATABASE_URL, application_name: "ProjectBengkel bootstrap" });
try {
  await bootstrapLock.connect();
  await bootstrapLock.query("SELECT pg_advisory_lock($1, $2)", [48271, 19030]);
  const created = await prisma.$transaction(async (tx) => {
    const exists = await tx.user.findFirst({ where: { role: "ADMIN" }, select: { id: true } });
    if (exists) throw new Error("An Admin account already exists; bootstrap is disabled.");
    const user = await tx.user.create({ data: { username, passwordHash: await hashPassword(password), role: "ADMIN" } });
    await writeAudit(tx, { actorUsername: "SYSTEM", action: "INITIAL_ADMIN_CREATED", objectType: "USER", objectId: user.id.toString(), beforeAfter: { after: { username: user.username, role: user.role } } });
    return user;
  });
  console.log(`Initial Admin created with internal ID ${created.id.toString()}.`);
} finally {
  await bootstrapLock.query("SELECT pg_advisory_unlock($1, $2)", [48271, 19030]).catch(() => undefined);
  await bootstrapLock.end().catch(() => undefined);
  await prisma.$disconnect();
}
