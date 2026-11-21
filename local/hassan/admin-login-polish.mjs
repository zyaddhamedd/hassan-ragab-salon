import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {namespaceSource} from './frontend-config.mjs';
import {brandSource} from './branding.mjs';
import {finalUIThemeSource} from './admin-final-ui-theme.mjs';
export const loginStylesheet=fileURLToPath(new URL('./admin-login-polish.css',import.meta.url));
const white=fileURLToPath(new URL('./assets/cashier-header-logo-white-tight.svg',import.meta.url));
const ink=fileURLToPath(new URL('./assets/mini-print-logo.svg',import.meta.url));
export const loginHooks=[
 ['<div className="relative z-10 w-full max-w-md flex flex-col items-center">','<div data-omar-login-composition className="relative z-10 w-full max-w-md flex flex-col items-center">'],
 ['<div className="relative mb-2 sm:mb-3 flex items-center justify-center animate-fade-in shrink-0">','<div data-omar-login-brand className="relative mb-2 sm:mb-3 flex items-center justify-center animate-fade-in shrink-0">'],
 ["<Logo size=\"hero\" className={isDarkMode ? '' : 'hr-wordmark-ink'} />",'<img data-omar-login-logo src={isDarkMode ? omarLoginWhite : omarLoginInk} alt="Hassan Ragab Salon" />'],
];
export const loginRemovedBlocks=[
 /<div className="text-center mb-6 flex flex-col items-center animate-fade-in-up shrink-0">[\s\S]*?<\/h1>[\s\S]*?<\/div>\s*<\/div>/,
 /<div className="mt-6 sm:mt-8 text-center opacity-30 shrink-0">[\s\S]*?<\/p>\s*<\/div>/,
];
export function loginPolishSource(source,file,workspace){
 if(file!=='admin/components/LoginScreen.tsx')return null;
 const raw=fs.readFileSync(path.join(workspace,file),'utf8');
 if(source!==finalUIThemeSource(brandSource(namespaceSource(raw),file),file))throw Error('Omar Login polish source drift');
 let code=source;
 for(const[before,after]of loginHooks){if(code.split(before).length!==2)throw Error('Omar Login hook drift');code=code.replace(before,after);}
 for(const pattern of loginRemovedBlocks){if(!pattern.test(code))throw Error('Omar Login brand block drift');code=code.replace(pattern,'');}
 return 'import omarLoginWhite from '+JSON.stringify(white)+';\nimport omarLoginInk from '+JSON.stringify(ink)+';\n'+code;
}
export function omarLoginPolish({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return{name:'omar-admin-login-polish',enforce:'pre',transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(file==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(loginStylesheet)+';\n',map:null};const code=loginPolishSource(source,file,workspace);return code===null?null:{code,map:null};}};
}
