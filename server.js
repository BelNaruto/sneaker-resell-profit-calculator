#!/usr/bin/env node
/**
 * Sneaker Resell Profit Calculator – tiny zero-dependency server
 *
 * Serves the web app and proxies two calls to the Sneaker Database – StockX API
 * so your RapidAPI key never reaches the browser.
 *
 * API:     https://rapidapi.com/belchiorarkad-FqvHs2EDOtP/api/sneaker-database-stockx
 * Support: Telegram @pintoflow
 *
 *   RAPIDAPI_KEY=your_key node server.js     -> live data
 *   node server.js                           -> demo mode with sample data
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const KEY = process.env.RAPIDAPI_KEY || '';
const HOST = 'sneaker-database-stockx.p.rapidapi.com';
const DEMO = !KEY || process.env.DEMO === '1';
const PUBLIC = path.join(__dirname, 'public');
const cache = new Map(); // key -> { t, status, body }
const TTL = { '/stockx/product-by-style': 12 * 3600e3, '/productprice': 5 * 60e3 };

async function upstream(route, params) {
  const url = new URL(`https://${HOST}${route}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const ck = url.toString();
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.t < (TTL[route] || 60e3)) return hit;
  const res = await fetch(url, { headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': KEY } });
  const body = await res.text();
  const out = { t: Date.now(), status: res.status, body };
  if (res.ok || res.status === 404) cache.set(ck, out); // cache misses too: don't retry 404s
  return out;
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname === '/api/config') return send(res, 200, JSON.stringify({ demo: DEMO }));
      if (u.pathname === '/api/lookup') {
        const styleId = (u.searchParams.get('styleId') || '').trim();
        if (!styleId) return send(res, 400, JSON.stringify({ message: 'styleId is required' }));
        if (DEMO) return send(res, 200, fs.readFileSync(path.join(__dirname, 'demo-data.json')));
        const [product, prices] = await Promise.all([
          upstream('/stockx/product-by-style', { styleId }),
          upstream('/productprice', { styleId }),
        ]);
        if (product.status === 404 && prices.status === 404)
          return send(res, 404, JSON.stringify({ message: `No product found for ${styleId}` }));
        const parse = (r) => { try { const j = JSON.parse(r.body); return j?.data ?? j; } catch { return null; } };
        return send(res, 200, JSON.stringify({ product: product.status === 200 ? parse(product) : null, prices: prices.status === 200 ? parse(prices) : null }));
      }
      const file = path.join(PUBLIC, u.pathname === '/' ? 'index.html' : path.normalize(u.pathname));
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    } catch (e) {
      send(res, 502, JSON.stringify({ message: e.message }));
    }
  })
  .listen(PORT, () => console.log(`Resell calculator on http://localhost:${PORT}${DEMO ? '  (DEMO mode – sample data, set RAPIDAPI_KEY for live prices)' : ''}`));
