import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dashboardThemeSource} from './admin-dashboard-theme.mjs';
import {namespaceSource} from './frontend-config.mjs';
const series=fileURLToPath(new URL('./revenue-series.mjs',import.meta.url));
export const revenueV2Stylesheet=fileURLToPath(new URL('./admin-revenue-v2.css',import.meta.url));
export const revenueV2Hooks=[
 ['const revenue = payload[0].value;',`const series = isDarkMode ? resolveRevenueSeries(payload) : null;
            if (isDarkMode && !series) return null;
            const revenue = series ? series.revenue : payload[0].value;`],
 ['const netProfit = payload[1].value;','const netProfit = series ? series.netProfit : payload[1].value;'],
 ['const isForecast = payload[0].payload.isForecast;','const isForecast = series ? series.isForecast : payload[0].payload.isForecast;'],
 ['<div data-omar-admin-dashboard-region="revenue"','<div data-omar-revenue-v2={isDarkMode ? "dark" : "light"} data-omar-admin-dashboard-region="revenue"'],
 ['<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 relative z-10"','<div data-omar-revenue-header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 relative z-10"'],
 ['<div className={`flex p-1 rounded-xl border','<div data-omar-revenue-controls className={`flex p-1 rounded-xl border'],
 ['onClick={() => setRange(opt.val)}','aria-pressed={range === opt.val} onClick={() => setRange(opt.val)}'],
 ['<div className="h-[220px] sm:h-[260px] lg:h-[280px]','<div data-omar-revenue-plot className="h-[220px] sm:h-[260px] lg:h-[280px]'],
 ['<div className={`p-4 rounded-xl border backdrop-blur-xl','<div data-omar-revenue-tooltip={isDarkMode ? "dark" : "light"} className={`p-4 rounded-xl border backdrop-blur-xl'],
 ['strokeWidth: 60,','strokeWidth: isDarkMode ? 1 : 60,'],
 ['<CartesianGrid strokeDasharray="3 3"','<CartesianGrid syncWithTicks={isDarkMode ? true : undefined} strokeDasharray="3 3"'],
];
export const revenueLegend=`{isDarkMode && <div data-omar-revenue-legend aria-label="دليل سلاسل الرسم"><span><i data-series="revenue" aria-hidden="true"/>الإيرادات</span><span><i data-series="net_profit" aria-hidden="true"/>صافي الربح</span></div>}`;
export function revenueV2Source(source,file,workspace){
 if(file!=='admin/components/RevenueChart.tsx')return null;
 const raw=fs.readFileSync(path.join(workspace,file),'utf8');
 if(source!==dashboardThemeSource(namespaceSource(raw),file))throw Error('Omar revenue V2 source drift');
 let code=source;
 for(const[before,after]of revenueV2Hooks){if(code.split(before).length!==2)throw Error('Omar revenue V2 hook drift: '+before);code=code.replace(before,after);}
 const chartMarker='{/* Chart */}';if(code.split(chartMarker).length!==2)throw Error('Omar chart marker drift');code=code.replace(chartMarker,revenueLegend+'\n            '+chartMarker);
 return 'import {resolveRevenueSeries} from '+JSON.stringify(series)+';\n'+code;
}
export function omarRevenueV2({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return{name:'omar-admin-revenue-v2',enforce:'pre',transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(file==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(revenueV2Stylesheet)+';\n',map:null};const code=revenueV2Source(source,file,workspace);return code===null?null:{code,map:null};}};
}
