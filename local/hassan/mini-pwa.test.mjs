import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import miniConfig from './mini.vite.config.mjs';
import miniProdConfig from './mini.production.vite.config.mjs';
import adminConfig from './admin.vite.config.mjs';
import {omarMiniPwa, MINI_PWA_TITLE, MINI_PWA_SHORT_NAME, MINI_PWA_THEME_COLOR, MINI_PWA_BACKGROUND_COLOR} from './mini-pwa.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(directory, '../..');
const distRoot = path.join(workspace, '.local/hassan/frontend-dist');

function readPngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Invalid PNG signature');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR', 'Missing IHDR chunk');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer[24],
    colorType: buffer[25],
  };
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({host: '127.0.0.1', port, path: urlPath}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
  });
}

test('Mini PWA plugin is scoped strictly to Mini and excluded from Admin', async () => {
  assert.equal(omarMiniPwa({workspace, app: 'admin', mode: 'hassan'}), null);
  assert.equal(omarMiniPwa({workspace, app: 'admin', mode: 'omar'}), null);
  assert.equal(omarMiniPwa({workspace, app: 'mini', mode: 'production'}), null);

  const mini = await miniConfig({mode: 'hassan'});
  const miniProd = await miniProdConfig({mode: 'hassan'});
  const admin = await adminConfig({mode: 'hassan'});

  assert.ok(mini.plugins.flat().filter(Boolean).some(p => p.name === 'hassan-mini-pwa'));
  assert.ok(miniProd.plugins.flat().filter(Boolean).some(p => p.name === 'hassan-mini-pwa'));
  assert.ok(!admin.plugins.flat().filter(Boolean).some(p => p.name === 'hassan-mini-pwa'));
});

