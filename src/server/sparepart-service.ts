import "server-only";
import { writeAudit } from "@/server/audit";
import { findNameConflict, findSimilarCandidates, findSpareParts, type SparePartRole } from "@/server/sparepart-repository";
import { executeIdempotent, IdempotencyError } from "@/server/idempotency";

type Actor = { id: bigint; username: string };
type PartInput = { name: string; sellingPrice: bigint; minimumStock: bigint };
type PartUpdate = Partial<PartInput> & { isActive?: boolean };

export class SparePartServiceError extends Error {
  constructor(readonly kind: "NOT_FOUND" | "DUPLICATE_NAME" | "SIMILAR_NAME" | "IDEMPOTENCY_CONFLICT" | "INVALID_KEY", message: string, readonly similarParts: Array<{ id: string; code: string; name: string }> = []) {
    super(message);
  }
}

function normalized(name: string) {
  return name.trim().toLocaleLowerCase("id-ID");
}

function editDistance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j += 1) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      rows[i]![j] = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        rows[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length]![b.length]!;
}

// Technical O-25 choice for this implementation: warn at normalized edit similarity >= 0.82.
function isSimilar(a: string, b: string) {
  const left = normalized(a);
  const right = normalized(b);
  if (left === right || Math.min(left.length, right.length) < 4) return false;
  return 1 - editDistance(left, right) / Math.max(left.length, right.length) >= 0.82;
}

async function assertNameAvailable(name: string, exceptId?: bigint, continueSimilarName = false) {
  const cleaned = name.trim();
  const duplicate = await findNameConflict(cleaned, exceptId);
  if (duplicate && normalized(duplicate.name) === normalized(cleaned)) {
    throw new SparePartServiceError("DUPLICATE_NAME", "Nama sparepart tersebut sudah digunakan.");
  }
  if (!continueSimilarName) {
    const candidates = await findSimilarCandidates(cleaned, exceptId);
    const similar = candidates.filter((candidate) => isSimilar(cleaned, candidate.name));
    if (similar.length) {
      throw new SparePartServiceError("SIMILAR_NAME", "Ada nama sparepart yang mirip. Periksa daftar lalu konfirmasi jika tetap ingin melanjutkan.", similar.map((part) => ({ ...part, id: part.id.toString() })));
    }
  }
  return cleaned;
}

export async function listSpareParts(role: SparePartRole) {
  return findSpareParts(role);
}

export async function createSparePart(input: PartInput, actor: Actor, key: string, continueSimilarName = false) {
  try {
    return await executeIdempotent({ actor, operation: "sparepart.create", key, payload: { ...input, continueSimilarName }, run: async (tx) => {
      const name = await assertNameAvailable(input.name, undefined, continueSimilarName);
      const [sequence] = await tx.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('sparepart_code_seq') AS value`;
      const code = `SP${sequence!.value.toString().padStart(6, "0")}`;
      const part = await tx.sparePart.create({
        data: { code, name, sellingPrice: input.sellingPrice, minimumStock: input.minimumStock },
      });
      await writeAudit(tx, {
        actorId: actor.id, actorUsername: actor.username, action: "SPAREPART_CREATED",
        objectType: "SPAREPART", objectId: part.id.toString(),
        beforeAfter: { after: { code, name, sellingPrice: part.sellingPrice.toString(), minimumStock: part.minimumStock.toString() } },
      });
      return part;
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new SparePartServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID_KEY", error.message);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new SparePartServiceError("DUPLICATE_NAME", "Nama sparepart tersebut sudah digunakan.");
    }
    throw error;
  }
}

export async function updateSparePart(id: bigint, input: PartUpdate, actor: Actor, key: string, continueSimilarName = false) {
  try {
    return await executeIdempotent({ actor, operation: "sparepart.update", key, payload: { id: id.toString(), ...input, continueSimilarName }, run: async (tx) => {
      const before = await tx.sparePart.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new SparePartServiceError("NOT_FOUND", "Sparepart tidak ditemukan.");
      const name = input.name === undefined ? undefined : await assertNameAvailable(input.name, id, continueSimilarName);
      const data = {
        ...(name === undefined ? {} : { name }),
        ...(input.sellingPrice === undefined ? {} : { sellingPrice: input.sellingPrice }),
        ...(input.minimumStock === undefined ? {} : { minimumStock: input.minimumStock }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };
      if (!Object.keys(data).length) return before;
      const updated = await tx.sparePart.update({ where: { id }, data });
      await writeAudit(tx, {
        actorId: actor.id, actorUsername: actor.username, action: "SPAREPART_UPDATED",
        objectType: "SPAREPART", objectId: id.toString(),
        beforeAfter: {
          before: { name: before.name, sellingPrice: before.sellingPrice.toString(), minimumStock: before.minimumStock.toString(), isActive: before.isActive },
          after: { name: updated.name, sellingPrice: updated.sellingPrice.toString(), minimumStock: updated.minimumStock.toString(), isActive: updated.isActive },
        },
      });
      return updated;
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new SparePartServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID_KEY", error.message);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      throw new SparePartServiceError("DUPLICATE_NAME", "Nama sparepart tersebut sudah digunakan.");
    }
    throw error;
  }
}

export async function deleteSparePart(id: bigint, actor: Actor, key: string) {
  try {
    return await executeIdempotent({ actor, operation: "sparepart.delete", key, payload: { id: id.toString() }, run: async (tx) => {
      const before = await tx.sparePart.findFirst({ where: { id, deletedAt: null } });
      if (!before) throw new SparePartServiceError("NOT_FOUND", "Sparepart tidak ditemukan.");
      const deleted = await tx.sparePart.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await writeAudit(tx, {
        actorId: actor.id, actorUsername: actor.username, action: "SPAREPART_REMOVED_FROM_ACTIVE_LIST",
        objectType: "SPAREPART", objectId: id.toString(),
        beforeAfter: { before: { code: before.code, name: before.name, isActive: before.isActive }, after: { deletedAt: deleted.deletedAt?.toISOString(), isActive: deleted.isActive } },
      });
      return { ok: true as const };
    } });
  } catch (error) {
    if (error instanceof IdempotencyError) throw new SparePartServiceError(error.kind === "CONFLICT" ? "IDEMPOTENCY_CONFLICT" : "INVALID_KEY", error.message);
    throw error;
  }
}
