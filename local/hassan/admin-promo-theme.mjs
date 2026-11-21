// Remaining Promo UI paint only; the approved artifact is explicitly excluded.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {couponArtifactSource} from './admin-coupon-artifact.mjs';
export const promoStylesheet=fileURLToPath(new URL('./admin-promo-theme.css',import.meta.url));
export const promoHooks={
 'admin/components/PromoCodesPage.tsx':['<section dir="rtl"','<section data-omar-promo-theme={isDarkMode ? "dark" : "light"} dir="rtl"'],
 'admin/components/PromoCodeModal.tsx':['<div className="admin-overlay-shell','<div data-omar-promo-theme={isDarkMode ? "dark" : "light"} className="admin-overlay-shell'],
};
const reviewed={'admin/components/PromoCodesPage.tsx': '57c362f03081e7f600c1c7e612e58dd648741fc900c74b7d16f4881f2528cc55', 'admin/components/PromoCodeModal.tsx': 'a36ff9e634abe8f16d7052096be3632ebe0843821959532f92cd871e980879dd'};
export function promoThemeSource(source,file,workspace){
 const hook=promoHooks[file];if(!hook)return null;
 const raw=fs.readFileSync(path.join(workspace,file),'utf8');
 if(createHash('sha256').update(raw).digest('hex')!==reviewed[file])throw Error('Omar Promo paint source drift: '+file);
 const expected=file.endsWith('/PromoCodesPage.tsx')?couponArtifactSource(raw,file):raw;
 if(source!==expected||source.split(hook[0]).length!==2)throw Error('Omar Promo hook drift: '+file);
 return source.replace(...hook);
}
export function omarPromoTheme({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return{name:'omar-admin-promo-theme',enforce:'pre',transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(file==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(promoStylesheet)+';\n',map:null};const code=promoThemeSource(source,file,workspace);return code===null?null:{code,map:null};}};
}