test('Production bundle output contains valid manifest, icons, audio, and branded HTML metadata', () => {
  const miniDist = path.join(distRoot, 'mini');
  const adminDist = path.join(distRoot, 'admin');

  const miniHtml = fs.readFileSync(path.join(miniDist, 'index.html'), 'utf8');
  assert.ok(miniHtml.includes(`<title>${MINI_PWA_TITLE}</title>`));
  assert.ok(miniHtml.includes('<link rel="manifest" href="/mini/manifest.webmanifest">'));
  assert.ok(miniHtml.includes(`<meta name="theme-color" content="${MINI_PWA_THEME_COLOR}">`));
  assert.ok(miniHtml.includes(`<meta name="application-name" content="${MINI_PWA_TITLE}">`));
  assert.ok(miniHtml.includes(`<meta name="apple-mobile-web-app-title" content="${MINI_PWA_SHORT_NAME}">`));
  assert.ok(miniHtml.includes('<link rel="apple-touch-icon" sizes="180x180" href="/mini/icons/apple-touch-icon.png">'));
  assert.ok(miniHtml.includes('<link rel="icon" type="image/png" sizes="32x32" href="/mini/icons/favicon-32x32.png">'));
  assert.ok(miniHtml.includes('<link rel="icon" type="image/png" sizes="16x16" href="/mini/icons/favicon-16x16.png">'));
  assert.ok(miniHtml.includes('<link rel="icon" type="image/x-icon" href="/mini/favicon.ico">'));

  // Admin stays separate and unaffected
  const adminHtml = fs.readFileSync(path.join(adminDist, 'index.html'), 'utf8');
  assert.ok(adminHtml.includes('<title>HASSAN RAGAB SALON — Admin</title>'));
  assert.ok(!adminHtml.includes('manifest.webmanifest'));
  assert.ok(!adminHtml.includes(MINI_PWA_TITLE));

  // Verify manifest content
  const manifest = JSON.parse(fs.readFileSync(path.join(miniDist, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, MINI_PWA_TITLE);
  assert.equal(manifest.short_name, MINI_PWA_SHORT_NAME);
  assert.equal(manifest.start_url, '/mini/');
  assert.equal(manifest.scope, '/mini/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, MINI_PWA_THEME_COLOR);
  assert.equal(manifest.background_color, MINI_PWA_BACKGROUND_COLOR);

  // Verify required icons and actual pixel dimensions
  const expectedPngIcons = [
    {src: '/mini/icons/icon-192x192.png', width: 192, height: 192, purpose: 'any'},
    {src: '/mini/icons/icon-512x512.png', width: 512, height: 512, purpose: 'any'},
    {src: '/mini/icons/icon-maskable-192x192.png', width: 192, height: 192, purpose: 'maskable'},
    {src: '/mini/icons/icon-maskable-512x512.png', width: 512, height: 512, purpose: 'maskable'},
  ];

  for (const expected of expectedPngIcons) {
    const entry = manifest.icons.find(i => i.src === expected.src && i.purpose === expected.purpose);
    assert.ok(entry, `Missing manifest icon entry for ${expected.src} (${expected.purpose})`);
    assert.equal(entry.sizes, `${expected.width}x${expected.height}`);
    assert.equal(entry.type, 'image/png');

    const diskPath = path.join(miniDist, expected.src.replace(/^\/mini\//, ''));
    const dims = readPngDimensions(fs.readFileSync(diskPath));
    assert.equal(dims.width, expected.width);
    assert.equal(dims.height, expected.height);
  }

  for (const [relPath, w, h] of [
    ['icons/apple-touch-icon.png', 180, 180],
    ['icons/favicon-32x32.png', 32, 32],
    ['icons/favicon-16x16.png', 16, 16],
  ]) {
    const dims = readPngDimensions(fs.readFileSync(path.join(miniDist, relPath)));
    assert.equal(dims.width, w);
    assert.equal(dims.height, h);
  }

  // Verify no unsafe service worker registration or financial offline caching in built JS
  const assetsDir = path.join(miniDist, 'assets');
  const jsBundle = fs.readdirSync(assetsDir)
    .filter(f => f.endsWith('.js'))
    .map(f => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
    .join('\n');

  assert.ok(!jsBundle.includes('serviceWorker.register'), 'No service worker registration allowed');
  assert.ok(!jsBundle.includes('caches.open'), 'No Cache Storage offline caching allowed');
  assert.ok(jsBundle.includes('hr:mini_token'), 'Namespaced cashier auth token preserved');
  assert.ok(jsBundle.includes('hr:mini-device-proof'), 'Namespaced cashier device proof preserved');
  assert.ok(jsBundle.includes('/audio/30min.mp3'), '30min booking audio path preserved');
  assert.ok(jsBundle.includes('/audio/elgom.mp3'), 'due booking audio path preserved');
});

test('Node frontend server serves manifest, icons, audio, Mini, and Admin with exact MIME types and routing', async () => {
  const testPort = 18427;
  const child = spawn(process.execPath, [path.join(workspace, 'frontend/server.mjs')], {
    env: {...process.env, PORT: String(testPort), BACKEND_URL: 'http://127.0.0.1:5204'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for frontend server')), 5000);
    child.stdout.on('data', data => {
      if (String(data).includes(`listening on 0.0.0.0:${testPort}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });

  try {
    // 1. /mini redirects to /mini/
    const miniRedirect = await httpGet(testPort, '/mini');
    assert.equal(miniRedirect.statusCode, 302);
    assert.equal(miniRedirect.headers.location, '/mini/');

    // 2. /mini/ returns Mini HTML with manifest & title
    const miniIndex = await httpGet(testPort, '/mini/');
    assert.equal(miniIndex.statusCode, 200);
    assert.equal(miniIndex.headers['content-type'], 'text/html; charset=utf-8');
    const miniIndexHtml = miniIndex.body.toString('utf8');
    assert.ok(miniIndexHtml.includes('<title>Hassan Ragab Cashier</title>'));
    assert.ok(miniIndexHtml.includes('<link rel="manifest" href="/mini/manifest.webmanifest">'));

    // 3. /mini/manifest.webmanifest returns application/manifest+json
    const manifestRes = await httpGet(testPort, '/mini/manifest.webmanifest');
    assert.equal(manifestRes.statusCode, 200);
    assert.equal(manifestRes.headers['content-type'], 'application/manifest+json; charset=utf-8');
    const manifestJson = JSON.parse(manifestRes.body.toString('utf8'));
    assert.equal(manifestJson.name, 'Hassan Ragab Cashier');
    assert.equal(manifestJson.short_name, 'HR Cashier');
    assert.equal(manifestJson.start_url, '/mini/');
    assert.equal(manifestJson.scope, '/mini/');
    assert.equal(manifestJson.display, 'standalone');

    // 4. All manifest icons and favicons are accessible over HTTP with exact dimensions
    for (const [urlPath, w, h] of [
      ['/mini/icons/icon-192x192.png', 192, 192],
      ['/mini/icons/icon-512x512.png', 512, 512],
      ['/mini/icons/icon-maskable-192x192.png', 192, 192],
      ['/mini/icons/icon-maskable-512x512.png', 512, 512],
      ['/mini/icons/apple-touch-icon.png', 180, 180],
      ['/mini/icons/favicon-32x32.png', 32, 32],
      ['/mini/icons/favicon-16x16.png', 16, 16],
    ]) {
      const iconRes = await httpGet(testPort, urlPath);
      assert.equal(iconRes.statusCode, 200, `Failed to fetch ${urlPath}`);
      assert.equal(iconRes.headers['content-type'], 'image/png');
      const dims = readPngDimensions(iconRes.body);
      assert.equal(dims.width, w);
      assert.equal(dims.height, h);
    }

    const svgRes = await httpGet(testPort, '/mini/icons/icon.svg');
    assert.equal(svgRes.statusCode, 200);
    assert.equal(svgRes.headers['content-type'], 'image/svg+xml');

    const icoRes = await httpGet(testPort, '/mini/favicon.ico');
    assert.equal(icoRes.statusCode, 200);
    assert.equal(icoRes.headers['content-type'], 'image/x-icon');

    // 5. Audio assets accessible at both /mini/audio/* and /audio/*
    for (const audioPath of ['/mini/audio/30min.mp3', '/mini/audio/elgom.mp3', '/audio/30min.mp3', '/audio/elgom.mp3']) {
      const audioRes = await httpGet(testPort, audioPath);
      assert.equal(audioRes.statusCode, 200, `Failed to fetch ${audioPath}`);
      assert.equal(audioRes.headers['content-type'], 'audio/mpeg');
      assert.ok(audioRes.body.length > 50000);
    }

    // 6. Admin remains separate and unaffected
    const rootRedirect = await httpGet(testPort, '/');
    assert.equal(rootRedirect.statusCode, 302);
    assert.equal(rootRedirect.headers.location, '/admin/');

    const adminIndex = await httpGet(testPort, '/admin/');
    assert.equal(adminIndex.statusCode, 200);
    assert.equal(adminIndex.headers['content-type'], 'text/html; charset=utf-8');
    const adminIndexHtml = adminIndex.body.toString('utf8');
    assert.ok(adminIndexHtml.includes('<title>HASSAN RAGAB SALON — Admin</title>'));
    assert.ok(!adminIndexHtml.includes('manifest.webmanifest'));
  } finally {
    child.kill('SIGTERM');
  }
});
