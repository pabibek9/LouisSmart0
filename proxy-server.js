/**
 * Simple CORS Proxy for Webhook Uploads
 * 
 * This server proxies image uploads through localhost to bypass CORS errors
 * Add this as middleware to your Vite dev server
 * 
 * Usage:
 * 1. Add to vite.config.js:
 *    import setupProxy from './proxy-server.js';
 *    
 *    export default {
 *      server: {
 *        middlewares: [setupProxy()]
 *      }
 *    }
 * 
 * 2. OR run standalone:
 *    node proxy-server.js
 */

export default function setupProxy() {
  return (req, res, next) => {
    // Set CORS headers on all responses
    const allowedOrigins = ['http://localhost:5173', 'http://localhost:3001'];
    const reqOrigin = req.headers.origin;
    if (allowedOrigins.includes(reqOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Mime-Type, Content-Length, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // Handle OPTIONS preflight requests
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Proxy /api/upload requests
    if (req.url.startsWith('/api/upload')) {
      const url = new URL(req.url, 'http://localhost:5173');
      const targetUrl = url.searchParams.get('url');

      if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing URL parameter' }));
        return;
      }

      // SSRF Protection: Block private/internal IP addresses
      try {
        const parsedTarget = new URL(targetUrl);
        const blockedPatterns = /^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|127\.|0\.|169\.254\.|localhost|\[::1\])/i;
        if (blockedPatterns.test(parsedTarget.hostname)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal addresses are not allowed' }));
          return;
        }
      } catch (urlErr) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid target URL' }));
        return;
      }

      console.log(`🔄 Proxying ${req.method} request to: ${targetUrl}`);

      // Forward request to actual webhook
      const targetUri = new URL(targetUrl);
      const proxy = targetUri.protocol === 'https:' ? require('https') : require('http');

      const proxyReq = proxy.request(
        {
          method: req.method,
          hostname: targetUri.hostname,
          port: targetUri.port || (targetUri.protocol === 'https:' ? 443 : 80),
          path: targetUri.pathname + targetUri.search,
          headers: {
            ...req.headers,
            // Remove host to let it be set by the proxy
            host: undefined,
          },
        },
        (proxyRes) => {
          // CORS headers already set above
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        }
      );

      proxyReq.on('error', (err) => {
        console.error('❌ Proxy error:', err);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
      });

      req.pipe(proxyReq);
      return;
    }

    next();
  };
}

// Standalone server (for testing)
if (import.meta.url === `file://${process.argv[1]}`) {
  const http = require('http');
  const middleware = setupProxy();

  const server = http.createServer((req, res) => {
    middleware(req, res, () => {
      res.writeHead(404);
      res.end('Not Found');
    });
  });

  server.listen(3001, () => {
    console.log('🚀 Proxy server running on http://localhost:3001');
    console.log('Use /api/upload?url=<webhook-url> to proxy requests');
  });
}
