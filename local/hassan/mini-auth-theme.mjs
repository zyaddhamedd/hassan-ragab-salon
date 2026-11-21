// Omar-only presentation attributes and RGB paint. No authentication code changes.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inventoryClasses, inventoryPaint} from './mini-inventory-theme.mjs';
export const authStylesheet=fileURLToPath(new URL('./mini-auth-theme.css',import.meta.url));
export const authLoginFile='mini/components/LoginScreen.tsx';
export const authAppFile='mini/App.tsx';
const clauses={bootstrap:'if (isBootstrapping)', 'device-check':'if (!deviceContext)', 'access-denied':"if (deviceContext.access_mode !== 'FULL_MINI')"};
export function authAppPanels(source){
 return Object.fromEntries(Object.entries(clauses).map(([state,clause])=>{
  const start=source.indexOf('\n  '+clause+' {');if(start<0)throw Error('Omar auth panel source drift: '+state);
  const match=source.slice(start).match(/return \(\n([\s\S]*?)\n    \);/);if(!match)throw Error('Omar auth return drift: '+state);
  return [state,match[1]];
 }));
}
const hash=s=>createHash('sha256').update(s).digest('hex');
export const authPaintDigest=s=>hash(JSON.stringify(inventoryClasses(s)));
export const reviewedAuthPaint=/* PAINT */ {
  "mini/components/LoginScreen.tsx": "2a5c68b979aee0fac912af18c7017e55cc49cba263a3292b9395636f62255cbf",
  "mini/App.tsx": "c147200cee1e33b7034d81d2a8a0c2597cabcf893f2cdfeb1ccc88661404b23c"
};
export const reviewedAuthHead='d96ad696897cf694488db0d370b0d121024075e2ffa9ac8cade436247adaea86';
const loginRoot='<div className="flex items-center justify-center min-h-[100dvh]';
const loginRootAfter='<div data-omar-mini-auth="login" className="flex items-center justify-center min-h-[100dvh]';
const feedback='<div className={`mt-6 border rounded-2xl p-5 text-sm text-center animate-in';
const feedbackAfter='<div data-omar-mini-auth-semantic={isFinalizationRequired ? "success" : isEnrollmentRequired || isProofRepairRequired ? "warning" : "error"} className={`mt-6 border rounded-2xl p-5 text-sm text-center animate-in';
const deniedIcon='<div className="w-12 h-12 rounded-2xl bg-[#E53935]/10 text-[#E53935]';
const deniedIconAfter='<div data-omar-mini-auth-semantic="error" className="w-12 h-12 rounded-2xl bg-[#E53935]/10 text-[#E53935]';
export const authLoginHooks=[[loginRoot,loginRootAfter],[feedback,feedbackAfter]];
export function authThemeSource(source,file){
 if(![authLoginFile,authAppFile].includes(file))return null;
 const paintSource=file===authLoginFile?source:Object.values(authAppPanels(source)).join('\n');
 if(authPaintDigest(paintSource)!==reviewedAuthPaint[file])throw Error('Omar auth paint inventory drift: '+file);
 let code=source;
 if(file===authLoginFile){
  for(const [before,after]of authLoginHooks){if(code.split(before).length!==2||code.includes(after))throw Error('Omar auth hook drift: '+file);code=code.replace(before,after);}
 }else for(const [state,original]of Object.entries(authAppPanels(source))){
  let themed=original.replace('<div className="mini-shell','<div data-omar-mini-auth="'+state+'" className="mini-shell');
  if(state==='access-denied'){
   if(themed.split(deniedIcon).length!==2)throw Error('Omar denied icon drift');themed=themed.replace(deniedIcon,deniedIconAfter);
  }
  if(themed===original||original.includes('data-omar-mini-auth'))throw Error('Omar auth panel hook drift');code=code.replace(original,themed);
 }
 return code;
}
export function authPaint(cls){
 const result=inventoryPaint(cls.replace('#ff4040','#ffed9e'));if(!result)return null;
 return {...result,declarations:Object.fromEntries(Object.entries(result.declarations).map(([p,v])=>[p,v.replaceAll('--omar-mini-inventory-action','--omar-mini-auth-red')]))};
}
export function buildAuthCSS(workspace){
 const login=fs.readFileSync(path.join(workspace,authLoginFile),'utf8'),app=fs.readFileSync(path.join(workspace,authAppFile),'utf8'),panels=Object.values(authAppPanels(app)).join('\n');
 if(authPaintDigest(login)!==reviewedAuthPaint[authLoginFile]||authPaintDigest(panels)!==reviewedAuthPaint[authAppFile])throw Error('Omar auth paint inventory drift');
 if(hash(fs.readFileSync(path.join(workspace,'mini/index.html'),'utf8'))!==reviewedAuthHead)throw Error('Omar auth shared effect source drift');
 const scope='html[data-omar-mini-theme="foundation"] [data-omar-mini-auth]';
 const lines=['/* Generated Omar auth RGB overlay. Original alpha, effects, geometry and state precedence retained. */','@media screen {'];
 const order={'':0,'focus-within':1,hover:2,focus:3,disabled:4,active:5,'disabled:hover':6,'group-focus-within':7,'group-hover':8};
 const edgeOrder=p=>Object.keys(p.declarations).some(k=>/^border-(top|right|bottom|left)-color$/.test(k))?1:0;
 const rules=inventoryClasses(login+'\n'+panels).map(c=>[c,authPaint(c)]).filter(([,p])=>p).sort((a,b)=>order[a[1].variant]-order[b[1].variant]||edgeOrder(a[1])-edgeOrder(b[1])||a[0].localeCompare(b[0],'en'));
 for(const [cls,{variant,declarations}]of rules){
  const attr='[class~="'+cls+'"]',suffix=(variant&&!variant.startsWith('group-')?':'+variant:'')+(cls.startsWith('placeholder-')||cls.startsWith('placeholder:')?'::placeholder':'');
  const selectors=variant.startsWith('group-')?[scope+' .group:'+variant.slice(6)+' '+attr]:[scope+attr+suffix,scope+' '+attr+suffix];
  lines.push('  '+selectors.join(',\n  ')+' { '+Object.entries(declarations).map(([p,v])=>p+': '+v+';').join(' ')+' }');
 }
 const rule=(selector,body)=>lines.push('  '+selector+' { '+body+' }');
 rule(scope,'--omar-mini-auth-red: var(--omar-mini-accent);');
 for(const state of ['error','warning','success'])rule(scope+' [data-omar-mini-auth-semantic="'+state+'"]','--omar-mini-auth-red: var(--omar-mini-'+state+');');
 rule('html[data-omar-mini-theme="foundation"] [data-omar-mini-auth="device-check"]','--omar-mini-auth-red: var(--omar-mini-warning);');
 rule(scope+' .omar-wordmark','--omar-brand-color: var(--omar-mini-accent);');
 rule(scope+' input[class~="bg-[#121212]/50"]','background-color: color-mix(in srgb, var(--omar-mini-input) 50%, transparent);');
 rule(scope+' button[class~="bg-[#E53935]"][class~="text-white"]','color: var(--omar-mini-on-accent);');
 rule(scope+' button[type="submit"] [class~="border-white/20"]','border-color: color-mix(in srgb, var(--omar-mini-on-accent) 20%, transparent);');
 rule(scope+' button[type="submit"] [class~="border-t-white"]','border-top-color: var(--omar-mini-on-accent);');
 rule(scope+' .focus-gold:focus','border-color: var(--omar-mini-accent); box-shadow: 0 0 10px rgba(216,184,135,0.3);');
 rule(scope+' .neon-red-shadow','box-shadow: 0 0 20px rgba(216,184,135,0.4);');
 rule(scope+' .neon-gold-text','text-shadow: 0 0 8px rgba(216,184,135,0.5);');
 lines.push('}');return lines.join('\n')+'\n';
}
export function omarAuthTheme({workspace,app,mode}){
 if(app!=='mini'||!['hassan', 'omar'].includes(mode))return null;
 return {name:'omar-mini-auth-theme',enforce:'pre',async configureServer(server){const {authFixtureMiddleware}=await import('./mini-auth-visual-fixture.mjs');authFixtureMiddleware(server);},
  buildStart(){if(fs.readFileSync(authStylesheet,'utf8')!==buildAuthCSS(workspace))throw Error('Omar auth stylesheet drift');},
  transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');
   if(file==='mini/index.tsx')return {code:source+'\nimport '+JSON.stringify(authStylesheet)+';\n',map:null};
   const code=authThemeSource(source,file);return code===null?null:{code,map:null};
  },
 };
}
