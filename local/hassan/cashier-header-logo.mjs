// Hassan Ragab Mini header content; text-based temporary brand identity.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const cashierLogoFile = 'local/hassan/assets/hassan-ragab-logo.png';
export const cashierTightLogoFile = 'local/hassan/assets/hassan-ragab-logo.png';
export const cashierWhiteLogoFile = 'local/hassan/assets/hassan-ragab-logo.png';
export const cashierLogoCSS = fileURLToPath(new URL('./cashier-header-logo.css', import.meta.url));
export const originalCashierBrand = `<div className="flex flex-col shrink-0">
                <h1 className="text-lg font-black text-white leading-tight">{isGroupMode ? 'فاتورة مجمعة' : 'نقطة البيع'}</h1>
                <span className="text-[10px] font-bold text-[#E53935] uppercase tracking-widest opacity-80">{cashier.branch_name}</span>
              </div>`;

export const omarCashierBrand = originalCashierBrand
 .replace('<div className=', '<div data-omar-cashier-header-brand="image" className=')
 .replace('              </div>', '                <img data-omar-cashier-header-logo src={omarCashierHeaderLogoURL} alt="Hassan Ragab Salon" />\n              </div>');

export function cashierHeaderLogoSource(source, relative) {
 if (relative !== 'mini/components/CashierScreen.tsx') return null;
 if (source.split(originalCashierBrand).length !== 2 || source.includes('data-omar-cashier-header-brand')) {
   throw Error('Hassan cashier header brand source drift');
 }
 return "import omarCashierHeaderLogoURL from 'virtual:omar-cashier-header-logo';\n" + source.replace(originalCashierBrand, omarCashierBrand);
}

export function omarCashierHeaderLogo({workspace, app, mode}) {
 if (app !== 'mini' || !['hassan', 'omar'].includes(mode)) return null;
 const asset = path.join(workspace, cashierLogoFile);
 return {
  name: 'omar-cashier-header-logo',
  enforce: 'pre',
  resolveId(id) {
    if (id === 'virtual:omar-cashier-header-logo') return asset;
  },
  transform(source, id) {
   const relative = path.relative(workspace, id.split('?')[0]).split(path.sep).join('/');
   if (relative === 'mini/index.tsx') return {code: source + '\nimport ' + JSON.stringify(cashierLogoCSS) + ';\n', map: null};
   const code = cashierHeaderLogoSource(source, relative);
   return code === null ? null : {code, map: null};
  },
 };
}
