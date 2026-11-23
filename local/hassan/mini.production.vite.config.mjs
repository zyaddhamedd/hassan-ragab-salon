import {omarConfig, workspace} from './frontend-config.mjs';
import {omarMiniTheme} from './mini-theme.mjs';
import {omarCashierTheme} from './mini-cashier-theme.mjs';
import {omarOperationalTheme} from './mini-operational-theme.mjs';
import {omarInventoryTheme} from './mini-inventory-theme.mjs';
import {omarCashierHeaderLogo} from './cashier-header-logo.mjs';
import {omarAuthTheme} from './mini-auth-theme.mjs';
import {omarLoginLayout} from './mini-login-layout.mjs';
import {omarMiniBrandCleanup} from './mini-brand-cleanup.mjs';
import {omarTextContrast} from './mini-text-contrast.mjs';
import {omarMiniPwa} from './mini-pwa.mjs';

export default async environment => {
  const config = await omarConfig('mini', environment);
  const isolation = config.plugins.find(plugin => plugin && ['hassan-local-isolation', 'omar-local-isolation'].includes(plugin.name));
  if (isolation) isolation.load = id => ['\0hassan-origin', '\0omar-origin'].includes(id) ? '' : undefined;

  config.plugins.splice(2, 0, omarMiniTheme({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.splice(3, 0, omarCashierTheme({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.splice(4, 0, omarOperationalTheme({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.splice(5, 0, omarInventoryTheme({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.splice(6, 0, omarCashierHeaderLogo({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.splice(7, 0, omarAuthTheme({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.splice(8, 0, omarLoginLayout({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.splice(9, 0, omarMiniBrandCleanup({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.splice(10, 0, omarTextContrast({workspace, app: 'mini', mode: environment.mode}));
  config.plugins.push(omarMiniPwa({workspace, app: 'mini', mode: environment.mode}));

  config.base = '/mini/';
  config.define['import.meta.env.VITE_API_URL'] = '""';
  config.define['import.meta.env.VITE_DEV_BACKEND_TARGET'] = 'window.location.origin';
  config.build.outDir = `${workspace}/.local/hassan/frontend-dist/mini`;
  config.build.emptyOutDir = true;

  if (isolation?.transformIndexHtml) {
    isolation.transformIndexHtml.handler = () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: blob: https:; connect-src 'self';",
        },
        injectTo: 'head-prepend',
      },
    ];
  }
  return config;
};
