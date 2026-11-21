import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {dashboardThemeSource} from './admin-dashboard-theme.mjs';
import {namespaceSource} from './frontend-config.mjs';
import {refinementHooks,refinementStylesheet,dashboardRefinementSource,omarDashboardRefinement} from './admin-dashboard-refinement.mjs';
const workspace=process.cwd(),file='admin/components/Dashboard.tsx',raw=fs.readFileSync(file,'utf8');
test('Only presentation attributes added; all four metrics, formatting, animation, comparison and handlers restore byte-for-byte',()=>{
 const before=dashboardThemeSource(namespaceSource(raw),file),after=dashboardRefinementSource(before,file,workspace);
 let restored=after;for(const[b,a]of refinementHooks)restored=restored.replace(a,b);assert.equal(restored,before);
 const cards=[...after.matchAll(/<StatCard[\s\S]*?\/>/g)].map(m=>m[0]);assert.equal(cards.length,4);
 for(const[name,key]of [['إجمالي الإيرادات','total_revenue'],['صافي الأرباح','net_profit'],['عدد الفواتير','invoice_count'],['عدد الخدمات','services_count']])assert.ok(cards.some(c=>c.includes(name)&&c.includes('executive?.'+key)));
 assert.ok(after.includes('growth={executive?.growth_rate_percent}'));assert.ok(after.includes('netMargin.toFixed(1)'));
 assert.throws(()=>dashboardRefinementSource(before+'\n',file,workspace),/drift/);
});
test('Admin/Omar/Dark/screen isolation; only authorized background, KPI and revenue panel surfaces',()=>{
 assert.equal(omarDashboardRefinement({workspace,app:'mini',mode:'omar'}),null);assert.equal(omarDashboardRefinement({workspace,app:'admin',mode:'production'}),null);
 for(const f of ['admin/components/RevenueChart.tsx','admin/components/BranchPerformance.tsx','admin/components/PromoCodesPage.tsx'])assert.equal(dashboardRefinementSource('unchanged',f,workspace),null);
 const css=fs.readFileSync(refinementStylesheet,'utf8');assert.ok(css.includes('@media screen'));assert.ok(css.includes('(max-width:639px)'));assert.ok(css.includes('container-type:inline-size'));
 for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){assert.ok(rule[1].includes('html[data-omar-admin-theme="foundation"] [data-omar-admin-dashboard="dark"]'));assert.ok(!/stroke:|fill:|stop-color:/.test(rule[2]));}
 assert.ok(css.includes('[data-omar-admin-dashboard-decoration] { display:none; }'));
 assert.ok(!css.includes('[data-omar-admin-dashboard="light"]'));assert.ok(!css.includes('recharts'));
});
test('Existing exact chart semantic mapping, numerical series, domains and tooltip source remain untouched',()=>{
 const css=fs.readFileSync('local/omar/admin-dashboard-theme.css','utf8');
 assert.match(css,/\[stroke="#ef4444"\] \{ stroke: #EF3434;/);
 assert.match(css,/\[stroke="#10b981"\] \{ stroke: #16C784;/);
 const chart=fs.readFileSync('admin/components/RevenueChart.tsx','utf8');assert.ok(chart.includes('dataKey="revenue"'));assert.ok(chart.includes('dataKey="net_profit"'));assert.ok(chart.includes('content={<CustomTooltip />}'));
});
test('Approved coupon artifact and original chart bytes protected',()=>{
assert.equal(createHash('sha256').update(fs.readFileSync('local/omar/coupon-artifact.tsx')).digest('hex'),'1a7c170ba51336a2c5267d4705566110dfc6a9eb394ec54d7c7716394565846c');
assert.equal(createHash('sha256').update(fs.readFileSync('local/omar/coupon-artifact.css')).digest('hex'),'9544c0954efb258dcc78f9f9f0d5db321aee2417ea7f0374a78cd07f64bf79c8');
assert.equal(createHash('sha256').update(fs.readFileSync('admin/components/RevenueChart.tsx')).digest('hex'),'95b7207558d4247a3a4a672afa92d4636cbc0aaee1914789ad1f0dc5b6cb31fd');
});
test('Signature polish keeps category accents and restrains Dark hover without affecting Light animation',()=>{
 const css=fs.readFileSync(refinementStylesheet,'utf8');
 for(const color of ['#EF3434','#16C784','#3291FF','#F5A623'])assert.ok(css.includes('--omar-kpi-accent:'+color));
 assert.ok(css.includes('width:26px; height:2px;'));
 assert.ok(css.includes('width:38px; height:38px;'));
 assert.ok(css.includes('--tw-scale-x:1; --tw-scale-y:1;'));
 const output=dashboardRefinementSource(dashboardThemeSource(namespaceSource(raw),file),file,workspace);
 assert.ok(output.includes('scale(${isDarkMode ? 1.01 : 1.07})'));
 assert.ok(output.includes('translateY(${isDarkMode ? "-2px" : "-6px"})'));
 const revenueCSS=fs.readFileSync('local/omar/admin-revenue-v2.css','utf8');
 assert.ok(revenueCSS.includes('0 1px 0 rgb(255 255 255 / .025) inset,0 6px 18px rgb(0 0 0 / .14)'));
 assert.ok(css.includes('0 1px 0 rgb(255 255 255 / .025) inset,0 6px 18px rgb(0 0 0 / .14)'));
});
