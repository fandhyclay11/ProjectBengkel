export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runScheduledBackupIfDue } = await import("@/server/backup");
  const initialCheck = setTimeout(() => { void runScheduledBackupIfDue(); }, 0);
  initialCheck.unref();
  const timer = setInterval(() => { void runScheduledBackupIfDue(); }, 24 * 60 * 60 * 1000);
  timer.unref();
}
