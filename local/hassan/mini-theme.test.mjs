import path from 'node:path';
import {assertCanonicalRuntimeUnchanged} from './canonical-runtime-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import miniConfig from './mini.vite.config.mjs';
import adminConfig from './admin.vite.config.mjs';
import {omarMiniTheme, themeSource, presentationHooks, themeStylesheet} from './mini-theme.mjs';
const workspace=path.resolve(import.meta.dirname,'../..');
const require=createRequire(workspace+'/mini/package.json');
const postcss=require('postcss');
const css=fs.readFileSync(themeStylesheet,'utf8');
const root=postcss.parse(css);
const prefix='html[data-omar-mini-theme="foundation"]';

test('only Omar Mini config activates theme, after isolation and before React',async()=>{
 const mini=await miniConfig({mode:'omar'}),admin=await adminConfig({mode:'omar'});
 const names=mini.plugins.flat().filter(Boolean).map(p=>p.name);
 assert.ok(names.indexOf('omar-local-isolation')<names.indexOf('omar-mini-theme-foundation'));
 assert.ok(names.indexOf('omar-visible-branding')<names.indexOf('omar-mini-theme-foundation'));
 assert.ok(names.indexOf('omar-mini-theme-foundation')<names.indexOf('vite:react-babel'));
 assert.ok(!admin.plugins.flat().filter(Boolean).some(p=>p.name==='omar-mini-theme-foundation'));
 for(const [app,mode] of [['admin','omar'],['mini','production'],['mini','development']])assert.equal(omarMiniTheme({workspace,app,mode}),null);
 const plugin=omarMiniTheme({workspace,app:'mini',mode:'omar'});
 assert.match(plugin.transformIndexHtml.handler('<html lang="ar"><body></body></html>'),/data-omar-mini-theme="foundation"/);
 assert.throws(()=>plugin.transformIndexHtml.handler('<body/>'),/drift/);
 assert.equal(plugin.transform('untouched',workspace+'/admin/index.tsx'),null);
 assert.match(plugin.transform('entry',workspace+'/mini/index.tsx').code,/mini-theme\.css/);
});

test('hooks only add presentation attributes; existing classes, handlers and conditions are byte-identical',()=>{
 for(const [relative,hooks] of Object.entries(presentationHooks)){
  const source=fs.readFileSync(workspace+'/'+relative,'utf8');const styled=themeSource(source,relative);
  let reversed=styled;for(const [before,after] of [...hooks].reverse())reversed=reversed.replace(after,before);
  assert.equal(reversed,source);
  assert.throws(()=>themeSource(styled,relative),/drift/);
  assert.throws(()=>themeSource('different source',relative),/drift/);
 }
 for(const relative of ['mini/components/CashierScreen.tsx','mini/components/InvoiceSection.tsx','mini/components/LoginScreen.tsx','mini/components/Receipt.tsx','mini/components/ReceiptPrintLayout.tsx','mini/components/WaitingScreen.tsx','mini/components/AppointmentDepositReceipt.tsx','mini/components/Logo.tsx'])assert.equal(themeSource('protected source',relative),null);
});

test('all CSS is screen-only, marker-scoped and limited to original color paint; no effect/geometry/typography resets',()=>{
 const allowed=new Set(['background-color','background-image','color','border-color','border-top-color','border-right-color','border-bottom-color','border-left-color','fill','--tw-shadow','--tw-shadow-color','--tw-ring-color','--tw-gradient-from','--tw-gradient-to']);
 root.walkRules(rule=>{
  let parent=rule.parent;while(parent&&!(parent.type==='atrule'&&parent.name==='media'&&parent.params==='screen'))parent=parent.parent;
  assert.ok(parent,'Every rule must be inside screen media');
  for(const selector of rule.selectors){
   assert.ok(selector.startsWith(prefix));
   if(selector!==prefix)assert.match(selector,/\[data-omar-mini-/);
   assert.ok(!/Cashier|Invoice|receipt|print-area|\.mini-shell|\.custom-scrollbar|\bbody\b/.test(selector));
  }
  rule.walkDecls(d=>assert.ok(d.prop.startsWith('--omar-mini-')||allowed.has(d.prop),'Forbidden property: '+d.prop));
 });
 assert.ok(!/@media\s+print/.test(css));
 assert.ok(!root.nodes.some(n=>n.type!=='comment'&&n.type!=='atrule'));
 const shell=root.nodes.find(n=>n.type==='atrule').nodes.find(n=>n.type==='rule'&&n.selector.endsWith('[data-omar-mini-shell]'));
 assert.deepEqual(shell.nodes.filter(n=>n.type==='decl').map(n=>n.prop),['background-color']);
});

test('all seventeen approved palette tokens are exact; canonical/default and protected assets stay at baseline',()=>{
 const values=['page:#162127','input:#1A282F','surface:#1E2C33','card:#273740','border:#3A4C56','text:#F3F4F2','text-secondary:#B4BEC3','text-muted:#96A5AE','accent:#D8B887','on-accent:#17232A','hover:#E4C99F','pressed:#C4A474','selected:#35434A','success:#79B69B','warning:#D6B576','error:#DF9290','info:#91B7CC'];
 const tokens={};root.walkRules(r=>{if(r.selector===prefix)r.walkDecls(d=>{if(d.prop.startsWith('--omar-mini-'))tokens[d.prop]=d.value;});});
 assert.deepEqual(tokens,Object.fromEntries(values.map(s=>{const [k,v]=s.split(':');return ['--omar-mini-'+k,v];})));
 assertCanonicalRuntimeUnchanged(workspace,['local/omar/wordmark.mjs','local/omar/wordmark-ink.svg']);
 assert.ok(!fs.readFileSync(workspace+'/mini/vite.config.ts','utf8').includes('mini-theme'));
});
