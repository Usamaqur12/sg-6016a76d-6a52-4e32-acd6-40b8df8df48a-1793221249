import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const migrationsDirectory = path.join(projectRoot, "supabase", "migrations");
const databaseDirectory = path.join(projectRoot, "database");

await mkdir(databaseDirectory, { recursive: true });

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+.*\.sql$/i.test(name))
  .sort((left, right) => left.localeCompare(right));

if (migrationFiles.length === 0) {
  throw new Error("No Supabase migrations were found.");
}

const sections = [];
for (const file of migrationFiles) {
  const source = await readFile(path.join(migrationsDirectory, file), "utf8");
  sections.push(`\n-- ============================================================================\n-- BEGIN MIGRATION: ${file}\n-- ============================================================================\n\n${source.trim()}\n\n-- END MIGRATION: ${file}\n`);
}

const latestVersion = migrationFiles.at(-1).replace(/\.sql$/i, "");
const generatedAt = new Date().toISOString();
const installer = `-- PrimeBet complete Supabase/PostgreSQL installer
-- Generated: ${generatedAt}
-- Migration count: ${migrationFiles.length}
-- Latest migration: ${latestVersion}
--
-- IMPORTANT: Run this only in a NEW/EMPTY Supabase project from SQL Editor.
-- For an existing database, apply only missing files from supabase/migrations.

SET statement_timeout = 0;
SET lock_timeout = '10s';

BEGIN;

DO $primebet_preflight$
BEGIN
  IF to_regclass('public.bets') IS NOT NULL
     OR to_regclass('public.profiles') IS NOT NULL THEN
    RAISE EXCEPTION 'PrimeBet tables already exist. Use ordered migrations instead of the complete installer.';
  END IF;
END
$primebet_preflight$;
${sections.join("")}

CREATE TABLE IF NOT EXISTS public.primebet_schema_meta (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  schema_version TEXT NOT NULL,
  migration_count INTEGER NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.primebet_schema_meta (singleton, schema_version, migration_count)
VALUES (TRUE, '${latestVersion}', ${migrationFiles.length})
ON CONFLICT (singleton) DO UPDATE SET
  schema_version = EXCLUDED.schema_version,
  migration_count = EXCLUDED.migration_count,
  installed_at = NOW();

REVOKE ALL ON public.primebet_schema_meta FROM PUBLIC, anon, authenticated;

COMMIT;

SELECT schema_version, migration_count, installed_at
FROM public.primebet_schema_meta;
`;

await writeFile(path.join(databaseDirectory, "01_primebet_complete_schema.sql"), installer, "utf8");
await copyFile(path.join(projectRoot, "supabase", "seed.sql"), path.join(databaseDirectory, "02_optional_demo_seed.sql"));
await copyFile(path.join(projectRoot, "supabase", "tests", "launch_smoke.sql"), path.join(databaseDirectory, "04_verify_installation.sql"));

console.log(`Database installer ready: ${path.join(databaseDirectory, "01_primebet_complete_schema.sql")}`);
console.log(`Included ${migrationFiles.length} migrations through ${latestVersion}.`);
