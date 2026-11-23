// Omar Admin active workforce/payroll surfaces; presentation attributes and paint only.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{recordsPaint}from'./admin-records-theme.mjs';import{inventoryClasses}from'./mini-inventory-theme.mjs';import{namespaceSource}from'./frontend-config.mjs';import{brandSource}from'./branding.mjs';
export const workforceStylesheet=fileURLToPath(new URL('./admin-workforce-theme.css',import.meta.url));
export const workforceFiles=['EmployeesPage','EmployeeCard','EmployeeTable','AddEmployeePage','EmployeeDetailsPage','AdminAttendanceDashboard','TransferModal'].map(n=>'admin/components/'+n+'.tsx').concat(['SettlementStudio','SettlementControls','SettlementSourceInspector','SettlementOverrideModal'].map(n=>'admin/components/settlement/'+n+'.tsx'));
const mark='data-omar-admin-workforce={isDarkMode ? "dark" : "light"}';
export const workforceHooks={
 'admin/components/EmployeesPage.tsx':[['<div className="admin-page-shell','<div '+mark+' className="admin-page-shell',1],['<div className="admin-overlay-shell z-[200] bg-black/60','<div '+mark+' className="admin-overlay-shell z-[200] bg-black/60',1],['onClick={handleDeleteEmployee}','data-omar-admin-workforce-semantic="delete" onClick={handleDeleteEmployee}',1]],
 'admin/components/AddEmployeePage.tsx':[['<div className="admin-page-shell','<div '+mark+' className="admin-page-shell',1]],
 'admin/components/EmployeeDetailsPage.tsx':[['<div className={`relative w-full h-full flex flex-col animate-fade-in theme-transition','<div '+mark+' className={`relative w-full h-full flex flex-col animate-fade-in theme-transition',1],['<div className="admin-overlay-shell admin-overlay-shell--scroll z-[200] bg-black/95"','<div data-omar-admin-workforce-document className="admin-overlay-shell admin-overlay-shell--scroll z-[200] bg-black/95"',1]],
 'admin/components/AdminAttendanceDashboard.tsx':[['<div className={`admin-page-shell','<div '+mark+' className={`admin-page-shell',1]],
 'admin/components/TransferModal.tsx':[['<div className="admin-overlay-shell','<div '+mark+' className="admin-overlay-shell',2]],
 'admin/components/settlement/SettlementStudio.tsx':[['<div\n      className={`fixed inset-0 z-[150]','<div '+mark+'\n      className={`fixed inset-0 z-[150]',1],['<div className="w-full max-w-2xl my-auto">','<div data-omar-admin-workforce-document className="w-full max-w-2xl my-auto">',1]],
 'admin/components/settlement/SettlementSourceInspector.tsx':[['<div className="fixed inset-0 z-[150] flex items-center justify-end','<div '+mark+' className="fixed inset-0 z-[150] flex items-center justify-end',1],['<Wallet size={14} className="text-[#8B0000]"','<Wallet data-omar-admin-workforce-semantic="negative" size={14} className="text-[#8B0000]"',1],['<TrendingDown size={14} className="text-[#8B0000]"','<TrendingDown data-omar-admin-workforce-semantic="negative" size={14} className="text-[#8B0000]"',1]],
 'admin/components/settlement/SettlementOverrideModal.tsx':[['<div className="fixed inset-0 z-[180]','<div '+mark+' className="fixed inset-0 z-[180]',1]],
};
export const workforceDigest=s=>createHash('sha256').update(s).digest('hex');
export const reviewedWorkforce=/* REVIEWED */ {
  "admin/components/EmployeesPage.tsx": "3cb03be2f734a1be252fb2746fe8f0c4a127eee718ef951a6ef9e9044d7bc01d",
  "admin/components/EmployeeCard.tsx": "7fe61bb43cbb6b08715d781efb0e99d53cd98b72db147c039a00b9d70f597514",
  "admin/components/EmployeeTable.tsx": "85c90130ee14f61dc55c83718fd8321e6b823a9739562d6c5bc873e4db6a3c2e",
  "admin/components/AddEmployeePage.tsx": "3914c0ddbb1c10b7a1cc4524e926d49cc4e254405ad30837f4e5a51a51e44859",
  "admin/components/EmployeeDetailsPage.tsx": "812a333e979eb66756ce2516ce8ad6bc15a9e9d481648c8967d5d4aef8989cb8",
  "admin/components/AdminAttendanceDashboard.tsx": "69d7426422306d33bfdd840ddc74d0fec788b9ff2a7b029a91a1755c6ad5442e",
  "admin/components/TransferModal.tsx": "efbaab16b80ea55cd266023c1f1020fd89d64bdff46bd086920e25e568da7df2",
  "admin/components/settlement/SettlementStudio.tsx": "250089a9e3ee6679f9a4f5135164646f5fae73942c2ac20110544f83bfa859c5",
  "admin/components/settlement/SettlementControls.tsx": "7acbc85f234fb345e692015e946362eed8b6a634c68e58adc2786fa5f32c1f71",
  "admin/components/settlement/SettlementSourceInspector.tsx": "53ce653626f6f131c552507bda23bff72164fb7d008b7e481c29fb3a4155f397",
  "admin/components/settlement/SettlementOverrideModal.tsx": "2cd5af88721e3775f528f813b9c536ef597eaf25872dfee92c91c9e8f680a580"
};
const workspace=path.resolve(import.meta.dirname,'../..');
export function workforceThemeSource(source,file){const hooks=workforceHooks[file];if(!hooks)return null;const raw=fs.readFileSync(path.join(workspace,file),'utf8');if(workforceDigest(raw)!==reviewedWorkforce[file]||![raw,namespaceSource(raw),brandSource(namespaceSource(raw),file)].includes(source))throw Error('Omar workforce source drift: '+file);let code=source;for(const[b,a,n]of hooks){if(code.includes(a)||code.split(b).length!==n+1)throw Error('Omar workforce hook drift: '+file);code=code.replaceAll(b,a);}return code;}
// Additional active workforce colors. Shared records palette handles the rest.
// Keep distinct original gradient stops; do not collapse source gradient forms.
export const workforceHex={
 '#08080a':'#0B0B0D','#0b0b0e':'#0B0B0D','#0b0c0e':'#0B0B0D','#0e0e10':'#151518','#0e0f12':'#151518','#111114':'#151518','#121215':'#121215','#121216':'#121215','#121418':'#121215','#141417':'#1A1A1F','#141518':'#1A1A1F','#14161b':'#1A1A1F','#18181a':'#1A1A1F','#18181b':'#1A1A1F','#18181c':'#1A1A1F','#18191c':'#1A1A1F','#1a1c20':'#24242C',
 '#c5a880':'#A8906A','#8b0000':'#A8906A','#a00000':'#BFA882','#d32f2f':'#927A56','#b33939':'#A8906A','#400000':'#927A56','#3a0000':'#BA996B','#550000':'#927A56','#650000':'#A8906A',
 '#0d0e11':'#151518','#090a0c':'#0B0B0D','#18191e':'#1A1A1F','#1c1c20':'#1A1A1F','#1c1d24':'#1A1A1F','#101013':'#121215','#0e0f14':'#0B0B0D','#14151b':'#151518','#262832':'#24242C','#171822':'#1A1A1F',
 '#e4e4e7':'#FFFFFF','#f8fafc':'#FFFFFF',
};
export function workforcePaint(cls){const hex=cls.match(/#[0-9a-fA-F]{6}\b/)?.[0],color=hex&&workforceHex[hex.toLowerCase()];if(!color)return recordsPaint(cls);const p=recordsPaint(cls.replace(hex,'#E6D690'));return p?{...p,declarations:Object.fromEntries(Object.entries(p.declarations).map(([k,v])=>[k,v.replaceAll('#A8906A',color)]))}:null;}
export function buildWorkforceCSS(root){const scope='html[data-omar-admin-theme="foundation"] [data-omar-admin-workforce="dark"]';const guard=':not(:where([data-omar-admin-workforce-document],[data-omar-admin-workforce-document] *,[data-omar-admin-document-protected],[data-omar-admin-document-protected] *,.print-template,.print-template *,.print-only,.print-only *,.omar-wordmark,.omar-wordmark *,.omar-logo-slot,.omar-logo-slot *)):not(:has([data-omar-admin-workforce-document],[data-omar-admin-document-protected]))';const lines=['/* Omar Admin workforce Dark colors only. All original alpha, shapes and behavior retained. */','@media screen {'];const classes=new Set();for(const f of workforceFiles){const source=fs.readFileSync(path.join(root,f),'utf8');if(workforceDigest(source)!==reviewedWorkforce[f])throw Error('Omar workforce paint drift: '+f);inventoryClasses(source).forEach(c=>classes.add(c));}
 const order={'':0,'focus-within':1,hover:2,focus:3,'focus-visible':4,disabled:5,active:6,'disabled:hover':7,'group-focus-within':8,'group-hover':9};
 for(const[cls,{variant,declarations}]of[...classes].map(c=>[c,workforcePaint(c)]).filter(([,p])=>p).sort((a,b)=>order[a[1].variant]-order[b[1].variant]||a[0].localeCompare(b[0],'en'))){const attr='[class~="'+cls+'"]',suffix=(variant&&!variant.startsWith('group-')?':'+variant:'')+(cls.startsWith('placeholder')?'::placeholder':'');const selectors=variant.startsWith('group-')?[scope+' .group:'+variant.slice(6)+' '+attr+guard]:[scope+attr+guard+suffix,scope+' '+attr+guard+suffix];lines.push('  '+selectors.join(',\n  ')+' { '+Object.entries(declarations).map(([p,v])=>p+': '+v+';').join(' ')+' }');}
 // Only opaque brand controls need dark foreground; status tints retain white/semantic text.
 for(const c of ['bg-[#E53935]','bg-[#E6D690]','bg-[#8B0000]','bg-[#A8906A]','from-[#8B0000]'])lines.push('  '+scope+' [class~="'+c+'"][class~="text-white"]'+guard+' { color: #0B0B0D; }');
 lines.push('  '+scope+' [class~="from-[#8B0000]"][class~="text-amber-200"]'+guard+' { color: #0B0B0D; }');
 lines.push('  '+scope+' [data-omar-admin-workforce-semantic="negative"]'+guard+' { color: #EF3434; }');
 lines.push('  '+scope+' [data-omar-admin-workforce-semantic="delete"]'+guard+' { background-color: #EF3434; color: #FFFFFF; }');
 lines.push('  '+scope+' [data-omar-admin-workforce-semantic="delete"]'+guard+':hover { background-color: #DC2424; }');
 lines.push('}');return lines.join('\n')+'\n';}
export function omarWorkforceTheme({workspace,app,mode}){if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;return{name:'omar-admin-workforce-theme',enforce:'pre',buildStart(){if(fs.readFileSync(workforceStylesheet,'utf8')!==buildWorkforceCSS(workspace))throw Error('Omar workforce stylesheet drift');},transform(source,id){const f=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(f==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(workforceStylesheet)+';\n',map:null};const code=workforceThemeSource(source,f);return code===null?null:{code,map:null};}};}
