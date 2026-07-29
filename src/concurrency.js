// Runs `fn` over `items` with at most `limit` calls in flight at once —
// keeps outbound FMP requests from bursting all at once as the universe
// grows, instead of unbounded Promise.all over every item.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

module.exports = { mapWithConcurrency };
