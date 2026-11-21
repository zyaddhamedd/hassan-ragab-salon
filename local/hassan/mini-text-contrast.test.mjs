import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';
import{omarTextContrast,textContrastStylesheet}from'./mini-text-contrast.mjs';import{assertCanonicalRuntimeUnchanged}from'./canonical-runtime-guard.mjs';import{parseColor,blend,contrast,auditText}from'./text-contrast-audit.mjs';
import miniConfig from'./mini.vite.config.mjs';import adminConfig from'./admin.vite.config.mjs';
const workspace=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(workspace,'mini/package.json'));
test('type-only expense and inventory fixes preserve all canonical runtime JS and API payloads',()=>assertCanonicalRuntimeUnchanged(workspace));
test('contrast layer only activates in Omar Mini and imports no business code',async()=>{
 for(const[app,mode]of[['admin','omar'],['mini','production'],['mini','development']])assert.equal(omarTextContrast({workspace,app,mode}),null);
 const mini=await miniConfig({mode:'omar'}),admin=await adminConfig({mode:'omar'});
 assert.ok(mini.plugins.flat().some(p=>p?.name==='omar-mini-text-contrast'));assert.ok(!admin.plugins.flat().some(p=>p?.name==='omar-mini-text-contrast'));
 const plugin=omarTextContrast({workspace,app:'mini',mode:'omar'});assert.equal(plugin.transform('unchanged',path.join(workspace,'mini/App.tsx')),undefined);
});
test('contrast CSS changes only text colors and two exact text-only opacity exceptions; print, icons, disabled and other screens protected',()=>{
 const root=require('postcss').parse(fs.readFileSync(textContrastStylesheet,'utf8'));let opacityCount=0;
 root.walkRules(rule=>{
 assert.equal(rule.parent.type,'atrule');assert.equal(rule.parent.name,'media');assert.equal(rule.parent.params,'screen');
 for(const selector of rule.selectors){assert.ok(selector.startsWith('html[data-omar-mini-theme="foundation"]'));assert.match(selector,/data-omar-mini-(?:screen="attendance"|auth="login"|inventory)/);}
 rule.walkDecls(d=>{assert.ok(['color','opacity'].includes(d.prop));if(d.prop==='opacity'){opacityCount++;assert.equal(d.value,'1');assert.match(rule.selector,/p\[class~="opacity-30"\]|label\[class~="opacity-60"\]/);}});
 });assert.equal(opacityCount,2);
 const css=root.toString();assert.ok(css.includes('button:disabled *'));assert.ok(css.includes(':not(:has(*))'));assert.ok(css.includes('.receipt-print *'));assert.ok(!css.includes('!important'));assert.ok(!css.includes('Cashier'));
});
test('sRGB audit composites foreground alpha and preserves gradient bounds',()=>{
 assert.equal(contrast([255,255,255],[0,0,0]),21);assert.deepEqual(blend([255,255,255,.2],[0,0,0]),[51,51,51]);assert.deepEqual(parseColor('color(srgb 1 0 0 / 0.5)'),[255,0,0,.5]);
 const a=auditText({fg:'rgb(180, 190, 195)',pseudo:'',chain:[{bg:'rgb(43, 60, 69)',image:'none',opacity:'1'}]});assert.ok(a.minRatio>=4.5);
});
if(process.env.OMAR_QUALITY_EVIDENCE){const dir=fs.realpathSync(process.env.OMAR_QUALITY_EVIDENCE);assert.ok(dir.startsWith(workspace+'/.local/hassan/'));
 for(const name of ['attendance','login','inventory','login-focus','inventory-focus'])test('recorded rendered '+name+' text passes 4.5:1 and retains non-text design',()=>{
  const d=JSON.parse(fs.readFileSync(path.join(dir,name+'.json'),'utf8'));assert.deepEqual(d.before.viewport,d.after.viewport);assert.deepEqual(d.before.document,d.after.document);assert.equal(d.before.nodes.length,d.after.nodes.length);
  for(let i=0;i<d.after.texts.length;i++){const a=auditText(d.after.texts[i]);assert.ok(a.minRatio>=4.5,name+': '+a.text+' '+a.minRatio);}
  d.before.nodes.forEach((b,i)=>{const a=d.after.nodes[i];assert.equal(a.box,b.box);assert.equal(a.cls,b.cls);assert.equal(a.tag,b.tag);const styles=Object.fromEntries(a.style);for(const[prop,value]of b.style){if(prop.includes('color'))continue;if(prop==='opacity'&&((name==='attendance'&&b.tag==='P'&&b.cls.includes('opacity-30'))||(name.startsWith('login')&&b.tag==='LABEL'&&b.cls.includes('opacity-60'))))continue;assert.equal(styles[prop],value,name+': '+i+' '+prop);}});
 });
}
