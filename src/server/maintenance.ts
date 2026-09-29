import { access, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const MAINTENANCE_FILE = ".projectbengkel-maintenance";

function maintenanceFile(): string {
  const configured = process.env.APP_BACKUP_DIR?.trim() || "./backups";
  return path.join(path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured), MAINTENANCE_FILE);
}

export async function backupMaintenanceActive(): Promise<boolean> {
  const file = maintenanceFile();
  try {
    await access(/*turbopackIgnore: true*/ file);
    const marker = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as { processId?: number };
    if (!Number.isInteger(marker.processId) || !marker.processId) return true;
    try {
      process.kill(marker.processId, 0);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") {
        await unlink(/*turbopackIgnore: true*/ file).catch(() => undefined);
        return false;
      }
      return true;
    }
  } catch {
    return false;
  }
}
