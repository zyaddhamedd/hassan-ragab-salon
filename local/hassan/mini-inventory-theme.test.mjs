import {assertCanonicalRuntimeUnchanged} from './canonical-runtime-guard.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire}from 'node:module';import {execFileSync}from 'node:child_process';
import {inventoryFiles,inventoryHooks,inventoryThemeSource,inventoryDigest,reviewedInventoryPaint,inventoryClasses,inventoryPaint,inventoryColor,buildInventoryCSS,inventoryStylesheet,omarInventoryTheme}from './mini-inventory-theme.mjs';
const workspace=path.resolve(import.meta.dirname,'../..'),read=f=>fs.readFileSync(path.join(workspace,f),'utf8');const require=createRequire(path.join(workspace,'mini/package.json'));const css=fs.readFileSync(inventoryStylesheet,'utf8'),root=require('postcss').parse(css);
const form=v=>v.replace(/rgba?\(([^)]*)\)/g,(_,s)=>'COLOR('+(s.split(',')[3]||'1')+')').replace(/#[\da-f]{3,8}\b/gi,'COLOR(1)').replaceAll(' ','');
test('inventory activation is Omar Mini only; hooks are attribute-only and fail closed',()=>{
 for(const [app,mode]of [['admin','omar'],['mini','production'],['mini','development']])assert.equal(omarInventoryTheme({workspace,app,mode}),null);
 for(const f of inventoryFiles){const s=read(f);assert.equal(inventoryDigest(s),reviewedInventoryPaint[f]);const themed=inventoryThemeSource(s,f);if(themed){let restored=themed;for(const [before,after]of inventoryHooks[f])restored=restored.replaceAll(after,before);assert.equal(restored,s);assert.throws(()=>inventoryThemeSource(themed,f),/hook drift/);}assert.throws(()=>inventoryThemeSource(s+' // bg-[#NEW]',f),/paint drift/);}
 assert.equal(inventoryThemeSource('protected','mini/components/CashierScreen.tsx'),null);
});
test('deterministic screen-only inventory CSS permits color declarations only',()=>{
 assert.equal(css,buildInventoryCSS(workspace));const props=new Set(['color','background-color','border-color','border-top-color','border-right-color','border-bottom-color','border-left-color','fill','background-image','--tw-gradient-from','--tw-gradient-to','--tw-gradient-stops','--tw-shadow','--tw-shadow-color','--tw-ring-color','--tw-drop-shadow','--omar-mini-inventory-action']);
 root.walkRules(r=>{assert.equal(r.parent.name,'media');assert.equal(r.parent.params,'screen');for(const s of r.selectors)assert.match(s,/^html\[data-omar-mini-theme="foundation"\] \[data-omar-mini-inventory\]/);r.walkDecls(d=>{assert.ok(props.has(d.prop),d.prop);assert.ok(!d.important);assert.notEqual(d.value,'none');});});assert.ok(!css.includes('@media print'));
});
test('effects preserve exact form/alpha and classes retain their original state variants',()=>{
 let effects=0,alphas=0;for(const f of inventoryFiles)for(const c of inventoryClasses(read(f))){const p=inventoryPaint(c);if(!p)continue;const alpha=c.match(/\/(\d+|\[[\d.]+\])$/)?.[1];for(const [key,value]of Object.entries(p.declarations)){if(p.originalEffect){assert.equal(form(value),form(p.originalEffect),c);effects++;}else if(alpha&&!(key==='--tw-gradient-to'&&c.startsWith('from-'))){const percent=alpha.startsWith('[')?Number(alpha.slice(1,-1))*100:Number(alpha);assert.ok(value.includes(' '+percent+'%, transparent)'),c);alphas++;}}if(/^(hover|focus|active|disabled):/.test(c))assert.equal(p.variant,c.match(/^((?:(?:hover|focus|active|disabled):)+)/)[1].slice(0,-1));}
 assert.ok(effects>10);assert.ok(alphas>100);assert.ok(inventoryPaint('via-[#141416]/20').declarations['--tw-gradient-stops'].includes('20%, transparent)'));
});
test('semantic status channels remain distinct and destructive badges keep red',()=>{
 for(const [c,t]of [['emerald-400','success'],['red-400','error'],['amber-400','warning'],['sky-400','info']])assert.ok(inventoryColor(c,undefined,'text').includes(t));assert.ok(css.includes('text-[#ff9a96]'));assert.ok(css.includes('--omar-mini-inventory-action: var(--omar-mini-error)'));
});
test('canonical Mini, Admin, backend, default configuration and receipt markup remain unchanged',()=>{
 assertCanonicalRuntimeUnchanged(workspace);
 for(const f of ['mini/components/Receipt.tsx','mini/components/AttendanceScreen.tsx','mini/App.tsx','mini/components/LoginScreen.tsx'])assert.equal(inventoryThemeSource('protected',f),null);
});

test('unsupported source opacity utilities remain untouched; nested disabled hover and placeholders are preserved',()=>{
 for(const c of ['border-white/8','bg-[#E53935]/6','border-[#E6D690]/14','border-red-500/12'])assert.equal(inventoryPaint(c),null);
 assert.equal(inventoryPaint('disabled:hover:bg-white/5').variant,'disabled:hover');
 assert.ok(css.includes('[class~="disabled:hover:bg-white/5"]:disabled:hover'));
 assert.ok(css.includes('[class~="placeholder-white/20"]::placeholder'));
});

test('offline visual fixture is separately bundled, network-denied, mutation-denied and gated to loopback dev',()=>{
 const fixture=read('local/omar/mini-inventory-visual-fixture.mjs');
 for(const text of ["connect-src 'none'","form-action 'none'","mutations forbidden","Unreviewed fixture GET", "req.socket.remoteAddress", "'enabled'", "req.method"])assert.ok(fixture.includes(text),text);
 assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(/.test(fixture));
 const plugin=omarInventoryTheme({workspace,app:'mini',mode:'omar'});
 const original=read('mini/index.tsx'),transformed=plugin.transform(original,path.join(workspace,'mini/index.tsx')).code;
 assert.ok(!transformed.includes('fixture'));assert.ok(transformed.includes('mini-inventory-theme.css'));
});

const evidence=process.env.OMAR_INVENTORY_EVIDENCE;
if(evidence){
 const directory=fs.realpathSync(evidence);assert.ok(directory.startsWith(workspace+'/.local/hassan/'));
 const {compareInventorySnapshots}=await import('./mini-inventory-fidelity.mjs');
 const results=JSON.parse(fs.readFileSync(path.join(directory,'fidelity-results.json'),'utf8'));
 for(const name of Object.keys(results).filter(n=>n!=='mobile390-loading'))test('live non-RGB fidelity: '+name,()=>{
  const b=JSON.parse(fs.readFileSync(path.join(directory,name+'-before.json'),'utf8')),a=JSON.parse(fs.readFileSync(path.join(directory,name+'-after.json'),'utf8'));
  assert.ok(b.nodes.length>0);assert.ok(Object.keys(b.nodes[0].style).length>400,'Complete computed styles, not just geometry');
  const r=compareInventorySnapshots(b,a);assert.deepEqual(r.mismatches,[]);
  for(const [i,property,bv,av]of r.timingSamples){assert.equal(property,'opacity');assert.equal(b.nodes[i].style['animation-name'],'pulse');assert.equal(a.nodes[i].style['animation-name'],'pulse');assert.equal(b.nodes[i].style['animation-duration'],a.nodes[i].style['animation-duration']);for(const sample of [bv,av])assert.ok(Number(sample)>=0.5&&Number(sample)<=1);}
 });
 test('loading spinner timing differences are confined to rotating bounding boxes; styles stay identical except RGB',()=>{
  const b=JSON.parse(fs.readFileSync(path.join(directory,'mobile390-loading-before.json'),'utf8')),a=JSON.parse(fs.readFileSync(path.join(directory,'mobile390-loading-after.json'),'utf8'));
  const r=compareInventorySnapshots(b,a);assert.ok(r.mismatches.length>0);assert.ok(r.mismatches.every(m=>m[1]==='box'&&[4,5].includes(m[0])));
  assert.equal(b.nodes[4].style['animation-name'],'spin');assert.equal(a.nodes[4].style['animation-name'],'spin');
  for(const p of ['animation-duration','animation-timing-function','animation-iteration-count','width','height','transform-origin'])assert.equal(b.nodes[4].style[p],a.nodes[4].style[p]);
 });
}
