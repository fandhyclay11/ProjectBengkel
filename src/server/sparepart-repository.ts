import "server-only";
import { prisma } from "@/server/db";

export type SparePartRole = "ADMIN" | "USER";

export async function findSpareParts(role: SparePartRole) {
  const where = role === "ADMIN" ? { deletedAt: null } : { deletedAt: null, isActive: true };
  const parts = await prisma.sparePart.findMany({ where, orderBy: [{ name: "asc" }, { id: "asc" }] });
  return parts.map((part) => role === "ADMIN"
    ? {
        id: part.id.toString(), code: part.code, name: part.name,
        sellingPrice: part.sellingPrice.toString(), latestBuyPrice: part.latestBuyPrice?.toString() ?? null,
        averageCost: part.averageCost?.toString() ?? null, currentStock: part.stockOnHand.toString(),
        minimumStock: part.minimumStock.toString(), isActive: part.isActive,
      }
    : {
        id: part.id.toString(), code: part.code, name: part.name,
        currentStock: part.stockOnHand.toString(),
      });
}

export async function findSparePart(id: bigint) {
  return prisma.sparePart.findFirst({ where: { id, deletedAt: null } });
}

export async function findNameConflict(name: string, exceptId?: bigint) {
  return prisma.sparePart.findFirst({
    where: {
      ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
      name: { equals: name, mode: "insensitive" },
    },
  });
}

export async function findSimilarCandidates(name: string, exceptId?: bigint) {
  return prisma.sparePart.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      ...(exceptId === undefined ? {} : { id: { not: exceptId } }),
    },
    select: { id: true, code: true, name: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}
