// Omar Mini inventory only. Attribute hooks leave canonical component code intact.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {operationalPaint, paintColor} from './mini-operational-theme.mjs';
export const reviewedInventoryBaseCSS='e22657db41a09247d8b1d7a834dfba7f3e859b57d54613e5303d539d3816ca9c';
export const inventoryStylesheet=fileURLToPath(new URL('./mini-inventory-theme.css',import.meta.url));
export const inventoryFiles=['BranchInventoryScreen','InventoryOnlyApp','BranchInventoryCard','IncomingShipmentCard','ShipmentHistoryList','ShipmentDetailsSheet','ConsumptionSheet','SupplyRequestSheet','RequestDetailsSheet','ReturnRequestSheet','ReturnRequestDetailsSheet','ProductActivityLog'].map(n=>'mini/components/'+n+'.tsx').concat('mini/src/utils/inventoryStatus.ts');
const pattern=/(?<![\w:-])(?:(?:[\w-]+):)*(?:bg|text|border(?:-[lrtbxy])?|from|via|to|shadow|drop-shadow|ring|fill|placeholder:text|placeholder)-(?:\[[^\]\s]+\]|white|black|transparent|current|(?:amber|yellow|emerald|green|red|rose|blue|gray|slate|violet|purple|sky|cyan|orange|zinc|neutral)-\d+)(?:\/(?:\d+|\[[\d.]+\]))?/g;
export const inventoryClasses=s=>[...new Set(s.match(pattern)||[])].sort();
export const inventoryDigest=s=>createHash('sha256').update(JSON.stringify(inventoryClasses(s))).digest('hex');
export const inventoryHooks={
 'mini/components/BranchInventoryScreen.tsx':[['<div className="mini-screen','<div data-omar-mini-inventory="desktop" className="mini-screen',3]],
 'mini/components/InventoryOnlyApp.tsx':[
 ['<div className="inventory-mobile-shell','<div data-omar-mini-inventory="mobile" className="inventory-mobile-shell',2],
 ['<div\n      className="inventory-mobile-shell','<div data-omar-mini-inventory="mobile"\n      className="inventory-mobile-shell',1],
 ['<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.4rem] border border-[#E53935]/15', '<div data-omar-mini-inventory-semantic="error" className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.4rem] border border-[#E53935]/15',1]],
};
export const reviewedInventoryPaint=/* DIGESTS */ {
  "mini/components/BranchInventoryScreen.tsx": "35b20bbb4272ed625b7d755da9fbb7e6c55f99ec571b46189566adb58c41585a",
  "mini/components/InventoryOnlyApp.tsx": "ddfd935e24c83ff5bff58d3a5300990effdf0f25e41eb755029e9c966f0f406e",
  "mini/components/BranchInventoryCard.tsx": "f5832f482b696a4d8dba5af510d1f258224017a2538aa155c0e29bb06a44a04a",
  "mini/components/IncomingShipmentCard.tsx": "7ad6e0a779986f52aa6d9295f739b3e4f899c8d5d4b4386899006a5d439a0e3a",
  "mini/components/ShipmentHistoryList.tsx": "559ae265c93770395c78a1d5ec93dd418cb81c76b568d5483f2152843cccf589",
  "mini/components/ShipmentDetailsSheet.tsx": "2fed8d5db56bd2157cc47736d8109fd077bd2fdb2eb09a0bc12af2d7041d2617",
  "mini/components/ConsumptionSheet.tsx": "76d9d58446ca1fbc580d026aa713a497a1f2a7877c407cfd15381692b9bab89c",
  "mini/components/SupplyRequestSheet.tsx": "a8cd36aff7796135d3ddf7b917c9687913e1620f1d0226e305181fbf8dffb3c4",
  "mini/components/RequestDetailsSheet.tsx": "161cf26f42358ba59977e6c86894387a8c7e4c5a401afaee6015291bc9f8e85e",
  "mini/components/ReturnRequestSheet.tsx": "b16746ac6f8fb625cb057786ce8a5d71371a0e58ebbfad5f2c1f5b821259d637",
  "mini/components/ReturnRequestDetailsSheet.tsx": "65418ff2fcd28bdaff9a0caa20214f8ed5e0573d35180bd59f09bc56e4e8b491",
  "mini/components/ProductActivityLog.tsx": "a8b09549f38057ba91174fd707fa3147460fc552976f494b72da322e76649232",
  "mini/src/utils/inventoryStatus.ts": "854e798a9d4ec88ceb9b95c00ef96fe89913cd459fb3b524a32a81e7c8bfe9bb"
};
export function inventoryThemeSource(source,file){
 if(!inventoryFiles.includes(file))return null;
 if(inventoryDigest(source)!==reviewedInventoryPaint[file])throw Error('Omar inventory paint drift: '+file);
 let code=source;
 for(const [before,after,count] of inventoryHooks[file]||[]){
  if(code.includes(after)||code.split(before).length!==count+1)throw Error('Omar inventory hook drift: '+file);
  code=code.replaceAll(before,after);
 }
 return inventoryHooks[file]?code:null;
}
const token=n=>'var(--omar-mini-'+n+')';
const mix=(color,alpha)=>`color-mix(in srgb, ${color} ${alpha}%, transparent)`;
const dark={'#09090b':'page','#0a0a0b':'page','#0d0d10':'input','#0e0e11':'surface','#111113':'input','#141416':'card','#151518':'surface','#161618':'surface','#161619':'surface','#17171a':'card','#18181b':'selected','#191919':'surface'};
const accents={'#e53935':'inventory-action, var(--omar-mini-accent)','#f43f36':'hover','#cfa353':'pressed','#d9c983':'hover','#dccb84':'hover','#f3e3a1':'hover','#ff9a96':'error','#ff9d99':'error','#ffb1ad':'error','#ffb4af':'error'};
export function inventoryColor(base,alpha,kind){
 base=base.toLowerCase();let c;
 if(base==='black')c=kind==='text'?token('on-accent'):'#000000'; // Preserve real black image overlays/shadows.
 else if(dark[base])c=token(dark[base]);
 else if(accents[base])c=token(accents[base]);
 else if(/^(sky|cyan)-\d+$/.test(base))c=token('info');
 else if(/^orange-\d+$/.test(base))c=token('warning');
 else c=paintColor(base,undefined,kind);
 if(!c)return null;
 return alpha===undefined?c:mix(c,alpha.startsWith('[')?Number(alpha.slice(1,-1))*100:Number(alpha));
}
export function inventoryPaint(cls){
 // The checkpoint CDN does not emit these nonstandard opacity utilities.
 // Adding paint for them would introduce borders/background alpha absent in
 // the original. Leave their canonical fallback untouched.
 if(/\/(6|8|12|14)$/.test(cls)||/^(?:hover:)?bg-white\/\[0\.0(?:05|15|25)\]$/.test(cls))return null; // Neutral image wash: retain legacy alpha quantization too.
 const m=cls.match(/^(?:(disabled:hover|group-focus-within|group-hover|focus-within|hover|focus|disabled|active):)?(placeholder:text|placeholder|border-[lrtbxy]|drop-shadow|bg|text|border|from|via|to|shadow|ring|fill)-(.+)$/);
 if(!m)return null;
 const [,state='',rawKind,value]=m,kind=rawKind==='placeholder:text'?'placeholder':rawKind;
 const effect=operationalPaint(cls);
 if(effect?.originalEffect){
  // Primary red effects become champagne; keep every source alpha/stop/offset.
  const declarations=Object.fromEntries(Object.entries(effect.declarations).map(([k,v])=>[k,v.replaceAll('223,146,144','168,144,106')]));
  return {variant:state,declarations,originalEffect:effect.originalEffect};
 }
 const match=value.match(/^(\[[^\]]+\]|[^/]+)(?:\/(\d+|\[[\d.]+\]))?$/);if(!match)return null;
 let [,base,alpha]=match;if(base.startsWith('['))base=base.slice(1,-1);
 const c=inventoryColor(base,alpha,['text','placeholder'].includes(kind)?'text':kind);if(!c)return null;
 const position=n=>' var(--tw-gradient-'+n+'-position)';
 if(kind==='from')return {variant:state,declarations:{'--tw-gradient-from':c+position('from'),'--tw-gradient-to':inventoryColor(base,'0',kind)+position('to')}};
 if(kind==='via')return {variant:state,declarations:{'--tw-gradient-stops':'var(--tw-gradient-from), '+c+position('via')+', var(--tw-gradient-to)'}};
 if(kind==='to')return {variant:state,declarations:{'--tw-gradient-to':c+position('to')}};
 const prop={bg:'background-color',text:'color',placeholder:'color',border:'border-color','border-t':'border-top-color','border-r':'border-right-color','border-b':'border-bottom-color','border-l':'border-left-color',shadow:'--tw-shadow-color',ring:'--tw-ring-color',fill:'fill'}[kind];
 return prop?{variant:state,declarations:{[prop]:c}}:null;
}
export function buildInventoryCSS(workspace){
 const lines=['/* Generated Omar inventory RGB overlay. Canonical shapes, alpha and state semantics retained. */','@media screen {'];
 const baseCSS=fs.readFileSync(path.join(workspace,'mini/index.css'),'utf8');
 if(createHash('sha256').update(baseCSS).digest('hex')!==reviewedInventoryBaseCSS)throw Error('Inventory base CSS drift');
 const scope='html[data-omar-mini-theme="foundation"] [data-omar-mini-inventory]';
 const excluded=':not(:where(.receipt-print,.receipt-print *,.print-template,.print-template *,.omar-logo-slot,.omar-logo-slot *))';
 const classes=new Set();
 for(const file of inventoryFiles){const s=fs.readFileSync(path.join(workspace,file),'utf8');if(inventoryDigest(s)!==reviewedInventoryPaint[file])throw Error('Omar inventory paint drift: '+file);inventoryClasses(s).forEach(c=>classes.add(c));}
 const order={'':0,'focus-within':1,hover:2,focus:3,disabled:4,active:5,'disabled:hover':6,'group-focus-within':7,'group-hover':8};
 const rules=[...classes].map(c=>[c,inventoryPaint(c)]).filter(([,p])=>p).sort((a,b)=>order[a[1].variant]-order[b[1].variant]||a[0].localeCompare(b[0],'en'));
 for(const [cls,{variant,declarations}]of rules){
  const attr='[class~="'+cls+'"]';
  const suffix=(variant&&!variant.startsWith('group-')?':'+variant:'')+(cls.startsWith('placeholder:')||cls.startsWith('placeholder-')?'::placeholder':'');
  const selectors=variant.startsWith('group-')?[scope+' .group:'+variant.slice(6)+' '+attr+excluded]:[scope+attr+suffix,scope+' '+attr+excluded+suffix];
  lines.push('  '+selectors.join(',\n  ')+' { '+Object.entries(declarations).map(([p,v])=>p+': '+v+';').join(' ')+' }');
 }
 // Same source red is also used by OUT/rejected badges. Preserve their semantic
 // meaning locally; this custom property changes no alpha or other property.
 lines.push('  '+scope+' [data-omar-mini-inventory-semantic="error"] { --omar-mini-inventory-action: var(--omar-mini-error); }');
 for(const cls of ['text-[#ff9a96]','text-[#ff9d99]','text-[#ffb1ad]','text-[#ffb4af]'])lines.push('  '+scope+' [class~="'+cls+'"] { --omar-mini-inventory-action: var(--omar-mini-error); }');
 lines.push('  '+scope+' [class~="bg-[#E53935]"][class~="text-white"] { color: var(--omar-mini-on-accent); }');
 lines.push('  '+scope+' .inventory-mobile-nav { background-color: color-mix(in srgb, var(--omar-mini-surface) 95%, transparent); border-top-color: color-mix(in srgb, var(--omar-mini-text) 5%, transparent); }',
 '  '+scope+' .inventory-mobile-panel { background-color: var(--omar-mini-page); }',
 '  '+scope+' .inventory-mobile-panel-footer { background-color: var(--omar-mini-surface); border-top-color: color-mix(in srgb, var(--omar-mini-text) 5%, transparent); }');
 lines.push('}');return lines.join('\n')+'\n';
}
export function omarInventoryTheme({workspace,app,mode}){
 if(app!=='mini'||!['hassan', 'omar'].includes(mode))return null;
 return {name:'omar-mini-inventory-theme',enforce:'pre',async configureServer(server){const {inventoryFixtureMiddleware}=await import('./mini-inventory-visual-fixture.mjs');inventoryFixtureMiddleware(server);},buildStart(){if(fs.readFileSync(inventoryStylesheet,'utf8')!==buildInventoryCSS(workspace))throw Error('Omar inventory stylesheet drift');},transform(source,id){
  const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');
  if(file==='mini/index.tsx')return {code:source+'\nimport '+JSON.stringify(inventoryStylesheet)+';\n',map:null};
  const code=inventoryThemeSource(source,file);return code===null?null:{code,map:null};
 }};
}
