// Lokaler Testserver wie in Produktion: App aus public/ und API /api/* auf einem Port (8080)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import worker from '../worker/src/index.js';
import { makeD1 } from '../worker/test/d1-shim.mjs';
if (process.env.FAKE_DRIVE !== '0') await import('./fake-drive.mjs');
if (process.env.FAKE_AI !== '0') await import('./fake-ai.mjs');
const root = new URL('../public/', import.meta.url).pathname;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const ASSETS = { async fetch(req) {
  const p = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^\/+/, '') || 'index.html';
  try { return new Response(await readFile(join(root, p)), { headers: { 'Content-Type': types[extname(p)] || 'application/octet-stream' } }); }
  catch { return new Response('nicht gefunden', { status: 404 }); }
} };
const env = { DB: makeD1(), TEACHER_CODE: 'LEHRER2345XY', ALLOWED_ORIGINS: 'http://localhost:8080', ASSETS };
if (process.env.FAKE_AI !== '0') env.ANTHROPIC_API_KEY = 'fake';
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const r = await worker.fetch(new Request('http://localhost:8080' + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8080);
console.log('bereit auf http://localhost:8080');
