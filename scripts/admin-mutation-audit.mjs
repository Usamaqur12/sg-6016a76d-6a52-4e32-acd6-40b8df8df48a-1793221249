import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const roots = ["src/pages/admin", "src/components/admin"];
const allowed = new Set([
  // An admin may update only their own display profile through RLS.
  "src/pages/admin/settings.tsx",
]);
const mutationPattern = /\.from\([^)]{1,160}\)\s*\.\s*(insert|update|delete|upsert)\s*\(/g;
const violations = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      const normalized = relative(process.cwd(), path).replaceAll("\\", "/");
      if (allowed.has(normalized)) continue;
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(mutationPattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${normalized}:${line} uses browser-side Supabase ${match[1]}`);
      }
    }
  }
}

for (const root of roots) await walk(root);

if (violations.length) {
  console.error("Admin mutation boundary violations:\n" + violations.map((item) => `- ${item}`).join("\n"));
  console.error("Move sensitive mutations into an authenticated /api/admin route or a security-definer RPC with explicit role checks and auditing.");
  process.exit(1);
}

console.log("Admin mutation boundary audit passed.");
