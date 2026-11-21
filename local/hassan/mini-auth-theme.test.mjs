import {assertCanonicalRuntimeUnchanged} from './canonical-runtime-guard.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash}from 'node:crypto';import{createRequire}from'node:module';import{execFileSync}from'node:child_process';
import{authStylesheet,authAppPanels,authLoginFile,authAppFile,authLoginHooks,authThemeSource,authPaintDigest,reviewedAuthPaint,authPaint,buildAuthCSS,omarAuthTheme}from'./mini-auth-theme.mjs';
import{inventoryClasses}from'./mini-inventory-theme.mjs';
import miniConfig from './mini.vite.config.mjs';import adminConfig from './admin.vite.config.mjs';
const workspace=path.resolve(import.meta.dirname,'../..'),read=f=>fs.readFileSync(path.join(workspace,f),'utf8'),require=createRequire(path.join(workspace,'mini/package.json'));
const css=fs.readFileSync(authStylesheet,'utf8'),root=require('postcss').parse(css),hash=s=>createHash('sha256').update(s).digest('hex');
const colorForm=v=>v.replace(/rgba?\(([^)]*)\)/g,(_,s)=>'COLOR('+(s.split(',')[3]||'1')+')').replace(/#[\da-f]{3,8}\b/gi,'COLOR(1)').replaceAll(' ','');
test('auth plugin activates only in Omar Mini and before React, after existing approved themes',async()=>{
 for(const[app,mode]of[['admin','omar'],['mini','production'],['mini','development']])assert.equal(omarAuthTheme({workspace,app,mode}),null);
 const mini=await miniConfig({mode:'omar'}),admin=await adminConfig({mode:'omar'}),names=mini.plugins.flat().filter(Boolean).map(p=>p.name);
 assert.ok(names.indexOf('omar-mini-auth-theme')>names.indexOf('omar-cashier-header-logo'));assert.ok(names.indexOf('omar-mini-auth-theme')<names.indexOf('vite:react-babel'));assert.ok(!admin.plugins.flat().filter(Boolean).some(p=>p.name==='omar-mini-auth-theme'));
});
test('Login and three App states receive presentation attributes only; every auth handler remains byte-identical',()=>{
 const source=read(authLoginFile),themed=authThemeSource(source,authLoginFile);let restored=themed;for(const[b,a]of authLoginHooks)restored=restored.replace(a,b);assert.equal(restored,source);assert.throws(()=>authThemeSource(themed,authLoginFile),/hook drift/);
 const app=read(authAppFile),result=authThemeSource(app,authAppFile);assert.equal(result.replace(/ data-omar-mini-auth="[^"]+"/g,'').replace(' data-omar-mini-auth-semantic="error"',''),app);assert.equal(Object.keys(authAppPanels(app)).length,3);
 assert.throws(()=>authThemeSource(source+' // bg-[#NEW]',authLoginFile),/paint inventory drift/);assert.throws(()=>authThemeSource(app.replace('border-t-[#E6D690]','border-t-[#BAD]'),authAppFile),/paint inventory drift/);
 for(const f of ['mini/src/api/client.ts','mini/src/security/deviceProof.ts','mini/components/Logo.tsx','mini/components/CashierScreen.tsx','mini/components/Receipt.tsx'])assert.equal(authThemeSource('protected',f),null);
 assert.equal(authPaintDigest(source),reviewedAuthPaint[authLoginFile]);
});
test('deterministic CSS changes only color paint inside auth roots and screen media',()=>{
 assert.equal(css,buildAuthCSS(workspace));const props=new Set(['color','background-color','border-color','border-top-color','border-right-color','border-bottom-color','border-left-color','fill','background-image','box-shadow','text-shadow','--tw-shadow','--tw-shadow-color','--tw-ring-color','--tw-drop-shadow','--tw-gradient-from','--tw-gradient-to','--tw-gradient-stops','--omar-mini-auth-red','--omar-brand-color']);
 root.walkRules(r=>{assert.equal(r.parent.name,'media');assert.equal(r.parent.params,'screen');for(const s of r.selectors)assert.match(s,/^html\[data-omar-mini-theme="foundation"\] \[data-omar-mini-auth(?:\]|="[^"]+"\])/);r.walkDecls(d=>{assert.ok(props.has(d.prop),d.prop);assert.ok(!d.important);assert.notEqual(d.value,'none');});});assert.ok(!css.includes('@media print'));
});
test('source alpha, focus shadows, logo glow and state precedence retain their original forms',()=>{
 const source=read(authLoginFile)+'\n'+Object.values(authAppPanels(read(authAppFile))).join('\n');let alphas=0;
 for(const c of inventoryClasses(source)){const p=authPaint(c);if(!p)continue;const alpha=c.match(/\/(\d+|\[[\d.]+\])$/)?.[1];for(const [key,value]of Object.entries(p.declarations)){if(p.originalEffect)assert.equal(colorForm(value),colorForm(p.originalEffect));else if(alpha&&!(key==='--tw-gradient-to'&&c.startsWith('from-'))){const pct=alpha.startsWith('[')?Number(alpha.slice(1,-1))*100:Number(alpha);assert.ok(value.includes(' '+pct+'%, transparent)'),c);alphas++;}}}
 assert.equal(alphas,14);assert.ok(css.indexOf('[class~="border-white/10"]')<css.indexOf('[class~="border-t-[#E6D690]"]'),'Border-top paint must follow shorthand border color');for(const form of ['0 0 10px rgba(216,184,135,0.3)','0 0 20px rgba(216,184,135,0.4)','0 0 8px rgba(216,184,135,0.5)'])assert.ok(css.includes(form));
 assert.ok(css.indexOf('[class~="hover:')<css.indexOf('[class~="group-focus-within:'));assert.ok(css.includes('data-omar-mini-auth-semantic="warning"'));assert.ok(css.includes('data-omar-mini-auth-semantic="success"'));assert.ok(css.includes('data-omar-mini-auth-semantic="error"'));
});
test('approved cashier white asset, sizing and other themes remain unchanged; no canonical/Admin/print/auth source diff',()=>{
 const protectedHashes={
 'local/omar/cashier-header-logo.css':'8aa59711ef6ce3e7e939961bface9a3c71831538a424b733b138ab7a6d026b27',
 'local/omar/cashier-header-logo.mjs':'2fd742c19d9ba5d826fabadf8ecb3cae21473efca25f04f31533119204fae1f9',
 'local/omar/assets/cashier-header-logo-white-tight.svg':'41cfe4dc30039a7954b3d72c658db01d195c59bd96f4c01c5f5d8b3c52bcf996',
 'local/omar/mini-theme.css':'6564445188c15149432fbfd758b9f18eea30ce6c89167aebbe165b0554c827cd',
 'local/omar/mini-operational-theme.css':'04eb1fac13d00dbe6a44f71a8e7d1f2300ca061d26d5e303abd44c3b0fe1ef90'};
 for(const[f,h]of Object.entries(protectedHashes))assert.equal(hash(read(f)),h,f);
 assertCanonicalRuntimeUnchanged(workspace);
});
test('offline harness never loads live API/security/whole App or reads browser credentials',()=>{
 const fixture=read('local/omar/mini-auth-visual-fixture.mjs');for(const text of ["connect-src 'none'","form-action 'none'",'req.socket.remoteAddress',"'enabled'",'Unreviewed fixture action','real enrollment forbidden','authAppPanels'])assert.ok(fixture.includes(text));
 assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(/.test(fixture));assert.ok(!fixture.includes("import App from"));
});
if(process.env.OMAR_AUTH_EVIDENCE){
 const dir=fs.realpathSync(process.env.OMAR_AUTH_EVIDENCE);assert.ok(dir.startsWith(workspace+'/.local/hassan/'));const{compareInventorySnapshots}=await import('./mini-inventory-fidelity.mjs');const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 for(const state of manifest)test('auth full computed RGB-only fidelity: '+state,()=>{
  const b=JSON.parse(fs.readFileSync(path.join(dir,state+'-before.json'),'utf8')),a=JSON.parse(fs.readFileSync(path.join(dir,state+'-after.json'),'utf8'));assert.ok(b.nodes.length>0);assert.ok(Object.keys(b.nodes[0].style).length>400);
  const result=compareInventorySnapshots(b,a);
  const staticMismatches=result.mismatches.filter(m=>{if(m[1]!=='box')return true;const index=m[0];if(b.nodes[index]?.style['animation-name']!=='spin'||a.nodes[index]?.style['animation-name']!=='spin')return true;for(const prop of ['width','height','transform-origin','animation-duration','animation-timing-function','animation-iteration-count'])assert.equal(b.nodes[index].style[prop],a.nodes[index].style[prop]);return false;});
  assert.deepEqual(staticMismatches,[]);
  for(const[i,p]of result.timingSamples){assert.ok(['transform','rotate'].includes(p));assert.equal(b.nodes[i].style['animation-name'],'spin');assert.equal(a.nodes[i].style['animation-name'],'spin');}
 });
}
