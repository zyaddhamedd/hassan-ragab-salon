import {assertCanonicalRuntimeUnchanged as assertStandaloneSource} from './canonical-runtime-guard.mjs';
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createRequire}from'node:module';import{execFileSync}from'node:child_process';
import{adminPalette,adminShellHooks,adminThemeSource,adminThemeStylesheet,buildAdminThemeCSS,omarAdminTheme,shellPaint}from'./admin-theme.mjs';import{compareAdminShell,normalizeAdminRGB}from'./admin-shell-fidelity.mjs';import adminConfig from'./admin.vite.config.mjs';import miniConfig from'./mini.vite.config.mjs';import{brandSource}from'./branding.mjs';
const workspace=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(workspace,'admin/package.json')),read=f=>fs.readFileSync(path.join(workspace,f),'utf8'),css=read('local/omar/admin-theme.css');
test('explicit Omar Admin activation only; plugin after isolation/branding and before React',async()=>{
 for(const[app,mode]of[['mini','omar'],['admin','production'],['admin','development']])assert.equal(omarAdminTheme({workspace,app,mode}),null);
 const config=await adminConfig({mode:'omar'}),mini=await miniConfig({mode:'omar'}),names=config.plugins.flat().filter(Boolean).map(p=>p.name);
 assert.ok(names.indexOf('omar-admin-theme-foundation')>names.indexOf('omar-visible-branding'));assert.ok(names.indexOf('omar-admin-theme-foundation')<names.indexOf('vite:react-babel'));assert.ok(!mini.plugins.flat().some(p=>p?.name==='omar-admin-theme-foundation'));
});
test('exact attribute-only source hooks preserve every class, handler, structure and condition',()=>{
 for(const[file,hooks]of Object.entries(adminShellHooks)){const raw=read(file),source=brandSource(raw,file),result=adminThemeSource(source,file);let restored=result;for(const[b,a]of[...hooks].reverse())restored=restored.replace(a,b);assert.equal(restored,source);assert.throws(()=>adminThemeSource(result,file),/drift/);}
 assert.throws(()=>adminThemeSource(read('admin/components/Header.tsx')+'\n// text-[#112233]','admin/components/Header.tsx'),/paint drift/);
});
test('all protected pages, Mini, charts, auth, receipt and exports excluded',()=>{
 for(const f of ['admin/components/Dashboard.tsx','admin/components/RevenueChart.tsx','admin/components/LoginScreen.tsx','admin/components/InvoiceDetailsModal.tsx','admin/components/invoices/AuthenticReceiptViewer.tsx','mini/App.tsx','mini/components/Receipt.tsx','admin/utils/fileDownload.ts'])assert.equal(adminThemeSource('protected',f),null);
 assert.equal(assertStandaloneSource(workspace),'');
});
test('stylesheet generation deterministic; only Dark screen paint and original shadow channels',()=>{
 assert.equal(css,buildAdminThemeCSS(workspace));const root=require('postcss').parse(css);let vars={};
 root.walkRules(r=>{assert.equal(r.parent.type,'atrule');assert.equal(r.parent.name,'media');assert.equal(r.parent.params,'screen');assert.ok(r.selector.startsWith('html[data-omar-admin-theme="foundation"]'));
 if(r.selector.includes('[data-omar-admin-header-subtitle]')){assert.equal(r.selector,'html[data-omar-admin-theme="foundation"] [data-omar-admin-region="header"] [data-omar-admin-header-subtitle]');assert.equal(r.nodes.length,1);assert.equal(r.nodes[0].prop,'visibility');assert.equal(r.nodes[0].value,'hidden');return;}
 if(r.selector!=='html[data-omar-admin-theme="foundation"]')assert.match(r.selector,/data-omar-admin-mode="dark"|data-omar-admin-shell="dark"/);
 r.walkDecls(d=>{if(d.prop.startsWith('--omar-admin-')){if(d.prop!=='--omar-admin-navigation-accent')vars[d.prop]=d.value;return;}assert.ok(['background-color','color','border-color','outline-color','scrollbar-color','--tw-shadow'].includes(d.prop),d.prop);if(d.prop==='--tw-shadow')assert.equal(normalizeAdminRGB(d.value.replace('#D8B887','rgb(168,144,106)')),normalizeAdminRGB('0 0 4px rgb(229,57,53)'));});});
 assert.deepEqual(vars,Object.fromEntries(Object.entries(adminPalette).map(([k,v])=>['--omar-admin-'+k,v])));assert.ok(!css.includes('!important'));assert.ok(!css.includes('@media print'));assert.ok(!css.includes('body'));
});
test('source alpha and state forms preserved; existing focus geometry and logos protected',()=>{
 for(const[cls,alpha]of[['bg-[#E53935]/15','15%'],['bg-[rgba(229,57,53,0.18)]','18%'],['hover:bg-[rgba(229,57,53,0.10)]','10%'],['text-white/40','40%']])assert.ok(Object.values(shellPaint(cls,'sidebar').declarations).some(v=>v.includes(alpha)));
 assert.ok(css.includes('outline-color:'));assert.ok(!css.includes('outline-offset'));assert.ok(css.includes('.admin-side-nav-brand *'));assert.ok(css.includes(':not(:has(.omar-wordmark))'));assert.ok(css.includes('[data-omar-admin-semantic="logout"] { --omar-admin-navigation-accent: #EF3434; }'));
});
if(process.env.OMAR_ADMIN_SHELL_EVIDENCE){const dir=fs.realpathSync(process.env.OMAR_ADMIN_SHELL_EVIDENCE);assert.ok(dir.startsWith(workspace+'/.local/hassan/'));for(const name of ['collapsed','expanded','hover','light','mobile','drawer','dropdown'])test('computed fidelity '+name+' — RGB only, protected content raw identical',()=>{
 const b=JSON.parse(fs.readFileSync(path.join(dir,name+'-before.json'))),a=JSON.parse(fs.readFileSync(path.join(dir,name+'-after.json')));assert.deepEqual(compareAdminShell(b,a,{light:name==='light'}),[]);
 const nav=a.nodes.find(n=>n.tag==='ASIDE'&&n.cls.includes('admin-side-nav'));assert.equal(JSON.parse(nav.box).width,name==='collapsed'||name==='dropdown'||name==='light'?72:256);
 if(name==='collapsed'){const h=a.nodes.find(n=>n.tag==='HEADER');assert.equal(JSON.parse(h.box).height,80);}
});}

