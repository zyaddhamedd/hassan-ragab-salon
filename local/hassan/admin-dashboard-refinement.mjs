// Owner-authorized Dashboard surface/KPI redesign, isolated from canonical UI.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dashboardThemeSource} from './admin-dashboard-theme.mjs';
import {namespaceSource} from './frontend-config.mjs';
export const refinementStylesheet=fileURLToPath(new URL('./admin-dashboard-refinement.css',import.meta.url));
export const refinementHooks=[
 ['scale(1.07) translateY(-6px)','scale(${isDarkMode ? 1.01 : 1.07}) translateY(${isDarkMode ? "-2px" : "-6px"})'],
 ['ref={cardRef}','data-omar-kpi={isDarkMode ? "dark" : "light"} data-omar-kpi-color={color} ref={cardRef}'],
 ['<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8','<div data-omar-kpi-grid className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8'],
 ['<div className="flex justify-between items-start mb-6 relative z-10 translate-z-[10px]">','<div data-omar-kpi-heading className="flex justify-between items-start mb-6 relative z-10 translate-z-[10px]">'],
 ['<div className="flex items-baseline gap-1 mb-3 relative z-10 translate-z-[15px]">','<div data-omar-kpi-value className="flex items-baseline gap-1 mb-3 relative z-10 translate-z-[15px]">'],
 ['<div className={`relative p-2 rounded-xl transition-all duration-500','<div data-omar-kpi-icon className={`relative p-2 rounded-xl transition-all duration-500'],
];
export function dashboardRefinementSource(source,file,workspace){
 if(file!=='admin/components/Dashboard.tsx')return null;
 const raw=fs.readFileSync(path.join(workspace,file),'utf8');
 if(source!==dashboardThemeSource(namespaceSource(raw),file))throw Error('Omar Dashboard refinement source drift');
 let code=source;
 for(const[before,after]of refinementHooks){if(code.split(before).length!==2)throw Error('Omar Dashboard refinement hook drift');code=code.replace(before,after);}
 return code;
}
export function omarDashboardRefinement({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return{name:'omar-admin-dashboard-refinement',enforce:'pre',transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(file==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(refinementStylesheet)+';\n',map:null};const code=dashboardRefinementSource(source,file,workspace);return code===null?null:{code,map:null};}};
}
