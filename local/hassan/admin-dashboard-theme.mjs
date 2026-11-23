// Omar Dashboard presentation only. No chart data, finance logic or API rewrites.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{inventoryClasses}from'./mini-inventory-theme.mjs';import{operationalPaint}from'./mini-operational-theme.mjs';
export const dashboardStylesheet=fileURLToPath(new URL('./admin-dashboard-theme.css',import.meta.url));
export const dashboardFiles=['Dashboard','RevenueChart','BranchPerformance'].map(n=>'admin/components/'+n+'.tsx');
export const dashboardPaintDigest=s=>createHash('sha256').update(JSON.stringify({classes:inventoryClasses(s),hex:[...new Set(s.match(/#[0-9a-fA-F]{3,8}\b/g)||[])].sort()})).digest('hex');
export const reviewedDashboardPaint={
  "admin/components/Dashboard.tsx": "623ce051f9cb7e927b5284f45753db67f4bb199273e7da273f1c14f48b758075",
  "admin/components/RevenueChart.tsx": "c5d18211f883e049ddffafaeb6dbdc36be1ecfc05f190a549fafefd2f2bdf9d3",
  "admin/components/BranchPerformance.tsx": "181481d19b78f924d28e8a50419f844fe13120ef72eb8e118b06ab38b4c1d50d"
};
export const dashboardHooks={
 'admin/components/Dashboard.tsx':[
 ['<main className={`admin-page-shell','<main data-omar-admin-dashboard={isDarkMode ? "dark" : "light"} className={`admin-page-shell'],
 ['<div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">','<div data-omar-admin-dashboard={isDarkMode ? "dark" : "light"} className="flex flex-col items-center justify-center min-h-[60vh] gap-4">'],
 ['<div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4 text-center">','<div data-omar-admin-dashboard={isDarkMode ? "dark" : "light"} className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4 text-center">'],
 ['<div className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">','<div data-omar-admin-dashboard-decoration className="fixed inset-0 pointer-events-none z-[-1] overflow-hidden">'],
 ],
 'admin/components/RevenueChart.tsx':[['<div className={`relative p-8 rounded-[32px]','<div data-omar-admin-dashboard-region="revenue" className={`relative p-8 rounded-[32px]']],
 'admin/components/BranchPerformance.tsx':[
 ['<div className={`p-8 rounded-3xl border w-full h-full min-h-[420px]','<div data-omar-admin-dashboard-region="branches" className={`p-8 rounded-3xl border w-full h-full min-h-[420px]',2],
 ],
};
export function dashboardThemeSource(source,file){
 const hooks=dashboardHooks[file];if(!hooks)return null;if(dashboardPaintDigest(source)!==reviewedDashboardPaint[file])throw Error('Omar Dashboard paint drift: '+file);
 let code=source;for(const[before,after,count=1]of hooks){if(code.split(before).length!==count+1||code.includes(after))throw Error('Omar Dashboard hook drift: '+file);code=code.replaceAll(before,after);}return code;
}
const token=n=>'var(--omar-admin-'+(n==='accent'?'dashboard-accent':n)+')';
const red='#EF3434';
// Dashboard-local brand/surface tokens; functional semantics stay vivid.
export const dashboardHierarchy={card:'#1A1A1F',chart:'#121215',secondary:'#F6F6F7',muted:'#7E7E8B',profit:'#16C784',accent:'#A8906A'};
const hierarchy=n=>'var(--omar-admin-dashboard-'+n+')';
export function dashboardColor(base,kind){
 const lower=base.toLowerCase();
 const neutrals={'#080808':'page','#0a0a0a':'surface','#0c0c0c':'surface','#0d0d0d':'input','#0f0f0f':'surface','#121212':'input','#151515':'card','#1a1a1a':'card'};
 const brand={'#e53935':'accent','#ff5252':'hover','#d32f2f':'pressed','#c62828':'#B69566'};
 if(lower==='#151515')return hierarchy('card');if(lower==='#0c0c0c')return hierarchy('chart');
 if(neutrals[lower])return token(neutrals[lower]);if(brand[lower])return brand[lower].startsWith('#')?brand[lower]:token(brand[lower]);
 if(base==='white')return kind==='border'?token('border'):'#FFFFFF';
 if(/^gray-\d+$/.test(base))return kind==='text'?hierarchy(Number(base.split('-')[1])<=500?'secondary':'muted'):token('selected');
 const palettes={emerald:{300:'#54E7B2',400:'#2DDB9B',500:'#16C784'},green:{300:'#54E7B2',400:'#2DDB9B',500:'#16C784'},red:{200:'#FF9999',300:'#FF7171',400:'#FF5050',500:'#EF3434',600:'#DC2424'},yellow:{300:'#FFC457',400:'#FFB938',500:'#F5A623',600:'#D98B12'},amber:{100:'#FFDB92',600:'#D98B12'},blue:{100:'#9BCBFF',500:'#3291FF'},cyan:{100:'#9BCBFF',600:'#167AE5'}};
 const m=base.match(/^(emerald|green|red|yellow|amber|blue|cyan)-(\d+)$/);if(m){if(m[1]==='red'&&m[2]==='500'&&['bg','from','via','to'].includes(kind))return red;return palettes[m[1]][m[2]]||null;}
 return null;
}
function recolorEffect(effect){return effect.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g,(all,r,g,b,a)=>{const rgb={'229,57,53':'168,144,106','239,68,68':'239,52,52','16,185,129':'22,199,132','255,255,255':'255,255,255'}[[r,g,b].join(',')];return rgb?'rgba('+rgb+','+a+')':all;});}
export function dashboardPaint(cls){
 const effect=operationalPaint(cls);if(effect?.originalEffect){const value=recolorEffect(effect.originalEffect);if(value===effect.originalEffect)return null;const p=Object.keys(effect.declarations)[0];return{variant:effect.variant,declarations:{[p]:value},originalEffect:effect.originalEffect};}
 const m=cls.match(/^(?:(group-hover|hover|focus|group-focus-within|focus-within):)?(bg|text|border-t|border|from|via|to|shadow|ring)-(.+)$/);if(!m)return null;const[,variant='',kind,value]=m;
 const match=value.match(/^(\[[^\]]+\]|[^/]+)(?:\/(\d+|\[[\d.]+\]))?$/);if(!match)return null;let[,base,alpha]=match;base=base.replace(/^\[|\]$/g,'');let color=dashboardColor(base,kind);if(!color)return null;
 if(alpha!==undefined)color=`color-mix(in srgb, ${color} ${alpha.startsWith('[')?Number(alpha.slice(1,-1))*100:Number(alpha)}%, transparent)`;
 const position=n=>' var(--tw-gradient-'+n+'-position)';
 if(kind==='from')return{variant,declarations:{'--tw-gradient-from':color+position('from'),'--tw-gradient-to':`color-mix(in srgb, ${dashboardColor(base,kind)} 0%, transparent)`+position('to')}};
 if(kind==='via')return{variant,declarations:{'--tw-gradient-stops':'var(--tw-gradient-from), '+color+position('via')+', var(--tw-gradient-to)'}};
 if(kind==='to')return{variant,declarations:{'--tw-gradient-to':color+position('to')}};
 return{variant,declarations:{[{bg:'background-color',text:'color',border:'border-color','border-t':'border-top-color',shadow:'--tw-shadow-color',ring:'--tw-ring-color'}[kind]]:color}};
}
export function buildDashboardCSS(workspace){
 const lines=['/* Omar Dashboard Dark paint only. Four reviewed opacity exceptions; original effect forms retained. */','@media screen {'];const scope='html[data-omar-admin-theme="foundation"] [data-omar-admin-dashboard="dark"]';
 lines.push('  '+scope+' { '+Object.entries(dashboardHierarchy).map(([n,c])=>'--omar-admin-dashboard-'+n+': '+c+';').join(' ')+' }');
 const classes=new Set();for(const f of dashboardFiles){const s=fs.readFileSync(path.join(workspace,f),'utf8');if(dashboardPaintDigest(s)!==reviewedDashboardPaint[f])throw Error('Omar Dashboard paint inventory drift: '+f);inventoryClasses(s).forEach(c=>classes.add(c));}
 const order={'':0,'focus-within':1,hover:2,focus:3,'group-focus-within':4,'group-hover':5};
 for(const[cls,{variant,declarations}]of[...classes].map(c=>[c,dashboardPaint(c)]).filter(([,p])=>p).sort((a,b)=>order[a[1].variant]-order[b[1].variant]||a[0].localeCompare(b[0],'en'))){
  const attr='[class~="'+cls+'"]',suffix=variant&&!variant.startsWith('group-')?':'+variant:'';
  const selectors=variant.startsWith('group-')?[scope+' .group:'+variant.slice(6)+' '+attr]:[scope+attr+suffix,scope+' '+attr+suffix];
  lines.push('  '+selectors.join(',\n  ')+' { '+Object.entries(declarations).map(([p,v])=>p+': '+v+';').join(' ')+' }');
 }
 // Attribute paints target only the reviewed existing SVG colors, never chart data/geometry.
 const revenue=scope+' [data-omar-admin-dashboard-region="revenue"]';
 for(const[source,target]of [['#ef4444','#EF3434'],['#10b981',hierarchy('profit')],['#ffffff03','#2B2B3303'],['#ffffff08','#B3B3BD08']]){
  lines.push('  '+revenue+' [stroke="'+source+'"] { stroke: '+target+'; }');lines.push('  '+revenue+' [fill="'+source+'"] { fill: '+target+'; }');lines.push('  '+revenue+' stop[stop-color="'+source+'"] { stop-color: '+target+'; }');
 }
 lines.push('  '+revenue+' text[fill="#525252"] { fill: '+hierarchy('secondary')+'; }');
 // Tooltip marker utilities use the same semantic RGBs as their chart series. Logic untouched.
 lines.push('  '+scope+' p[class~="text-gray-400"][class~="opacity-60"] { color: #FFFFFF; }');
 const branches=scope+' [data-omar-admin-dashboard-region="branches"]';for(const[source,target]of [['#333','var(--omar-admin-border)'],['#ef4444','#EF3434'],['#10b981','#16C784'],['#fbbf24','#F5A623']])lines.push('  '+branches+' circle[stroke="'+source+'"] { stroke: '+target+'; }');
 // Proven fading: readable text at 30/40% and static semantic baseline at 30%.
 // Decorative gradients, chart fill stops, hover glows and animation alpha stay original.
 lines.push('  '+revenue+' p[class~="opacity-40"][class~="text-gray-400"] { opacity: 0.85; }');
 lines.push('  '+scope+' span[class~="opacity-30"][class~="text-white"] { opacity: 0.8; }');
 lines.push('  '+scope+' .group:hover span[class~="opacity-30"][class~="text-white"] { opacity: 0.9; }');
 lines.push('  '+scope+' div[class~="opacity-30"][class~="bg-red-500"], '+scope+' div[class~="opacity-30"][class~="bg-emerald-500"] { opacity: 0.85; }');
 lines.push('}');return lines.join('\n')+'\n';
}
export function omarDashboardTheme({workspace,app,mode}){if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;return{name:'omar-admin-dashboard-theme',enforce:'pre',buildStart(){if(fs.readFileSync(dashboardStylesheet,'utf8')!==buildDashboardCSS(workspace))throw Error('Omar Dashboard stylesheet drift');},transform(source,id){const f=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(f==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(dashboardStylesheet)+';\n',map:null};const code=dashboardThemeSource(source,f);return code===null?null:{code,map:null};}};}
