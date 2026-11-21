import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {resolveRevenueSeries} from './revenue-series.mjs';
import {dashboardThemeSource} from './admin-dashboard-theme.mjs';
import {namespaceSource} from './frontend-config.mjs';
import {revenueV2Source,revenueV2Hooks,revenueLegend,revenueV2Stylesheet,omarRevenueV2} from './admin-revenue-v2.mjs';
const workspace=process.cwd(),file='admin/components/RevenueChart.tsx',raw=fs.readFileSync(file,'utf8'),before=dashboardThemeSource(namespaceSource(raw),file),after=revenueV2Source(before,file,workspace);
const require=createRequire(path.join(workspace,'admin/package.json')),React=require('react'),ts=require('typescript'),{renderToStaticMarkup}=require('react-dom/server');
test('Series resolved by dataKey across reordered/duplicated payloads; missing values are not invented',()=>{
 const revenue={dataKey:'revenue',value:1000,payload:{isForecast:true}},profit={dataKey:'net_profit',value:-250};
 for(const payload of [[revenue,profit],[profit,revenue],[profit,profit,revenue,revenue]])assert.deepEqual(resolveRevenueSeries(payload),{revenue:1000,netProfit:-250,isForecast:true});
 assert.deepEqual(resolveRevenueSeries([{dataKey:'net_profit',value:0},{dataKey:'revenue',value:0}]),{revenue:0,netProfit:0,isForecast:false});
 for(const payload of [null,[],[revenue],[profit],[{...revenue,value:NaN},profit]])assert.equal(resolveRevenueSeries(payload),null);
});
test('Transformed actual tooltip renders correct series and unchanged margin, forecast and formatting',()=>{
 const start=after.indexOf('const CustomTooltip ='),end=after.indexOf('\n    };',start)+7;
 const source=after.slice(start,end)+'\nexport default CustomTooltip;';
 const output=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal(output.diagnostics.length,0);
 const module={exports:{}};vm.runInNewContext(output.outputText,{module,exports:module.exports,React,isDarkMode:true,resolveRevenueSeries,formatDate:v=>v,Intl});
 const tooltip=module.exports.default;
 const html=renderToStaticMarkup(tooltip({active:true,label:'2026-10-29',payload:[{dataKey:'net_profit',value:25},{dataKey:'net_profit',value:25},{dataKey:'revenue',value:200,payload:{isForecast:true}}]}));
 assert.ok(html.includes(new Intl.NumberFormat('ar-EG').format(200)));assert.ok(html.includes(new Intl.NumberFormat('ar-EG').format(25)));assert.ok(html.includes('12.5%'));assert.ok(html.includes('متوقع'));assert.ok(html.includes('2026-10-29'));
 assert.equal(tooltip({active:true,payload:[{dataKey:'revenue',value:200}]}),null);
});
test('All data fetches, series order, date filters, axes/domains and financial calculations restore byte-identically',()=>{
 let restored=after.replace(/^import \{resolveRevenueSeries\}[^\n]+\n/,'').replace(revenueLegend+'\n            ','');
 for(const[b,a]of revenueV2Hooks)restored=restored.replace(a,b);
 assert.equal(restored,before);
 assert.equal(after.match(/dataKey="revenue"/g).length,2);assert.equal(after.match(/dataKey="net_profit"/g).length,2);
 assert.ok(after.includes('const margin = revenue > 0 ? (netProfit / revenue) * 100 : 0;'));
 assert.ok(after.includes('aria-pressed={range === opt.val} onClick={() => setRange(opt.val)}'));
 assert.throws(()=>revenueV2Source(before+'\n',file,workspace),/drift/);
});
test('Omar Admin Dark panel only; all other Dashboard sections, Light mode and coupon component excluded',()=>{
 assert.equal(omarRevenueV2({workspace,app:'mini',mode:'omar'}),null);assert.equal(omarRevenueV2({workspace,app:'admin',mode:'development'}),null);
 assert.equal(revenueV2Source('untouched','admin/components/Dashboard.tsx',workspace),null);
 const css=fs.readFileSync(revenueV2Stylesheet,'utf8');assert.ok(css.includes('@media screen'));assert.ok(css.includes('(max-width:639px)'));
 for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){assert.ok(rule[1].includes('html[data-omar-admin-theme="foundation"]'));assert.ok(rule[1].includes('[data-omar-revenue-v2="dark"]'));}
 assert.ok(!css.includes('oc-artifact'));assert.ok(!css.includes('[data-omar-revenue-v2="light"]'));
 const originalCSS=fs.readFileSync('local/omar/admin-dashboard-theme.css','utf8');assert.match(originalCSS,/\[stroke="#ef4444"\] \{ stroke: #EF3434;/);assert.match(originalCSS,/\[stroke="#10b981"\] \{ stroke: #16C784;/);
});

test('V2.1 uses existing tick grid, restrained fills and semantic active dots without dimension changes',()=>{
 const css=fs.readFileSync(revenueV2Stylesheet,'utf8');
 assert.ok(after.includes('syncWithTicks={isDarkMode ? true : undefined}'));
 assert.ok(css.includes('.recharts-cartesian-grid-horizontal line { stroke:#91A5B0; stroke-opacity:.14;'));
 assert.ok(css.includes('.recharts-area-area { fill-opacity:.06; }'));
 assert.ok(css.includes('.recharts-area-area[fill="url(#colorRevenue)"] { fill:#EF3434; }'));
 assert.ok(css.includes('.recharts-area-area[fill="url(#colorProfit)"] { fill:#16C784; }'));
 assert.ok(css.includes('.recharts-active-dot circle[fill="#ef4444"] { fill:#EF3434; }'));
 assert.ok(css.includes('.recharts-active-dot circle[fill="#10b981"] { fill:#16C784; }'));
 assert.ok(css.includes('stroke-dasharray:4 4'));
 assert.ok(css.includes('height:300px; margin-left:0;'));assert.ok(css.includes('height:260px;'));
});
