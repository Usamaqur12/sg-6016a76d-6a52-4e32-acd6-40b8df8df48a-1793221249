import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const releaseRoot = path.join(projectRoot, "cpanel-upload");

const requiredFiles = [
  ".env.example",
  "CPANEL_DEPLOYMENT.md",
  "SPORTS_PROVIDER_INTEGRATION.md",
  "next.config.mjs",
  "package-lock.json",
  "package.json",
  "postcss.config.mjs",
  "server.js",
  "tailwind.config.ts",
  "tsconfig.json",
];

const requiredDirectories = ["database", "public", "src", "supabase"];

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });

for (const file of requiredFiles) {
  await cp(path.join(projectRoot, file), path.join(releaseRoot, file));
}

for (const directory of requiredDirectories) {
  await cp(path.join(projectRoot, directory), path.join(releaseRoot, directory), {
    recursive: true,
  });
}

const files = await readdir(releaseRoot);
console.log(`cPanel upload folder ready: ${releaseRoot}`);
console.log(`Included top-level entries: ${files.sort().join(", ")}`);
