import "dotenv/config";
import { prisma } from "../src/server/db";
import { restoreBackup } from "../src/server/backup";

const [mode, filename] = process.argv.slice(2);
if (!mode || !filename || !["expect-success", "expect-failure"].includes(mode)) {
  throw new Error("Usage: restore-isolated-worker <expect-success|expect-failure> <archive-name>");
}

try {
  const result = await restoreBackup(filename, { id: 0n, username: "RESTORE_TEST" });
  console.log(JSON.stringify({ result: "success", restored: result.restored }));
  if (mode === "expect-failure") process.exitCode = 1;
} catch {
  console.log(JSON.stringify({ result: "failure" }));
  if (mode === "expect-success") process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
