const base = (process.argv[2] || process.env.TEST_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const requests = Math.min(Math.max(Number(process.argv[3] || 100), 1), 5000);
const concurrency = Math.min(Math.max(Number(process.argv[4] || 20), 1), 200);
const durations = []; let cursor = 0; let failures = 0;
async function worker() {
  while (cursor < requests) {
    const index = cursor++; const route = index % 2 ? "/sports" : "/"; const started = performance.now();
    try { const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(15_000) }); if (!response.ok) failures += 1; await response.arrayBuffer(); }
    catch { failures += 1; }
    durations.push(performance.now() - started);
  }
}
const started = performance.now(); await Promise.all(Array.from({ length: concurrency }, worker));
durations.sort((a,b) => a-b); const elapsed = performance.now() - started;
const percentile = (value) => durations[Math.min(Math.floor(durations.length * value), durations.length - 1)] || 0;
console.log(JSON.stringify({ requests, concurrency, failures, seconds: Number((elapsed/1000).toFixed(2)), requestsPerSecond: Number((requests/(elapsed/1000)).toFixed(2)), p50Ms: Number(percentile(.5).toFixed(1)), p95Ms: Number(percentile(.95).toFixed(1)), p99Ms: Number(percentile(.99).toFixed(1)) }, null, 2));
if (failures) process.exitCode = 1;

