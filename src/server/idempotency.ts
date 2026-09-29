import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";

type Actor = { id: bigint };

export class IdempotencyError extends Error {
  constructor(readonly kind: "INVALID_KEY" | "CONFLICT", message: string) { super(message); }
}

function stable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

function requestHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}

function readExisting<T>(existing: { requestHash: string; response: Prisma.JsonValue } | null, hash: string): T | null {
  if (!existing) return null;
  if (existing.requestHash !== hash) throw new IdempotencyError("CONFLICT", "Kunci permintaan sudah digunakan untuk data yang berbeda.");
  return existing.response as T;
}

export async function executeIdempotent<T>(input: {
  actor: Actor;
  operation: string;
  key: string;
  payload: unknown;
  run: (tx: Prisma.TransactionClient) => Promise<T>;
  transaction?: Prisma.TransactionClient;
}): Promise<T> {
  const key = input.key.trim();
  if (!key || key.length > 200) throw new IdempotencyError("INVALID_KEY", "Kunci permintaan tidak valid.");
  const hash = requestHash(input.payload);
  const where = { actorId_operation_requestKey: { actorId: input.actor.id, operation: input.operation, requestKey: key } };
  const prior = readExisting<T>(await prisma.idempotencyRecord.findUnique({ where }), hash);
  if (prior !== null) return prior;

  try {
    const execute = async (tx: Prisma.TransactionClient) => {
      const existing = readExisting<T>(await tx.idempotencyRecord.findUnique({ where }), hash);
      if (existing !== null) return existing;
      // Reserve the key before side effects so a concurrent identical request waits for this transaction.
      const reservation = await tx.idempotencyRecord.create({
        data: { actorId: input.actor.id, operation: input.operation, requestKey: key, requestHash: hash, response: { state: "PENDING" } },
      });
      const result = await input.run(tx);
      const response = JSON.parse(JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value)) as Prisma.InputJsonValue;
      await tx.idempotencyRecord.update({ where: { id: reservation.id }, data: { response } });
      return result;
    };
    return input.transaction ? await execute(input.transaction) : await prisma.$transaction(execute);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const raced = readExisting<T>(await prisma.idempotencyRecord.findUnique({ where }), hash);
      if (raced !== null) return raced;
    }
    throw error;
  }
}
