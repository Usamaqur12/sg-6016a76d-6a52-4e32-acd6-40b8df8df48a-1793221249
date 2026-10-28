const base = (process.argv[2] || process.env.TEST_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const routes = ["/", "/sports", "/live", "/account/wallet", "/admin/login"];
let failures = 0;
for (const route of routes) {
  try {
    const response = await fetch(`${base}${route}`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const okay = response.status >= 200 && response.status < 400;
    console.log(`${okay ? "PASS" : "FAIL"} ${response.status} ${route}`);
    if (!okay) failures += 1;
  } catch (error) {
    failures += 1; console.log(`FAIL ${route} ${error instanceof Error ? error.message : error}`);
  }
}
if (failures) process.exitCode = 1;

