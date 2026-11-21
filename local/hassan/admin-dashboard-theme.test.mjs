import {assertCanonicalRuntimeUnchanged as assertStandaloneSource} from './canonical-runtime-guard.mjs';
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createRequire}from'node:module';import{execFileSync}from'node:child_process';
import{dashboardFiles,dashboardHooks,dashboardThemeSource,dashboardPaint,buildDashboardCSS,dashboardHierarchy,omarDashboardTheme}from'./admin-dashboard-theme.mjs';import{normalizeAdminRGB}from'./admin-shell-fidelity.mjs';import adminConfig from'./admin.vite.config.mjs';import miniConfig from'./mini.vite.config.mjs';
const workspace=path.resolve(import.meta.dirname,'../..'),require=createRequire(path.join(workspace,'admin/package.json')),read=f=>fs.readFileSync(path.join(workspace,f),'utf8');
test('Dashboard is Omar Admin-only after shell/isolation and before React',async()=>{
 for(const[app,mode]of[['mini','omar'],['admin','development'],['admin','production']])assert.equal(omarDashboardTheme({workspace,app,mode}),null);
 const a=await adminConfig({mode:'omar'}),m=await miniConfig({mode:'omar'}),names=a.plugins.flat().filter(Boolean).map(p=>p.name);assert.ok(names.indexOf('omar-admin-dashboard-theme')>names.indexOf('omar-admin-theme-foundation'));assert.ok(names.indexOf('omar-admin-dashboard-theme')<names.indexOf('vite:react-babel'));assert.ok(!m.plugins.flat().some(p=>p?.name==='omar-admin-dashboard-theme'));
});
test('three component transforms are attribute-only; all financial, chart data, domains, formatting, events and animations restore byte-for-byte',()=>{
 for(const f of dashboardFiles){const source=read(f),themed=dashboardThemeSource(source,f);let restored=themed;for(const[b,a]of[...dashboardHooks[f]].reverse())restored=restored.replaceAll(a,b);assert.equal(restored,source);assert.throws(()=>dashboardThemeSource(themed,f),/drift/);assert.throws(()=>dashboardThemeSource(source+'\n// bg-[#112233]',f),/drift/);}
});
test('Attendance, Expenses, shell, auth, documents, Mini and canonical sources unchanged',()=>{
 for(const f of ['admin/components/AttendanceScreen.tsx','admin/components/ExpensesPage.tsx','admin/components/LoginScreen.tsx','admin/components/Header.tsx','admin/components/SideNav.tsx','admin/components/invoices/AuthenticReceiptViewer.tsx','mini/App.tsx','mini/components/Receipt.tsx'])assert.equal(dashboardThemeSource('protected',f),null);
 assert.equal(assertStandaloneSource(workspace),'');
});
test('deterministic Dashboard CSS is Dark/screen paint only; effect alpha preserved with reviewed opacity exceptions',()=>{
 const css=read('local/omar/admin-dashboard-theme.css');assert.equal(css,buildDashboardCSS(workspace));const root=require('postcss').parse(css),props=new Set(['background-color','background-image','color','border-color','border-top-color','fill','stroke','stop-color','--tw-shadow','--tw-shadow-color','--tw-drop-shadow','--tw-ring-color','--tw-gradient-from','--tw-gradient-to','--tw-gradient-stops','--omar-admin-dashboard-red','opacity',...Object.keys(dashboardHierarchy).map(n=>'--omar-admin-dashboard-'+n)]);
 root.walkRules(r=>{assert.equal(r.parent.name,'media');assert.equal(r.parent.params,'screen');for(const s of r.selectors)assert.ok(s.startsWith('html[data-omar-admin-theme="foundation"] [data-omar-admin-dashboard="dark"]'));r.walkDecls(d=>assert.ok(props.has(d.prop),d.prop));});assert.ok(!css.includes('!important'));assert.ok(!css.includes('@media print'));
 const pattern=/(?<![\w:-])(?:(?:[\w-]+):)*(?:bg|text|border(?:-[lrtbxy])?|from|via|to|shadow|drop-shadow|ring)-(?:\[[^\]\s]+\]|white|black|(?:gray|emerald|red|yellow|amber|blue|cyan)-\d+)(?:\/(?:\d+|\[[\d.]+\]))?/g;
 for(const f of dashboardFiles)for(const c of read(f).match(pattern)||[]){const p=dashboardPaint(c);if(p?.originalEffect)assert.equal(normalizeAdminRGB(Object.values(p.declarations)[0]),normalizeAdminRGB(p.originalEffect));}
 assert.match(dashboardPaint('bg-red-500/10').declarations['background-color'],/10%/);assert.match(dashboardPaint('from-[#E53935]').declarations['--tw-gradient-from'],/accent/);assert.match(dashboardPaint('to-[#FF5252]').declarations['--tw-gradient-to'],/hover/);
});
test('chart roles are distinct and score/negative status classifications unchanged',()=>{
 const css=read('local/omar/admin-dashboard-theme.css');assert.ok(css.includes('[stroke="#ef4444"] { stroke: #EF3434'));assert.ok(css.includes('[stroke="#10b981"] { stroke: var(--omar-admin-dashboard-profit)'));assert.ok(css.includes('circle[stroke="#ef4444"] { stroke: #EF3434'));assert.ok(css.includes('circle[stroke="#fbbf24"] { stroke: #F5A623'));assert.equal(dashboardPaint('text-red-500').declarations.color,'#EF3434');assert.equal(dashboardPaint('text-emerald-500').declarations.color,'#16C784');
});
if(process.env.OMAR_DASHBOARD_EVIDENCE){const dir=fs.realpathSync(process.env.OMAR_DASHBOARD_EVIDENCE);assert.ok(dir.startsWith(workspace+'/.local/hassan/'));const{compareDashboardSnapshots}=await import('./admin-dashboard-fidelity.mjs');
 for(const name of ['real','real-filter','fixture','tooltip','light','loading','error','empty','focus'])test('recorded '+name+' preserves non-RGB static design and unchanged original animation timelines',()=>{
  const before=JSON.parse(fs.readFileSync(path.join(dir,name+'-before.json'))),after=JSON.parse(fs.readFileSync(path.join(dir,name+'-after.json')));const result=compareDashboardSnapshots(before,after,{light:name==='light'});assert.deepEqual(result.staticDifferences,[]);assert.deepEqual(before.texts,after.texts);
  // Complete-state chart path data is compared exactly, independently of paint.
  if(['real','fixture'].includes(name))assert.deepEqual(before.nodes.map(n=>n.svg),after.nodes.map(n=>n.svg));
  if(name==='fixture'){for(const value of ['85','65','45'])assert.ok(before.texts.includes(value));for(const[source,target]of [['rgb(16, 185, 129)','rgb(121, 182, 155)'],['rgb(251, 191, 36)','rgb(214, 181, 118)'],['rgb(239, 68, 68)','rgb(223, 146, 144)']]){const indices=before.nodes.map((n,i)=>n.tag==='circle'&&Object.fromEntries(n.style).stroke===source?i:-1).filter(i=>i>=0);assert.ok(indices.length>0);indices.forEach(i=>assert.equal(Object.fromEntries(after.nodes[i].style).stroke,target));}}
 });
}