test('header subtitle is hidden without collapsing its line box; only Omar Header in screen media',()=>{
 const source=brandSource(read('admin/components/Header.tsx'),'admin/components/Header.tsx');const themed=adminThemeSource(source,'admin/components/Header.tsx');assert.equal(themed.split('data-omar-admin-header-subtitle').length,2);assert.ok(themed.includes('{pageTitle}'));assert.ok(themed.includes('height: \'var(--app-header-height)\''));assert.ok(themed.includes('<OmarWordmark compact />'));
 const root=require('postcss').parse(css);const changes=[];root.walkDecls('visibility',d=>changes.push([d.parent.selector,d.value]));assert.deepEqual(changes,[['html[data-omar-admin-theme="foundation"] [data-omar-admin-region="header"] [data-omar-admin-header-subtitle]','hidden']]);root.walkDecls(d=>assert.ok(!['display','height','width','min-height','margin','padding','position','transform','opacity'].includes(d.prop),d.prop));
});
test('logout vivid red is Dark-sidebar-local and leaves opacity/visibility/behavior alone',()=>{
 const r=require('postcss').parse(css);const matches=[];r.walkDecls('--omar-admin-navigation-accent',d=>matches.push([d.parent.selector,d.value]));assert.deepEqual(matches,[['html[data-omar-admin-theme="foundation"] [data-omar-admin-region="sidebar"][data-omar-admin-mode="dark"] [data-omar-admin-semantic="logout"]','#EF3434']]);assert.ok(adminThemeSource(brandSource(read('admin/components/SideNav.tsx'),'admin/components/SideNav.tsx'),'admin/components/SideNav.tsx').includes('onClick={onLogout}'));
});
