import "server-only";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { hashPassword } from "@/server/password";

type Actor = { id: bigint; username: string };
type UserAction = { action: "activate" | "deactivate" } | { action: "reset-password"; password: string };

export class UserServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function listUsers() {
  return prisma.user.findMany({ orderBy: [{ username: "asc" }, { id: "asc" }], select: { id: true, username: true, role: true, isActive: true, mustChangePassword: true, createdAt: true } });
}

export async function createUser(input: { username: string; role: "ADMIN" | "USER"; password: string }, actor: Actor) {
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { username: input.username, role: input.role, passwordHash } });
    await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: "USER_CREATED", objectType: "USER", objectId: created.id.toString(), beforeAfter: { after: { username: created.username, role: created.role, isActive: created.isActive } } });
    return created;
  });
}

export async function updateUser(id: bigint, input: UserAction, actor: Actor) {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new UserServiceError("User tidak ditemukan.", 404);
  if (input.action === "deactivate" && target.role === "ADMIN") throw new UserServiceError("Admin tidak dapat dinonaktifkan.", 409);
  if (input.action === "deactivate" && target.id === actor.id) throw new UserServiceError("Akun sendiri tidak dapat dinonaktifkan.", 409);
  if (input.action === "reset-password" && target.role !== "USER") throw new UserServiceError("Password Admin tidak dapat direset melalui aksi ini.", 409);

  return prisma.$transaction(async (tx) => {
    const data = input.action === "reset-password"
      ? { passwordHash: await hashPassword(input.password), mustChangePassword: true, sessionVersion: { increment: 1 } }
      : { isActive: input.action === "activate", sessionVersion: { increment: 1 } };
    const user = await tx.user.update({ where: { id: target.id }, data });
    if (input.action !== "activate") await tx.session.deleteMany({ where: { userId: target.id } });
    await writeAudit(tx, { actorId: actor.id, actorUsername: actor.username, action: input.action === "reset-password" ? "USER_PASSWORD_RESET" : input.action === "deactivate" ? "USER_DEACTIVATED" : "USER_ACTIVATED", objectType: "USER", objectId: target.id.toString(), beforeAfter: { before: { isActive: target.isActive, mustChangePassword: target.mustChangePassword }, after: { isActive: user.isActive, mustChangePassword: user.mustChangePassword } } });
    return user;
  });
}
