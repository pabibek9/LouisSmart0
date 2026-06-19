import { defineConfig, loadEnv } from 'vite';
import https from 'https';
import http from 'http';

// Helper: build the /api/config JSON response from server-side env vars
function buildConfigResponse(env) {
  return JSON.stringify({
    apiKey: env.FIREBASE_API_KEY || '',
    authDomain: env.FIREBASE_AUTH_DOMAIN || '',
    projectId: env.FIREBASE_PROJECT_ID || '',
    storageBucket: env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env.FIREBASE_APP_ID || '',
  });
}

// Helper: handle /api/config requests (serves Firebase config from server-side env)
function handleApiConfig(req, res, configJson) {
  if (req.url === '/api/config' || req.url.startsWith('/api/config?')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(configJson);
    return true;
  }
  return false;
}

// Helper: handle /api/chat proxy requests
function handleApiChat(req, res, webhookTarget, webhookPath) {
  if (req.url === '/api/chat' || req.url.startsWith('/api/chat?')) {
    const targetUri = new URL(webhookPath, webhookTarget);
    const isHttps = targetUri.protocol === 'https:';
    const proxyReq = (isHttps ? https : http).request(
      {
        method: req.method,
        hostname: targetUri.hostname,
        port: targetUri.port || (isHttps ? 443 : 80),
        path: targetUri.pathname + targetUri.search,
        headers: { ...req.headers, host: targetUri.hostname }
      },
      (proxyRes) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );
    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Proxy error: ' + err.message }));
    });
    req.pipe(proxyReq);
    return true;
  }
  return false;
}

function createPlugin(env) {
  const configJson = buildConfigResponse(env);
  const webhookTarget = env.N8N_WEBHOOK_URL || 'https://vmi3182726.contaboserver.net';
  const webhookPath = env.N8N_WEBHOOK_PATH || '/webhook/4f4322b3-30eb-4d63-b7ea-d9d18558772c';

  return {
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

      // Serve Firebase config from server-side env (never in client bundle)
      if (handleApiConfig(req, res, configJson)) return;

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

      // Serve Firebase config from server-side env (never in client bundle)
      if (handleApiConfig(req, res, configJson)) return;

      // Proxy /api/chat requests to n8n webhook (hides real URL from browser)
      if (handleApiChat(req, res, webhookTarget, webhookPath)) return;

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
}

export default defineConfig(({mode}) => {
  // Load ALL env vars (empty prefix = read everything, not just VITE_)
  const env = loadEnv(mode, process.cwd(), '');

  const webhookTarget = env.N8N_WEBHOOK_URL || 'https://vmi3182726.contaboserver.net';
  const webhookPath = env.N8N_WEBHOOK_PATH || '/webhook/4f4322b3-30eb-4d63-b7ea-d9d18558772c';

  return {
  root: '.',
  publicDir: 'public',
  plugins: [createPlugin(env)],
  server: {
    port: 5173,
    host: true,
    open: '/login',
    allowedHosts: true,
    strictPort: false,
    proxy: {
      // Main chat proxy — hides the real n8n webhook URL from the browser
      '/api/chat': {
        target: webhookTarget,
        changeOrigin: true,
        secure: true,
        timeout: 600000,
        proxyTimeout: 600000,
        rewrite: () => webhookPath,
      },
      // Proxy n8n test webhooks (server-to-server, no CORS)
      '/n8n-webhook-test': {
        target: webhookTarget,
        changeOrigin: true,
        secure: true,
        timeout: 600000,
        proxyTimeout: 600000,
        rewrite: (path) => path.replace(/^\/n8n-webhook-test/, '/webhook-test'),
      },
      // Proxy n8n production webhooks (server-to-server, no CORS)
      '/n8n-webhook': {
        target: webhookTarget,
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
    sourcemap: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        login: 'login.html',
        chat: 'chat.html'
      }
    },
    minify: 'esbuild',
    esbuild: {
      drop: ['console', 'debugger']
    }
  }
};
});

