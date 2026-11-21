// Explicit owner-authorized Login presentation follow-up. No auth handler edits.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cashierTightLogoFile} from './cashier-header-logo.mjs';
export const loginLayoutStylesheet=fileURLToPath(new URL('./mini-login-layout.css',import.meta.url));
export const loginTitle=`          <h1 className="text-2xl font-bold tracking-[0.1em] text-[#F5F5F5] text-center mt-2 opacity-90 neon-gold-text">
            نظام الإدارة الموحد
          </h1>`;
export const loginLayoutHooks=[
 ["import Logo from './Logo';", "import omarLoginWhiteLogo from 'virtual:omar-login-white-logo';"],
 ['data-omar-mini-auth="login"','data-omar-mini-auth="login" data-omar-login-layout="compact"'],
 ['<div className="w-full max-w-md z-10">','<div data-omar-login-content className="w-full max-w-md z-10">'],
 ['<div className="flex flex-col items-center mb-12">','<div data-omar-login-brand className="flex flex-col items-center mb-12">'],
 ['<div className="relative w-48 h-48 flex items-center justify-center group">','<div data-omar-login-logo-frame className="relative w-48 h-48 flex items-center justify-center group">'],
 ['<Logo />','<img data-omar-login-white-logo src={omarLoginWhiteLogo} alt="Hassan Ragab Salon" />'],
 [loginTitle,'          {/* Omar login: management tagline omitted. */}'],
 ['<div className="bg-[#1E1E1E]/80 backdrop-blur-xl','<div data-omar-login-card className="bg-[#1E1E1E]/80 backdrop-blur-xl'],
 ['<p className="mt-10 text-center','<p data-omar-login-notice className="mt-10 text-center'],
 ['<div className="mt-16 flex justify-center','<div data-omar-login-ornament className="mt-16 flex justify-center'],
];
export function loginLayoutSource(source,file){
 if(file!=='mini/components/LoginScreen.tsx')return null;
 let code=source;
 for(const [before,after]of loginLayoutHooks){if(code.split(before).length!==2||(after&&code.includes(after)))throw Error('Omar compact Login presentation drift: '+before.slice(0,65));code=code.replace(before,after);}
 return code;
}
export function omarLoginLayout({workspace,app,mode}){
 if(app!=='mini'||!['hassan', 'omar'].includes(mode))return null;
 return {name:'omar-mini-login-layout',enforce:'pre',resolveId(id){if(id==='virtual:omar-login-white-logo')return path.join(workspace,cashierTightLogoFile);},
 transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');
  if(file==='mini/index.tsx')return {code:source+'\nimport '+JSON.stringify(loginLayoutStylesheet)+';\n',map:null};
  const code=loginLayoutSource(source,file);return code===null?null:{code,map:null};
 }};
}
