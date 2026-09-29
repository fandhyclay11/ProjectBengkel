import "dotenv/config";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "@/server/db";
import { changeOwnPassword, loginUser } from "@/server/auth-service";
import { deleteAuditEvent, listAuditEvents } from "@/server/audit";
import { createUser, updateUser } from "@/server/user-service";
import { hashPassword } from "@/server/password";

test("database auth, account lifecycle, and audit flow", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL is required for database integration tests");
    return;
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const adminName = `it_admin_${suffix}`;
  const userName = `it_user_${suffix}`;
  const initialPassword = `Initial-${suffix}-Pass!`;
  const resetPassword = `Reset-${suffix}-Pass!`;
  const changedPassword = `Changed-${suffix}-Pass!`;
  const admin = await prisma.user.create({
    data: { username: adminName, role: "ADMIN", passwordHash: await hashPassword(initialPassword) },
  });
  let userId: bigint | undefined;
  let auditId: bigint | undefined;

  try {
    const user = await createUser(
      { username: userName, role: "USER", password: initialPassword },
      { id: admin.id, username: admin.username },
    );
    userId = user.id;

    const login = await loginUser(userName, initialPassword);
    assert.ok(login, "active user should log in");
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 1);

    await updateUser(user.id, { action: "deactivate" }, { id: admin.id, username: admin.username });
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0, "deactivation revokes sessions");
    assert.equal(await loginUser(userName, initialPassword), null, "disabled user cannot log in");

    await updateUser(user.id, { action: "activate" }, { id: admin.id, username: admin.username });
    await loginUser(userName, initialPassword);
    await updateUser(user.id, { action: "reset-password", password: resetPassword }, { id: admin.id, username: admin.username });
    const resetUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(resetUser.mustChangePassword, true);
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0, "password reset revokes sessions");
    assert.ok(await loginUser(userName, resetPassword), "reset password should allow login");

    assert.equal(await changeOwnPassword({ userId: user.id, username: userName, mustChangePassword: true, newPassword: changedPassword }), true);
    const changedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(changedUser.mustChangePassword, false);
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0, "password change revokes sessions");
    assert.ok(await loginUser(userName, changedPassword), "changed password should allow login");

    const userAuditActions = await prisma.auditLog.findMany({
      where: { objectId: user.id.toString() },
      select: { action: true },
    });
    const recordedActions = new Set(userAuditActions.map((entry) => entry.action));
    for (const action of ["USER_CREATED", "USER_DEACTIVATED", "USER_ACTIVATED", "USER_PASSWORD_RESET", "USER_PASSWORD_CHANGED"]) {
      assert.ok(recordedActions.has(action), `sensitive action ${action} should be audited`);
    }

    const audit = await prisma.$transaction((tx) => tx.auditLog.create({
      data: { actorId: admin.id, actorUsernameSnapshot: admin.username, action: "INTEGRATION_AUDIT", objectType: "INTEGRATION_TEST", objectId: suffix },
    }));
    auditId = audit.id;
    const listed = await listAuditEvents(100);
    assert.ok(listed.some((entry) => entry.id === audit.id.toString()), "Admin audit query should return saved event");
    assert.equal(await deleteAuditEvent(audit.id, { id: admin.id, username: admin.username }), true);
    assert.equal(await prisma.auditLog.findUnique({ where: { id: audit.id } }), null);
    assert.equal(await prisma.auditDeletionTrace.count({ where: { actorId: admin.id, deletedAuditId: audit.id } }), 1,
      "audit deletion should leave a separate technical trace");
  } finally {
    const userIds = userId === undefined ? [admin.id] : [admin.id, userId];
    await prisma.auditDeletionTrace.deleteMany({ where: { actorId: admin.id } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: userIds } },
          { objectId: { in: userIds.map(String) } },
          ...(auditId === undefined ? [] : [{ id: auditId }]),
        ],
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});
