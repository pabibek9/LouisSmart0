import { defineConfig } from 'vite';
import https from 'https';
import http from 'http';

const htmlRewritePlugin = {
  name: 'html-rewrite-plugin',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      // Redirect / or /index.html to /login
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }

      // Rewrite /login to /login.html internally for Vite
      if (req.url === '/login' || req.url.startsWith('/login?')) {
        const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        req.url = '/login.html' + query;
      }

      // Rewrite /chat/{chat_id} or /chat to /chat.html internally for Vite
      if (req.url === '/chat' || req.url.startsWith('/chat/') || req.url.startsWith('/chat?')) {
        const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        req.url = '/chat.html' + query;
      }

      // Handle OPTIONS preflight - CORS headers for all routes
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
      
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Proxy /api/upload requests to bypass CORS
      if (req.url.startsWith('/api/upload')) {
        const url = new URL(req.url, 'http://localhost:5173');
        const targetUrl = url.searchParams.get('url');

        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing URL parameter' }));
          return;
        }

        // SSRF Protection: Block private/internal IPs and restrict to allowed hosts
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

        console.log(`🔄 [PROXY] Forwarding ${req.method} to: ${targetUrl}`);

        const targetUri = new URL(targetUrl);
        const isHttps = targetUri.protocol === 'https:';

        const proxyReq = (isHttps ? https : http).request(
          {
            method: req.method,
            hostname: targetUri.hostname,
            port: targetUri.port || (isHttps ? 443 : 80),
            path: targetUri.pathname + targetUri.search,
            headers: { ...req.headers, host: undefined }
          },
          (proxyRes) => {
            // Add CORS headers to response from webhook
            if (allowedOrigins.includes(reqOrigin)) {
              res.setHeader('Access-Control-Allow-Origin', reqOrigin);
            } else {
              res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
            }
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Mime-Type, Content-Length, Authorization');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('X-Proxied-By', 'Vite Dev Server');
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );

        proxyReq.on('error', (err) => {
          console.error('❌ [PROXY] Error:', err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
        });

        req.pipe(proxyReq);
        return;
      }

      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, res, next) => {
      // Redirect / or /index.html to /login
      if (req.url === '/' || req.url === '/index.html') {
        res.writeHead(302, { Location: '/login' });
        res.end();
        return;
      }

      // Rewrite /login to /login.html internally for Vite
      if (req.url === '/login' || req.url.startsWith('/login?')) {
        const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        req.url = '/login.html' + query;
      }

      // Rewrite /chat/{chat_id} or /chat to /chat.html internally for Vite
      if (req.url === '/chat' || req.url.startsWith('/chat/') || req.url.startsWith('/chat?')) {
        const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        req.url = '/chat.html' + query;
      }

      // Handle OPTIONS preflight - CORS headers for all routes
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
      
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Proxy /api/upload requests to bypass CORS
      if (req.url.startsWith('/api/upload')) {
        const url = new URL(req.url, 'http://localhost:5173');
        const targetUrl = url.searchParams.get('url');

        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing URL parameter' }));
          return;
        }

        // SSRF Protection: Block private/internal IPs and restrict to allowed hosts
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

        console.log(`🔄 [PROXY] Forwarding ${req.method} to: ${targetUrl}`);

        const targetUri = new URL(targetUrl);
        const isHttps = targetUri.protocol === 'https:';

        const proxyReq = (isHttps ? https : http).request(
          {
            method: req.method,
            hostname: targetUri.hostname,
            port: targetUri.port || (isHttps ? 443 : 80),
            path: targetUri.pathname + targetUri.search,
            headers: { ...req.headers, host: undefined }
          },
          (proxyRes) => {
            // Add CORS headers to response from webhook
            if (allowedOrigins.includes(reqOrigin)) {
              res.setHeader('Access-Control-Allow-Origin', reqOrigin);
            } else {
              res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
            }
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Mime-Type, Content-Length, Authorization');
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('X-Proxied-By', 'Vite Preview Server');
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
          }
        );

        proxyReq.on('error', (err) => {
          console.error('❌ [PROXY] Error:', err.message);
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
        });

        req.pipe(proxyReq);
        return;
      }

      next();
    });
  }
};

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [htmlRewritePlugin],
  server: {
    port: 5173,
    host: true,
    open: '/login',
    allowedHosts: true,
    strictPort: false,
    proxy: {
      // Proxy n8n test webhooks (server-to-server, no CORS)
      '/n8n-webhook-test': {
        target: 'https://vmi3182726.contaboserver.net',
        changeOrigin: true,
        secure: true,
        timeout: 600000,
        proxyTimeout: 600000,
        rewrite: (path) => path.replace(/^\/n8n-webhook-test/, '/webhook-test'),
      },
      // Proxy n8n production webhooks (server-to-server, no CORS)
      '/n8n-webhook': {
        target: 'https://vmi3182726.contaboserver.net',
        changeOrigin: true,
        secure: true,
        timeout: 600000,
        proxyTimeout: 600000,
        rewrite: (path) => path.replace(/^\/n8n-webhook/, '/webhook'),
      },
    }
  },
  preview: {
    port: 5173,
    host: true,
    allowedHosts: true
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        login: 'login.html',
        chat: 'chat.html'
      }
    }
  }
});
