// Omar-only build overlay; application workflows are not rewritten here.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {hassanBranding} from './branding.mjs';
import {collectIsolationInventory, assertIsolationInventory, assertIsolationSource} from './isolation-source-guard.mjs';

export const workspace = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const directory = path.dirname(fileURLToPath(import.meta.url));
const reviewedSources = JSON.parse(fs.readFileSync(path.join(directory, 'frontend-source-inventory.json'), 'utf8'));
export const contract = JSON.parse(fs.readFileSync(path.join(directory, 'frontend-contract.json'), 'utf8'));
export function assertContract(value) {
  if (value.backend !== 'http://127.0.0.1:5204'
      || value.admin.port !== 3200 || value.admin.origin !== 'http://127.0.0.1:3200'
      || value.admin.apiUrl !== value.backend
      || value.mini.port !== 5276 || value.mini.origin !== 'http://127.0.0.1:5276'
      || value.mini.apiUrl !== '' || value.storagePrefix !== 'hr:') {
    throw new Error('Unexpected Hassan Ragab frontend target/origin/storage contract');
  }
}
assertContract(contract);
export const storageKeys = [
  'admin_token', 'admin_refresh_token', 'admin_user', 'smc_active_tab', 'smc_selected_branch',
  'admin.invoiceExport.columns.v1', 'mini_token', 'mini_refresh_token', 'mini_cashier',
  'mini_device_context', 'mini_device_id', 'mini_active_payment_attempt', 'mini_booking_handoff:',
  'smc_queue', 'mini-device-proof',
];

export function namespaceSource(source) {
  let code = source;
  for (const key of storageKeys) {
    for (const quote of ["'", '"', '`']) {
      if (key.endsWith(':')) code = code.replaceAll(quote + key, quote + contract.storagePrefix + key);
      else code = code.replaceAll(quote + key + quote, quote + contract.storagePrefix + key + quote);
    }
  }
  // Keep the receipt QR feature, but do not encode another client's destination.
  // This is a local-only destination, not invented official client information.
  return code.replaceAll('https://example.invalid/omar-qr-unconfigured', contract.mini.origin)
    .replaceAll('https://example.invalid/hr-qr-unconfigured', contract.mini.origin)
    .replaceAll('http://localhost:5001', contract.backend)
    .replaceAll('http://127.0.0.1:5004', contract.backend).replaceAll('http://127.0.0.1:5104', contract.backend);
}

export async function hassanConfig(app, {mode}) {
  if (!['admin', 'mini'].includes(app) || !['hassan', 'omar'].includes(mode)) throw new Error('Omar config requires an explicit app and --mode omar');
  if (fs.realpathSync(path.join(directory, '../..')) !== workspace) throw new Error('Wrong Hassan worktree');
  assertIsolationInventory(collectIsolationInventory(workspace), reviewedSources);
  const envDir = path.join(workspace, '.local/hassan/frontend-env');
  if (!fs.existsSync(envDir)) fs.mkdirSync(envDir, {recursive: true});
  if (fs.realpathSync(envDir) !== envDir || fs.readdirSync(envDir).length) {
    throw new Error('Omar frontend env directory must exist, be empty and have no symlink redirect');
  }
  const root = path.join(workspace, app);
  const require = createRequire(path.join(root, 'package.json'));
  const {default: react} = await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href);
  const current = contract[app];
  const connectPolicy = `connect-src 'self' ${contract.backend} ws://127.0.0.1:${current.port}; form-action 'self'; base-uri 'self'; object-src 'none'`;
  const overlay = {
    name: 'hassan-local-isolation', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:hassan-origin') return '\0omar-origin'; },
    load(id) {
      if (['\0hassan-origin', '\0omar-origin'].includes(id)) return `if(window.location.origin!==${JSON.stringify(current.origin)}) throw new Error('Wrong Hassan Ragab frontend origin');`;
    },
    transform(source, id) {
      const clean = id.split('?')[0];
      // Admin intentionally reuses Mini receipt components; isolate those too.
      if (!['admin', 'mini'].some(name => clean.startsWith(path.join(workspace, name) + path.sep))
          || clean.includes('/node_modules/') || !/\.[jt]sx?$/.test(clean)) return null;
      assertIsolationSource(source, path.relative(workspace, clean).split(path.sep).join('/'), reviewedSources);
      let code = namespaceSource(source);
      if (clean === path.join(root, 'index.tsx')) code = `import 'virtual:hassan-origin';\n` + code;
      return code === source ? null : {code, map: null};
    },
    transformIndexHtml: {
      order: 'pre',
      handler() { return [{tag: 'meta', attrs: {'http-equiv': 'Content-Security-Policy', content: connectPolicy}, injectTo: 'head-prepend'}]; },
    },
  };
  return {
    root, envDir, envPrefix: 'OMAR_PUBLIC_',
    plugins: [overlay, hassanBranding(workspace, app), react()],
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(current.apiUrl),
      'import.meta.env.VITE_DEV_BACKEND_TARGET': JSON.stringify(contract.backend),
      'process.env.API_KEY': JSON.stringify(''),
      'process.env.GEMINI_API_KEY': JSON.stringify(''),
    },
    server: {
      host: '127.0.0.1', port: current.port, strictPort: true,
      hmr: {host: '127.0.0.1', port: current.port},
      headers: {'Content-Security-Policy': connectPolicy},
      // Admin's source directory is /api/*.ts; proxy only actual API namespaces.
      proxy: Object.fromEntries(['^/api/(?:admin|mini)(?:/|$)', '/uploads'].map(prefix => [prefix, {target: contract.backend, changeOrigin: true}])),
    },
    preview: {
      host: '127.0.0.1', port: current.port, strictPort: true,
      headers: {'Content-Security-Policy': connectPolicy},
      proxy: Object.fromEntries(['^/api/(?:admin|mini)(?:/|$)', '/uploads'].map(prefix => [prefix, {target: contract.backend, changeOrigin: true}])),
    },
    resolve: {alias: {'@': root}},
    build: {outDir: path.join(workspace, '.local/hassan/frontend-build', app), emptyOutDir: true},
  };
}

export const omarConfig = hassanConfig;
