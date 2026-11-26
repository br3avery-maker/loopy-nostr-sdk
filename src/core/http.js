/** Stateless, browser-safe HTTP primitives shared by Blossom, Nostr, and Nsite bricks. */

/**
 * Always invokes globalThis.fetch with globalThis as receiver so browsers never throw
 * TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation") when detached.
 */
export function defaultFetch(input, init) {
  if (typeof globalThis.fetch !== 'function') throw new TypeError('fetch transport required');
  return globalThis.fetch(input, init);
}

/** Create a standard Error enriched with machine-readable SDK metadata. */
export function sdkError(message, details = {}) {
  const err = new Error(String(message), details.cause !== undefined ? { cause: details.cause } : undefined);
  for (const key of ['code', 'stage', 'retryable', 'status', 'relay', 'server']) {
    if (details[key] !== undefined) err[key] = details[key];
  }
  return err;
}

/**
 * Bounded, cancellable, redirect-refusing HTTP fetch with streaming byte cap.
 * Stateless and runtime-independent; accepts any compatible fetcher brick.
 */
export async function boundedFetch(
  url,
  init = {},
  {
    fetcher = defaultFetch,
    timeoutMs = 15000,
    maxBytes = 1024 * 1024,
    signal,
    read = 'bytes',
    acceptRedirects = false,
  } = {}
) {
  if (typeof fetcher !== 'function') throw new TypeError('fetch transport required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new RangeError('Invalid timeoutMs');
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 512 * 1024 * 1024) {
    throw new RangeError('Invalid maxBytes');
  }
  if (!['none', 'bytes', 'text', 'json'].includes(read)) {
    throw new TypeError('Invalid read mode');
  }
  if (signal?.aborted) throw sdkError('Request cancelled', { code: 'cancelled', retryable: false });

  const controller = new AbortController();
  let timer;
  let reader;
  let timedOut = false;
  let onAbort;

  const deadline = new Promise((_, reject) => {
    onAbort = () => {
      controller.abort();
      reject(sdkError('Request cancelled', { code: 'cancelled', retryable: false }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(sdkError('HTTP request timeout', { code: 'timeout', retryable: true }));
    }, timeoutMs);
  });

  const execute = async () => {
    let response;
    try {
      response = await fetcher(url, {
        ...init,
        signal: controller.signal,
        redirect: acceptRedirects ? 'follow' : 'error',
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch (cause) {
      if (signal?.aborted) throw sdkError('Request cancelled', { code: 'cancelled', retryable: false, cause });
      if (timedOut) throw sdkError('HTTP request timeout', { code: 'timeout', retryable: true, cause });
      throw sdkError(cause?.message || 'HTTP request failed', { code: 'network', retryable: true, cause });
    }

    if (!response || typeof response !== 'object') {
      throw sdkError('Invalid HTTP response', { code: 'network', retryable: true });
    }
    const status = typeof response.status === 'number' ? response.status : (response.ok ? 200 : 500);
    if (!acceptRedirects && response.redirected) {
      throw sdkError('HTTP redirect refused', { code: 'redirect', status, retryable: false });
    }

    const base = { ok: Boolean(response.ok), status, headers: response.headers };
    if (read === 'none') {
      if (response.body?.cancel) {
        try { void response.body.cancel().catch(() => {}); } catch {}
      }
      return base;
    }

    const rawLength = response.headers?.get?.('content-length');
    if (typeof rawLength === 'string' && /^\d+$/.test(rawLength.trim())) {
      const declared = Number(rawLength.trim());
      if (declared > maxBytes) {
        if (response.body?.cancel) {
          try { void response.body.cancel().catch(() => {}); } catch {}
        }
        throw sdkError('HTTP response exceeds byte limit', { code: 'size-limit', status, retryable: false });
      }
    }

    let data;
    if (response.body?.getReader) {
      reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        const chunk = step.value instanceof Uint8Array
          ? step.value
          : ArrayBuffer.isView(step.value)
            ? new Uint8Array(step.value.buffer, step.value.byteOffset, step.value.byteLength)
            : new Uint8Array(step.value);
        total += chunk.byteLength;
        if (total > maxBytes) {
          throw sdkError('HTTP response exceeds byte limit', { code: 'size-limit', status, retryable: false });
        }
        chunks.push(chunk);
      }
      data = new Uint8Array(total);
      let pos = 0;
      for (const chunk of chunks) {
        data.set(chunk, pos);
        pos += chunk.byteLength;
      }
    } else if (typeof response.arrayBuffer === 'function') {
      const buf = await response.arrayBuffer();
      data = new Uint8Array(buf);
      if (data.byteLength > maxBytes) {
        throw sdkError('HTTP response exceeds byte limit', { code: 'size-limit', status, retryable: false });
      }
    } else if (read === 'json' && typeof response.json === 'function') {
      if (!base.ok) {
        try { return { ...base, json: await response.json() }; } catch { return { ...base, json: undefined }; }
      }
      try {
        const json = await response.json();
        return { ...base, json };
      } catch (cause) {
        throw sdkError('Invalid JSON HTTP response', { code: 'invalid-json', status, retryable: false, cause });
      }
    } else if ((read === 'text' || read === 'json') && typeof response.text === 'function') {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        throw sdkError('HTTP response exceeds byte limit', { code: 'size-limit', status, retryable: false });
      }
      if (read === 'text') return { ...base, text };
      if (!base.ok) {
        try { return { ...base, text, json: JSON.parse(text) }; } catch { return { ...base, text, json: undefined }; }
      }
      try {
        return { ...base, text, json: JSON.parse(text) };
      } catch (cause) {
        throw sdkError('Invalid JSON HTTP response', { code: 'invalid-json', status, retryable: false, cause });
      }
    } else {
      data = new Uint8Array(0);
    }

    if (read === 'bytes') return { ...base, data };
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: base.ok }).decode(data);
    } catch (cause) {
      throw sdkError('Invalid UTF-8 HTTP response', { code: 'invalid-utf8', status, retryable: false, cause });
    }
    if (read === 'text') return { ...base, data, text };
    if (!base.ok) {
      try { return { ...base, data, text, json: JSON.parse(text) }; } catch { return { ...base, data, text, json: undefined }; }
    }
    try {
      return { ...base, data, text, json: JSON.parse(text) };
    } catch (cause) {
      throw sdkError('Invalid JSON HTTP response', { code: 'invalid-json', status, retryable: false, cause });
    }
  };

  try {
    return await Promise.race([deadline, execute()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
    if (reader) {
      try { void reader.cancel().catch(() => {}); } catch {}
    }
  }
}
