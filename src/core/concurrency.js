import { assertSafeInt } from './guards.js';
import { sdkError } from './http.js';

/** Stateless bounded-concurrency mapper preserving exact input order and AbortSignal cancellation. */
export async function mapLimit(items, concurrency, worker, { signal } = {}) {
  if (!Array.isArray(items)) throw new TypeError('Items array expected');
  assertSafeInt(concurrency, { min: 1, max: 64, label: 'concurrency' });
  if (typeof worker !== 'function') throw new TypeError('Worker function expected');
  if (signal?.aborted) throw sdkError('Operation cancelled', { code: 'cancelled', retryable: false });
  if (!items.length) return [];

  const results = new Array(items.length);
  const limit = Math.min(concurrency, items.length);
  let nextIndex = 0;
  let failed = false;

  async function runWorker() {
    while (!failed) {
      if (signal?.aborted) {
        failed = true;
        throw sdkError('Operation cancelled', { code: 'cancelled', retryable: false });
      }
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}
