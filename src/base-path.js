'use strict';

/**
 * Optional path prefix for a second instance behind nginx (e.g. APP_BASE_PATH=/test).
 * Production leaves APP_BASE_PATH unset: no rewrite, cookie path stays /.
 *
 * nginx may either strip the prefix (proxy_pass …/) or keep it. Requests that
 * still contain the prefix are stripped here. HTML/JS/JSON responses and
 * redirects get the prefix added so the browser stays under /test and does
 * not call the production site at /.
 */

const fs = require('fs');
const path = require('path');

const REWRITE_EXT = new Set(['.html', '.js', '.css', '.svg']);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function getBasePath() {
  let p = String(process.env.APP_BASE_PATH || '').trim();
  if (!p || p === '/') return '';
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9][A-Za-z0-9_-]*$/.test(p)) {
    console.warn('[NOORTEC] APP_BASE_PATH ignoriert (nur ein Pfadsegment, z. B. /test):', p);
    return '';
  }
  return p;
}

/**
 * Prefix root-absolute app URLs inside HTML/JS/JSON text.
 * Leaves https:// URLs, protocol-relative //, and already-prefixed paths alone.
 */
function rewritePublicText(text, base) {
  const root = base || getBasePath();
  if (!root || typeof text !== 'string' || text.indexOf('/') === -1) return text;
  const already = root.slice(1);
  const pathRe = /^(api\/|login\.html|offer(?=[/?#'"`]|$)|admin(?=[/?#'"`]|$)|profile(?=[/?#'"`]|$)|layout-editor\.js|datenblaetter\/|offer-assets\/|index\.html)/;
  return text.replace(/(['"`])\/(?!\/)/g, (match, q, offset, src) => {
    const rest = src.slice(offset + 2);
    if (
      rest.startsWith(`${already}/`)
      || rest.startsWith(already + q)
      || rest.startsWith(`${already}?`)
      || rest.startsWith(`${already}#`)
    ) {
      return match;
    }
    if (rest.startsWith(q)) return `${q}${root}/`;
    if (pathRe.test(rest)) return `${q}${root}/`;
    return match;
  });
}

function contentTypeIsRewritable(type) {
  const t = String(type || '').toLowerCase();
  return t.includes('text/html')
    || t.includes('javascript')
    || t.includes('text/css')
    || t.includes('application/json')
    || t.includes('image/svg');
}

function prefixRedirect(url, base) {
  if (!base || typeof url !== 'string') return url;
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) return url;
  return base + url;
}

function publicRewriteMiddleware(publicDir) {
  const root = path.resolve(publicDir);
  return function rewritePublicAssets(req, res, next) {
    if (!getBasePath()) return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel = req.path || '';
    try { rel = decodeURIComponent(rel); } catch (_) { return next(); }
    if (!rel.startsWith('/') || rel.includes('\0')) return next();
    const ext = path.extname(rel).toLowerCase();
    if (!REWRITE_EXT.has(ext)) return next();
    const abs = path.resolve(root, `.${rel}`);
    if (abs !== root && !abs.startsWith(root + path.sep)) return next();
    fs.readFile(abs, 'utf8', (err, text) => {
      if (err) return next();
      res.setHeader('Content-Type', MIME[ext]);
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'HEAD') return res.end();
      // res.send (patched by installBasePath) rewrites once. Do not rewrite here too.
      res.send(text);
    });
  };
}

function installBasePath(app) {
  const base = getBasePath();
  if (!base) return base;

  app.use((req, res, next) => {
    const url = req.url || '';
    if (url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) {
      const stripped = url.slice(base.length) || '/';
      req.url = stripped.startsWith('/') ? stripped : `/${stripped}`;
    }

    const origRedirect = res.redirect.bind(res);
    res.redirect = function redirectWithBase(status, url) {
      if (typeof status === 'string') {
        url = status;
        status = 302;
      }
      return origRedirect(status, prefixRedirect(url, base));
    };

    const origSend = res.send.bind(res);
    res.send = function sendWithBase(body) {
      const type = res.getHeader('Content-Type');
      if (typeof body === 'string' && contentTypeIsRewritable(type)) {
        body = rewritePublicText(body, base);
      }
      return origSend(body);
    };

    const origSendFile = res.sendFile.bind(res);
    res.sendFile = function sendFileWithBase(filePath, options, callback) {
      let opts = options;
      let cb = callback;
      if (typeof options === 'function') {
        cb = options;
        opts = undefined;
      }
      const ext = path.extname(String(filePath || '')).toLowerCase();
      if (!REWRITE_EXT.has(ext)) return origSendFile(filePath, opts, cb);
      fs.readFile(filePath, 'utf8', (err, text) => {
        if (err) return origSendFile(filePath, opts, cb);
        res.setHeader('Content-Type', MIME[ext]);
        res.setHeader('Cache-Control', 'no-store');
        try {
          origSend(rewritePublicText(text, base));
          if (typeof cb === 'function') cb();
        } catch (e) {
          if (typeof cb === 'function') cb(e);
          else next(e);
        }
      });
      return res;
    };

    next();
  });

  console.log(`[NOORTEC] APP_BASE_PATH=${base} — Testinstanz, Production-Root bleibt unangetastet`);
  return base;
}

module.exports = {
  getBasePath,
  rewritePublicText,
  prefixRedirect,
  installBasePath,
  publicRewriteMiddleware,
};
