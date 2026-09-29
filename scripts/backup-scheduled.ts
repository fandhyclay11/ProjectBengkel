import "dotenv/config";
import { prisma } from "../src/server/db";
import { runScheduledBackupIfDue } from "../src/server/backup";

try {
  await runScheduledBackupIfDue(true);
} finally {
  await prisma.$disconnect();
}
