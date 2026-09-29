import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "@/server/password";

test("password hash is salted and verifies only the original password", async () => {
  const first = await hashPassword("a-secure-test-password");
  const second = await hashPassword("a-secure-test-password");

  assert.notEqual(first, second);
  assert.equal(await verifyPassword("a-secure-test-password", first), true);
  assert.equal(await verifyPassword("a-different-password", first), false);
});

test("password verifier rejects malformed stored hashes", async () => {
  assert.equal(await verifyPassword("anything", "not-a-scrypt-hash"), false);
  assert.equal(await verifyPassword("anything", "scrypt$salt$bad"), false);
});
