// Isolated local preview: no .dev.vars, persisted CRM data or external network.
import { Buffer } from 'node:buffer';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';

const bundle = await build({
  entryPoints: ['worker/index.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['cloudflare:workers'],
  define: { 'import.meta.env.DEV': 'true' },
});
const flags = [
  'META_INTEGRATION_ENABLED',
  'META_DEMO_MODE',
  'META_MESSENGER_ENABLED',
  'META_LEADS_ENABLED',
  'META_ADS_READ_ENABLED',
  'META_ADS_WRITE_ENABLED',
  'META_AI_ENABLED',
  'META_PAGE_CONTENT_ENABLED',
];
const runtime = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-10-09',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: { DB: 'isolated-meta-demo' },
    r2Buckets: ['PRODUCT_IMAGES'],
    durableObjects: { CHAT_ROOM: { className: 'ChatRoom', useSQLite: true } },
    outboundService: async () => {
      throw new Error('External calls are disabled in Meta Demo preview.');
    },
    serviceBindings: {
      ASSETS: async () => new globalThis.Response('Not found', { status: 404 }),
    },
    bindings: {
      ENVIRONMENT: 'development',
      LOCAL_MOCK_EMAIL: 'demo@example.test',
      AUTH_ADMIN_EMAIL: 'demo@example.test',
      ALLOWED_EMAILS: 'demo@example.test',
      AI_MODEL: '',
      AI_BASE_URL: '',
      MAX_UPLOAD_MB: '10',
      BUSINESS_TIMEZONE: 'Asia/Bangkok',
      META_LIVE_ACTIVATION_CONFIRMED: 'false',
      ...Object.fromEntries(flags.map((flag) => [flag, 'true'])),
    },
  }),
);
const sql = readdirSync('drizzle/migrations')
  .sort()
  .map((file) => readFileSync('drizzle/migrations/' + file, 'utf8'))
  .join('\n')
  .replace(/^--.*$/gm, '')
  .replace(/\n/g, ' ');
await (await runtime.getD1Database('DB')).exec(sql);
const server = await createServer({
  configFile: false,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'isolated-meta-api',
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/api/')) return next();
          try {
            const chunks = [];
            for await (const chunk of req) chunks.push(chunk);
            const response = await runtime.dispatchFetch(
              'http://localhost:4178' + req.url,
              {
                method: req.method,
                headers: req.headers,
                body: ['GET', 'HEAD'].includes(req.method)
                  ? undefined
                  : Buffer.concat(chunks),
              },
            );
            res.statusCode = response.status;
            for (const [key, value] of response.headers)
              res.setHeader(key, value);
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch {
            res.statusCode = 503;
            res.end('Isolated preview unavailable');
          }
        });
      },
    },
  ],
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
});
await server.listen();
console.log('Isolated Meta Demo: http://localhost:4178/meta/inbox');
const close = async () => {
  await server.close();
  await runtime.dispose();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
