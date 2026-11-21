import {omarTextContrast} from './mini-text-contrast.mjs';
import {omarMiniBrandCleanup} from './mini-brand-cleanup.mjs';
import {omarConfig, workspace} from './frontend-config.mjs';
import {omarLoginLayout} from './mini-login-layout.mjs';
import {omarAuthTheme} from './mini-auth-theme.mjs';
import {omarMiniTheme} from './mini-theme.mjs';
import {omarCashierTheme} from './mini-cashier-theme.mjs';
import {omarCashierHeaderLogo} from './cashier-header-logo.mjs';
import {omarInventoryTheme} from './mini-inventory-theme.mjs';
import {omarOperationalTheme} from './mini-operational-theme.mjs';
export default async environment => {
  const config = await omarConfig('mini', environment);
  // Keep isolation/branding first and the JSX presentation hooks before React.
  config.plugins.splice(2, 0, omarMiniTheme({workspace, app:'mini', mode:environment.mode}));
  config.plugins.splice(3, 0, omarCashierTheme({workspace, app:'mini', mode:environment.mode}));
  config.plugins.splice(4, 0, omarOperationalTheme({workspace, app:'mini', mode:environment.mode}));
  config.plugins.splice(5, 0, omarInventoryTheme({workspace, app:'mini', mode:environment.mode}));
  config.plugins.splice(6, 0, omarCashierHeaderLogo({workspace, app:'mini', mode:environment.mode}));
  config.plugins.splice(7, 0, omarAuthTheme({workspace, app:'mini', mode:environment.mode}));
  config.plugins.splice(8, 0, omarLoginLayout({workspace, app:'mini', mode:environment.mode}));
  config.plugins.splice(9, 0, omarMiniBrandCleanup({workspace, app:'mini', mode:environment.mode}));
  config.plugins.splice(10, 0, omarTextContrast({workspace, app:'mini', mode:environment.mode}));
  return config;
};
