const arg = (name: string, def: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
const url = arg('url', 'http://127.0.0.1:8080/healthz');
const total = Math.max(1, Math.min(200_000, Number(arg('n', '1000'))));
const concurrency = Math.max(1, Math.min(500, Number(arg('c', '25'))));
const timeoutMs = Number(arg('timeout', '5000'));
let next = 0;
const latencies: number[] = [];
let errors = 0; const statuses = new Map<number, number>();
const start = performance.now();
async function worker(): Promise<void> {
  while (true) {
    const i = next++;
    if (i >= total) return;
    const t0 = performance.now();
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      await res.arrayBuffer();
      latencies.push(performance.now() - t0);
      statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
      if (res.status >= 500) errors++;
    } catch {
      errors++;
      latencies.push(performance.now() - t0);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const elapsed = performance.now() - start;
latencies.sort((a, b) => a - b);
const p = (q: number): number => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))] ?? 0;
console.log(`LOADTEST · ${total} request · ${concurrency} luồng · ${elapsed.toFixed(0)}ms`);
console.log(`  RPS ${(total / (elapsed / 1000)).toFixed(1)} · lỗi ${errors} · status ${[...statuses.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}`);
console.log(`  latency p50 ${p(0.5).toFixed(1)}ms · p95 ${p(0.95).toFixed(1)}ms · p99 ${p(0.99).toFixed(1)}ms · max ${(latencies.at(-1) ?? 0).toFixed(1)}ms`);
if (errors > 0) process.exit(1);

export {};