test('hierarchy refinement is Dashboard-local, keeps financial roles and matches tooltip markers to series',()=>{
 const css=read('local/omar/admin-dashboard-theme.css');
 assert.deepEqual(dashboardHierarchy,{card:'#304B58',chart:'#11242D',secondary:'#E1EBEF',muted:'#C9DCE5',profit:'#16C784',accent:'#D8B887'});
 assert.equal(dashboardPaint('bg-[#151515]').declarations['background-color'],'var(--omar-admin-dashboard-card)');
 assert.equal(dashboardPaint('bg-[#0c0c0c]').declarations['background-color'],'var(--omar-admin-dashboard-chart)');
 assert.equal(dashboardPaint('bg-[#1A1A1A]').declarations['background-color'],'var(--omar-admin-card)');
 assert.equal(dashboardPaint('text-gray-500').declarations.color,'var(--omar-admin-dashboard-secondary)');
 assert.equal(dashboardPaint('text-gray-600').declarations.color,'var(--omar-admin-dashboard-muted)');
 assert.ok(css.includes('p[class~="text-gray-400"][class~="opacity-60"] { color: #FFFFFF; }'));
 assert.equal(dashboardPaint('text-red-500').declarations.color,'#EF3434');
});
if(process.env.OMAR_DASHBOARD_REFINEMENT_EVIDENCE){
 const dir=fs.realpathSync(process.env.OMAR_DASHBOARD_REFINEMENT_EVIDENCE);assert.ok(dir.startsWith(workspace+'/.local/hassan/'));
 const{compareDashboardSnapshots}=await import('./admin-dashboard-fidelity.mjs');
 for(const name of ['real','filter','fixture','tooltip','light'])test('refined '+name+' keeps metrics, complete chart paths and non-RGB design',()=>{
  const before=JSON.parse(fs.readFileSync(path.join(dir,name+'-before.json'))),after=JSON.parse(fs.readFileSync(path.join(dir,name+'-after.json')));
  assert.deepEqual(compareDashboardSnapshots(before,after,{light:name==='light'}).staticDifferences,[]);assert.deepEqual(before.texts,after.texts);
  if(name==='filter'){
   // Opening the existing drawer produced at most 0.001 SVG coordinate rounding;
   // require identical command structure and every other SVG attribute exactly.
   before.nodes.forEach((n,i)=>{const a=after.nodes[i];if(!n.svg)return;assert.deepEqual({...n.svg,d:null},{...a.svg,d:null});if(n.svg.d!==a.svg.d){const nums=s=>s.match(/-?\d+(?:\.\d+)?/g).map(Number);assert.equal(n.svg.d.replace(/-?\d+(?:\.\d+)?/g,'#'),a.svg.d.replace(/-?\d+(?:\.\d+)?/g,'#'));const b=nums(n.svg.d),v=nums(a.svg.d);b.forEach((x,j)=>assert.ok(Math.abs(x-v[j])<=0.001001));}});
  }else assert.deepEqual(before.nodes.map(n=>n.svg),after.nodes.map(n=>n.svg));
  if(name==='tooltip'){
   const i=before.nodes.findIndex(n=>n.cls.includes('scale-in-sm'));assert.ok(i>0);
   for(let j=i;j<i+23;j++)for(const prop of ['color','background-color','border-color','box-shadow','background-image'])assert.equal(Object.fromEntries(before.nodes[j].style)[prop],Object.fromEntries(after.nodes[j].style)[prop]);
  }
 });
 test('real composited label, icon, filter and plot samples improve contrast without alpha changes',()=>{
  const rows=JSON.parse(fs.readFileSync(path.join(dir,'contrast.json')));for(const name of [...Array.from({length:4},(_,i)=>'stat-label-'+i),...Array.from({length:4},(_,i)=>'stat-icon-'+i),'filter-label-0','filter-label-1','filter-subtitle','profit-line','chart-axis']){const b=rows.find(r=>r.name===name&&r.phase==='before'),a=rows.find(r=>r.name===name&&r.phase==='after');assert.ok(a.contrast>b.contrast,name);assert.ok(a.contrast>=4.5,name);assert.equal(a.opacity,b.opacity,name);}
 });
}

