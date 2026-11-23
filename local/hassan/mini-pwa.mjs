// Mini-only PWA manifest, branded icons, and desktop standalone metadata overlay.
// Never enabled by Admin or canonical default configs. Online-only: no service worker caching.
import fs from 'node:fs';
import path from 'node:path';

export const MINI_PWA_TITLE = 'Hassan Ragab Cashier';
export const MINI_PWA_SHORT_NAME = 'HR Cashier';
export const MINI_PWA_THEME_COLOR = '#0B0B0D';
export const MINI_PWA_BACKGROUND_COLOR = '#0B0B0D';

function pwaDevMiddleware(workspace) {
  const publicRoot = path.join(workspace, 'mini/public');
  const types = {
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.json': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
  };
  return (req, res, next) => {
    const rawUrl = (req.url || '/').split('?')[0];
    if (rawUrl === '/manifest.webmanifest' || rawUrl === '/mini/manifest.webmanifest') {
      const manifestPath = path.join(publicRoot, 'manifest.webmanifest');
      if (fs.existsSync(manifestPath)) {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(fs.readFileSync(manifestPath));
        return;
      }
    }
    if (rawUrl.startsWith('/mini/icons/') || rawUrl === '/mini/favicon.ico' || rawUrl.startsWith('/mini/audio/')) {
      const rel = rawUrl.slice('/mini/'.length);
      const target = path.resolve(publicRoot, rel);
      if (target.startsWith(publicRoot + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile()) {
        const ext = path.extname(target).toLowerCase();
        res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(fs.readFileSync(target));
        return;
      }
    }
    next();
  };
}

export function omarMiniPwa({workspace, app, mode}) {
  if (app !== 'mini' || !['hassan', 'omar'].includes(mode)) return null;
  return {
    name: 'hassan-mini-pwa',
    enforce: 'post',
    configureServer(server) {
      server.middlewares.use(pwaDevMiddleware(workspace));
    },
    configurePreviewServer(server) {
      server.middlewares.use(pwaDevMiddleware(workspace));
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const nextHtml = html.replace(/<title>[^<]*<\/title>/, `<title>${MINI_PWA_TITLE}</title>`);
        return {
          html: nextHtml,
          tags: [
            {
              tag: 'meta',
              attrs: {name: 'application-name', content: MINI_PWA_TITLE},
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {name: 'apple-mobile-web-app-title', content: MINI_PWA_SHORT_NAME},
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {name: 'apple-mobile-web-app-capable', content: 'yes'},
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {name: 'mobile-web-app-capable', content: 'yes'},
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent'},
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {name: 'theme-color', content: MINI_PWA_THEME_COLOR},
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {name: 'msapplication-TileColor', content: MINI_PWA_BACKGROUND_COLOR},
              injectTo: 'head',
            },
            {
              tag: 'meta',
              attrs: {name: 'msapplication-navbutton-color', content: MINI_PWA_THEME_COLOR},
              injectTo: 'head',
            },
            {
              tag: 'link',
              attrs: {rel: 'manifest', href: '/mini/manifest.webmanifest'},
              injectTo: 'head',
            },
            {
              tag: 'link',
              attrs: {rel: 'icon', type: 'image/x-icon', href: '/mini/favicon.ico'},
              injectTo: 'head',
            },
            {
              tag: 'link',
              attrs: {rel: 'icon', type: 'image/png', sizes: '32x32', href: '/mini/icons/favicon-32x32.png'},
              injectTo: 'head',
            },
            {
              tag: 'link',
              attrs: {rel: 'icon', type: 'image/png', sizes: '16x16', href: '/mini/icons/favicon-16x16.png'},
              injectTo: 'head',
            },
            {
              tag: 'link',
              attrs: {rel: 'apple-touch-icon', sizes: '180x180', href: '/mini/icons/apple-touch-icon.png'},
              injectTo: 'head',
            },
          ],
        };
      },
    },
  };
}
