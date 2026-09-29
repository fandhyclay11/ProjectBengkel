import "server-only";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { hashPassword, verifyPassword } from "@/server/password";
import { hashToken, newToken, sessionExpiry } from "@/server/auth";

const DUMMY_PASSWORD_HASH = `scrypt$ProjectBengkelLoginCheck$${Buffer.alloc(64).toString("base64url")}`;

export async function loginUser(username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (!user || !user.isActive || !passwordMatches) {
    await prisma.$transaction((tx) => writeAudit(tx, {
      actorId: user?.id,
      actorUsername: user?.username ?? username,
      action: "AUTH_LOGIN_FAILED",
      objectType: "USER",
      objectId: user?.id.toString(),
    }));
    return null;
  }

  const sessionToken = newToken();
  const csrfToken = newToken();
  await prisma.session.create({
    data: {
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      userId: user.id,
      userSessionVersion: user.sessionVersion,
      expiresAt: sessionExpiry(),
    },
  });
  return { user, sessionToken, csrfToken };
}

export async function changeOwnPassword(input: {
  userId: bigint;
  username: string;
  mustChangePassword: boolean;
  currentPassword?: string;
  newPassword: string;
}) {
  if (!input.mustChangePassword) {
    const current = await prisma.user.findUnique({ where: { id: input.userId }, select: { passwordHash: true } });
    if (!current || !input.currentPassword || !(await verifyPassword(input.currentPassword, current.passwordHash))) return false;
  }
  const passwordHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: input.userId }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: input.userId } });
    await writeAudit(tx, { actorId: input.userId, actorUsername: input.username, action: "USER_PASSWORD_CHANGED", objectType: "USER", objectId: input.userId.toString() });
  });
  return true;
}
