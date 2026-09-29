# Project Bengkel

Local-first web application for a workshop. The host runs the web app and PostgreSQL; browser clients use the web app and never connect directly to PostgreSQL.

## Phase 1 development setup

- Windows host with Node.js 24.11 or newer and PostgreSQL installed locally.
- Create a PostgreSQL role and an empty `projectbengkel` database. Keep the database port bound to the host; do not expose it to LAN clients.
- Copy `.env.example` to `.env` and replace the database connection credentials. Keep `.env` private and out of source control.
- In PowerShell, run `npm.cmd ci`, `npm.cmd run db:generate`, then `npm.cmd run db:migrate`.
- Create the first Admin once, using the account details only in the current PowerShell process:

  ```powershell
  $env:BOOTSTRAP_ADMIN_USERNAME = 'admin'
  $securePassword = Read-Host 'Initial Admin password' -AsSecureString
  $passwordPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
      $env:BOOTSTRAP_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPtr)
      npm.cmd run db:bootstrap-admin
  } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPtr)
      Remove-Item Env:BOOTSTRAP_ADMIN_PASSWORD -ErrorAction SilentlyContinue
      Remove-Item Env:BOOTSTRAP_ADMIN_USERNAME -ErrorAction SilentlyContinue
  }
  ```

- Start locally with `npm.cmd run dev`. Production V1 is started manually by Admin and is not configured to auto-start.

## Backups

- Install PostgreSQL client utilities on the host so `pg_dump` and `pg_restore` are available. Set `PG_DUMP_PATH` or `PG_RESTORE_PATH` in `.env` if they are not on `PATH`.
- Manual backup is an Admin-only API operation. Backup files are kept under `APP_BACKUP_DIR` (default `./backups`) on the same host, are not downloadable through the app, and are pruned after 30 days.
- Register the weekly Windows Task Scheduler job by running `scripts/register-weekly-backup.ps1` from the project directory. It runs Sunday at 02:00 local server time, starts the backup worker without starting the web app, and catches up after a missed run when the host is available.
- Restore accepts a PostgreSQL custom archive already present in the backup folder. It is inspected and restored into a staging database before the active database is switched. Restore stops new app requests temporarily, makes a pre-restore backup, and requires a strong confirmation.
- Restore requires `DATABASE_RESTORE_ADMIN_URL` in the private local `.env`, pointing to a separate PostgreSQL superuser connection. The ordinary `projectbengkel` application role is not granted `CREATEDB`; the restore-only credential is used for staging and database swap operations, while restored objects are assigned to the application role. Never commit this credential.

## Current limitations

Phase 1 foundation is in progress. Business modules are not implemented. Keep LAN binding, firewall and HTTPS setup for the deployment task; do not expose PostgreSQL directly to LAN clients.
