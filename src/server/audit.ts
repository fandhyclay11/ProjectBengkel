import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

type AuditInput = {
  actorId?: bigint | null;
  actorUsername?: string | null;
  action: string;
  objectType?: string | null;
  objectId?: string | null;
  beforeAfter?: Prisma.InputJsonValue | null;
  context?: Prisma.InputJsonValue | null;
};

export async function writeAudit(tx: Prisma.TransactionClient, input: AuditInput) {
  return tx.auditLog.create({
    data: {
      actorId: input.actorId ?? null,
      actorUsernameSnapshot: input.actorUsername ?? null,
      action: input.action,
      objectType: input.objectType ?? null,
      objectId: input.objectId ?? null,
      beforeAfter: input.beforeAfter ?? undefined,
      context: input.context ?? undefined,
    },
  });
}

export async function listAuditEvents(limit: number, beforeId?: bigint) {
  const rows = await prisma.auditLog.findMany({
    where: beforeId === undefined ? undefined : { id: { lt: beforeId } },
    take: limit,
    orderBy: [{ id: "desc" }],
    select: { id: true, actorId: true, actorUsernameSnapshot: true, action: true, objectType: true, objectId: true, beforeAfter: true, context: true, createdAt: true },
  });
  return rows.map((row) => ({ ...row, id: row.id.toString(), actorId: row.actorId?.toString() ?? null }));
}

export async function deleteAuditEvent(id: bigint, actor: { id: bigint; username: string }) {
  return prisma.$transaction(async (tx) => {
    const entry = await tx.auditLog.findUnique({ where: { id } });
    if (!entry) return false;
    await tx.auditDeletionTrace.create({ data: { actorId: actor.id, actorUsernameSnapshot: actor.username, deletedAuditId: entry.id, deletedAction: entry.action, deletedObjectType: entry.objectType, deletedObjectId: entry.objectId } });
    await tx.auditLog.delete({ where: { id: entry.id } });
    return true;
  });
}
