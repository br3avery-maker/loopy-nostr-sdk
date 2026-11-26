import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Temporary local preview server for AI Studio runtime inspection.
// Excluded from npm package ("files" only packs "scripts/*.py").
// Safe to delete (along with the "dev" script in package.json) before release.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readPackageSummary() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return {
      name: String(pkg.name || 'sdk'),
      version: String(pkg.version || '0.0.0'),
      description: String(pkg.description || ''),
      exports: Object.keys(pkg.exports || {}),
    };
  } catch {
    return { name: '@chaoticka/nsite-loopy-sdk', version: 'unknown', description: '', exports: [] };
  }
}

function readAuditDoc() {
  try {
    return fs.readFileSync(path.join(ROOT, 'docs', 'BACKEND_AUDIT.md'), 'utf8');
  } catch {
    return 'docs/BACKEND_AUDIT.md not found.';
  }
}

function renderHtml(pkg, auditMarkdown) {
  const exportsList = pkg.exports
    .map((entry) => `<code>${escapeHtml(entry)}</code>`)
    .join(' ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(pkg.name)} — Temporary Local Audit Preview</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #111618;
      --panel: #182024;
      --border: #2a363c;
      --text: #e6edf0;
      --muted: #98a9b3;
      --accent: #22b8a6;
      --warn: #e09f3e;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.55;
    }
    main {
      max-width: 980px;
      margin: 0 auto;
      padding: 28px 20px 64px;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 18px;
      margin-bottom: 22px;
    }
    .tag {
      display: inline-block;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--warn);
      margin-bottom: 8px;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 24px;
      font-weight: 700;
    }
    .meta {
      color: var(--muted);
      font-size: 14px;
      margin: 0 0 12px;
    }
    .exports {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .exports code {
      background: var(--panel);
      border: 1px solid var(--border);
      color: var(--accent);
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 18px 20px;
    }
    section h2 {
      margin: 0 0 12px;
      font-size: 15px;
      color: var(--muted);
      font-weight: 600;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.55;
      color: var(--text);
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="tag">Temporary Preview Stub · Headless SDK</div>
      <h1>${escapeHtml(pkg.name)} @ ${escapeHtml(pkg.version)}</h1>
      <p class="meta">${escapeHtml(pkg.description)}</p>
      <div class="exports">${exportsList}</div>
    </header>
    <section>
      <h2>docs/BACKEND_AUDIT.md (live read-only view)</h2>
      <pre>${escapeHtml(auditMarkdown)}</pre>
    </section>
  </main>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  const method = req.method || 'GET';
  const pathname = (req.url || '/').split('?')[0];

  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  };

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      ...headers,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    });
    res.end();
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
    return;
  }

  if (pathname === '/favicon.ico') {
    res.writeHead(204, headers);
    res.end();
    return;
  }

  if (pathname === '/health' || pathname === '/api/status') {
    const pkg = readPackageSummary();
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    if (method === 'HEAD') {
      res.end();
      return;
    }
    res.end(JSON.stringify({ ok: true, temporaryPreview: true, package: pkg.name, version: pkg.version }));
    return;
  }

  if (pathname.startsWith('/api/')) {
    res.writeHead(404, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
    return;
  }

  const pkg = readPackageSummary();
  const audit = readAuditDoc();
  res.writeHead(200, {
    ...headers,
    'Content-Type': 'text/html; charset=utf-8',
  });
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(renderHtml(pkg, audit));
});

server.keepAliveTimeout = 1000;

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Temporary SDK audit preview ready at http://localhost:${PORT}/ (listening on ${HOST}:${PORT})`);
});
