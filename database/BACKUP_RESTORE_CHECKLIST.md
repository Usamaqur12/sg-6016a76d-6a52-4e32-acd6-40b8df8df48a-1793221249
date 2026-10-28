# Database backup and restore checklist

Complete this before enabling production registrations or money movement.

- Enable Supabase database backups suitable for the selected plan.
- Record the project reference, database region and responsible operator.
- Export a pre-launch logical backup and store it encrypted outside cPanel.
- Create a separate restore-test Supabase project.
- Restore the latest backup into the test project.
- Run `04_verify_installation.sql` against the restored project.
- Confirm Auth users, private KYC storage, bets, wallet journals, ledger postings,
  settlements, notifications and audit logs are present.
- Record restore start/end time and any manual steps.
- Repeat the restore drill after major schema changes and on a regular schedule.

