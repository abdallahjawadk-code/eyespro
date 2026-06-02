/** Run async tasks in batches with jittered delays between batches. */
export async function runSpreadBatch<T>(
  fns: Array<() => Promise<T>>,
  opts: { concurrency?: number; spreadMs?: number } = {}
): Promise<T[]> {
  const concurrency = opts.concurrency ?? 3;
  const spreadMs = opts.spreadMs ?? 800;
  const results: T[] = [];

  for (let i = 0; i < fns.length; i += concurrency) {
    if (i > 0) {
      const jitter = Math.random() * spreadMs * 0.4;
      await new Promise((r) => setTimeout(r, spreadMs + jitter));
    }
    const batch = fns.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((fn) => fn()));
    results.push(...batchResults);
  }
  return results;
}
