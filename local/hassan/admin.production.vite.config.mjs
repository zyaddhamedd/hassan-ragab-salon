import {omarConfig, workspace} from './frontend-config.mjs';
import {omarAdminTheme} from './admin-theme.mjs';
import {omarDashboardTheme} from './admin-dashboard-theme.mjs';
import {omarRecordsTheme} from './admin-records-theme.mjs';
import {omarWorkforceTheme} from './admin-workforce-theme.mjs';
import {omarLedgerTheme} from './admin-ledger-theme.mjs';
import {omarStockTheme} from './admin-stock-theme.mjs';
import {omarFinalUITheme} from './admin-final-ui-theme.mjs';
import {omarCompactShell} from './admin-compact-shell.mjs';
import {omarCouponArtifact} from './admin-coupon-artifact.mjs';
import {omarPromoTheme} from './admin-promo-theme.mjs';
import {omarDashboardRefinement} from './admin-dashboard-refinement.mjs';
import {omarRevenueV2} from './admin-revenue-v2.mjs';
import {omarLoginPolish} from './admin-login-polish.mjs';
import {omarStaffIdentityUI} from './admin-staff-identity.mjs';
import {omarShiftPlanner} from './admin-shift-planner.mjs';

export default async environment => {
  const config = await omarConfig('admin', environment);
  const isolation = config.plugins.find(plugin => plugin && ['hassan-local-isolation', 'omar-local-isolation'].includes(plugin.name));
  if (isolation) isolation.load = id => ['\0hassan-origin', '\0omar-origin'].includes(id) ? '' : undefined;

  config.plugins.splice(2, 0, omarAdminTheme({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(3, 0, omarDashboardTheme({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(4, 0, omarRecordsTheme({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(5, 0, omarWorkforceTheme({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(6, 0, omarLedgerTheme({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(7, 0, omarStockTheme({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(8, 0, omarFinalUITheme({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(9, 0, omarCompactShell({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(10, 0, omarCouponArtifact({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(11, 0, omarPromoTheme({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(12, 0, omarDashboardRefinement({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(13, 0, omarRevenueV2({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.splice(14, 0, omarLoginPolish({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.push(omarStaffIdentityUI({workspace, app: 'admin', mode: environment.mode}));
  config.plugins.push(omarShiftPlanner({workspace, app: 'admin', mode: environment.mode}));

  config.base = '/admin/';
  config.define['import.meta.env.VITE_API_URL'] = 'window.location.origin';
  config.define['import.meta.env.VITE_DEV_BACKEND_TARGET'] = 'window.location.origin';
  config.build.outDir = `${workspace}/.local/hassan/frontend-dist/admin`;
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
