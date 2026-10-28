const base = (process.argv[2] || process.env.TEST_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const response = await fetch(`${base}/`, { signal: AbortSignal.timeout(10_000) });
const required = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
};
let failed = false;
for (const [name, expected] of Object.entries(required)) {
  const actual = response.headers.get(name);
  const okay = actual === expected;
  console.log(`${okay ? "PASS" : "FAIL"} ${name}: ${actual || "missing"}`);
  if (!okay) failed = true;
}
const poweredBy = response.headers.get("x-powered-by");
console.log(`${poweredBy ? "FAIL" : "PASS"} x-powered-by: ${poweredBy || "hidden"}`);
if (poweredBy) failed = true;
if (failed) process.exitCode = 1;