test('vivid restoration changes only four reviewed alpha declarations and keeps chart transparency',()=>{
 const css=read('local/omar/admin-dashboard-theme.css');const root=require('postcss').parse(css);const rules=[];root.walkDecls('opacity',d=>rules.push([d.parent.selector,d.value]));assert.equal(rules.length,4);assert.deepEqual(rules.map(r=>r[1]),['0.85','0.8','0.9','0.85']);assert.ok(rules[0][0].includes('[data-omar-admin-dashboard-region="revenue"] p'));assert.ok(rules[1][0].includes('span[class~="opacity-30"][class~="text-white"]'));assert.ok(rules[2][0].includes('.group:hover'));assert.ok(rules[3][0].includes('div[class~="opacity-30"][class~="bg-red-500"]'));assert.ok(rules[3][0].includes('[class~="bg-emerald-500"]'));
 assert.ok(!css.includes('stroke-opacity:'));assert.ok(!css.includes('fill-opacity:'));assert.ok(!css.includes('stop-opacity:'));
 assert.equal(dashboardPaint('text-white').declarations.color,'#FFFFFF');for(const c of ['bg-red-500','text-red-500','from-red-500'])assert.ok(JSON.stringify(dashboardPaint(c)).includes('#EF3434'));for(const c of ['bg-emerald-500','text-emerald-500'])assert.ok(JSON.stringify(dashboardPaint(c)).includes('#16C784'));
 assert.ok(css.includes('circle[stroke="#10b981"] { stroke: #16C784;'));assert.ok(css.includes('stop[stop-color="#ef4444"] { stop-color: #EF3434;'));
});
