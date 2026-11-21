// Omar Admin active Inventory/Supply paint. No stock/data/Promo transformations.
import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';import{workforcePaint}from'./admin-workforce-theme.mjs';import{inventoryClasses}from'./mini-inventory-theme.mjs';import{namespaceSource}from'./frontend-config.mjs';import{brandSource}from'./branding.mjs';
const workspace=path.resolve(import.meta.dirname,'../..');
export const stockStylesheet=fileURLToPath(new URL('./admin-stock-theme.css',import.meta.url));
export const stockFiles=/* ACTIVE */ [
  "admin/components/InventoryPage.tsx",
  "admin/components/supply/BranchComparison.tsx",
  "admin/components/supply/BranchInventoryDrawer.tsx",
  "admin/components/supply/BranchRequestsTab.tsx",
  "admin/components/supply/BranchSelector.tsx",
  "admin/components/supply/BulkTransferModal.tsx",
  "admin/components/supply/CatalogPagination.tsx",
  "admin/components/supply/ComparisonProductPicker.tsx",
  "admin/components/supply/DirectSupplierReturnModal.tsx",
  "admin/components/supply/OperationalPipeline.tsx",
  "admin/components/supply/ProductActivityHistory.tsx",
  "admin/components/supply/ProductActivityTimeline.tsx",
  "admin/components/supply/ProductAvailabilitySummary.tsx",
  "admin/components/supply/ProductBatchBreakdown.tsx",
  "admin/components/supply/ProductBatchHistory.tsx",
  "admin/components/supply/ProductBranchDistribution.tsx",
  "admin/components/supply/ProductCatalog.tsx",
  "admin/components/supply/ProductDistributionPanel.tsx",
  "admin/components/supply/ProductHistoryPagination.tsx",
  "admin/components/supply/ProductInventoryDetails.tsx",
  "admin/components/supply/ProductInventoryHeader.tsx",
  "admin/components/supply/ProductInventoryWorkspace.tsx",
  "admin/components/supply/ProductMovementBadge.tsx",
  "admin/components/supply/ProductMovementLegend.tsx",
  "admin/components/supply/ProductReceivePanel.tsx",
  "admin/components/supply/ProductSearchPicker.tsx",
  "admin/components/supply/ProductWorkspaceAction.tsx",
  "admin/components/supply/QuickActions.tsx",
  "admin/components/supply/ReceiveSupplyModal.tsx",
  "admin/components/supply/RecentActivity.tsx",
  "admin/components/supply/ReturnCostSummary.tsx",
  "admin/components/supply/ReturnsTab.tsx",
  "admin/components/supply/ShipmentDetailsModal.tsx",
  "admin/components/supply/ShipmentHistoryCard.tsx",
  "admin/components/supply/ShipmentHistoryTab.tsx",
  "admin/components/supply/StockStatusBadge.tsx",
  "admin/components/supply/SupplierReturnCosts.tsx",
  "admin/components/supply/SupplyOverview.tsx",
  "admin/components/supply/SupplyWorkspaceControls.tsx",
  "admin/components/supply/SupplyWorkspacePanel.tsx",
  "admin/components/supply/TransferCart.tsx",
  "admin/components/supply/TransferSummary.tsx",
  "admin/components/supply/overviewDates.ts",
  "admin/components/supply/productHistoryTypes.ts",
  "admin/components/supply/productMovementPresentation.ts",
  "admin/components/supply/productVisuals.tsx",
  "admin/components/supply/productWorkspaceStyles.ts",
  "admin/components/supply/supplyOverviewTypes.ts",
  "admin/components/supply/supplyWorkspaceFilters.ts",
  "admin/components/supply/supplyWorkspaceTypes.ts"
];
export const reviewedStock=/* REVIEWED */ {
  "admin/components/InventoryPage.tsx": "0bf5bec40881cbb3888b9e924cc7321c18838fbc7c2691bb06d35c8886c5f2ff",
  "admin/components/supply/BranchComparison.tsx": "63f4b3cac4727f1d14d806721227ad98b912a32daa75109d19d3ebb4e4d52b13",
  "admin/components/supply/BranchInventoryDrawer.tsx": "6f39b38e47492462a9c45352d616fe67365f398b414cc8a9b06bf1880759d921",
  "admin/components/supply/BranchRequestsTab.tsx": "114a932b40663760cae60f8e1140fce528826cee2f85bc8661ad84b925f9733e",
  "admin/components/supply/BranchSelector.tsx": "ebf505a4a908cde98e98104b73fdb72b37bd36515dd9087da7fa403dc61b8f93",
  "admin/components/supply/BulkTransferModal.tsx": "951280c1108ecd1e147d2d47a47c155192a22f904a9589c6ea89dc8a3929a048",
  "admin/components/supply/CatalogPagination.tsx": "cedbac173a08472bad8e2832ef0dd2087cd4bb55f62f549ffd26b1c4c9c3af21",
  "admin/components/supply/ComparisonProductPicker.tsx": "b8b46e5306cdc9c6ebe19deace4ef0e3fb4ebc6e4385d2ee291c45662afbc20f",
  "admin/components/supply/DirectSupplierReturnModal.tsx": "2c37ed25cf38fb263d87f26eb8bdd5ecd71fe15b8ef91179c1340e43418c488a",
  "admin/components/supply/OperationalPipeline.tsx": "f393219519299a4002e90b4dbab01ac65e6d151c5afb55622ae47ecd826448d8",
  "admin/components/supply/ProductActivityHistory.tsx": "7041e577c01288fec5debbe50a3d5201c0d1bfda11d5f4e2603edb0501575830",
  "admin/components/supply/ProductActivityTimeline.tsx": "6faebf013cbffb917a97432c11712d8a0bff6a944263c6ccae06ff6b501f5eb9",
  "admin/components/supply/ProductAvailabilitySummary.tsx": "905e31786ba6dac92991eed07373db47ce053422f28d13962f5447fe16e6474e",
  "admin/components/supply/ProductBatchBreakdown.tsx": "492f190667105b9bc667ef6fa2efff77adc1675f1daf5ab1975dbd178a6faefe",
  "admin/components/supply/ProductBatchHistory.tsx": "7ae4076d4591d3a0a0f7a877c61895a61fb5a942e2d141e09f82b83e99077a40",
  "admin/components/supply/ProductBranchDistribution.tsx": "fbdde16a6eb113880392e742c7672843408b4bcf1a12c1ee7493fa5f02781d9f",
  "admin/components/supply/ProductCatalog.tsx": "1e132b9b736c62ae08f9dcb71242910233b2584bc679b0082039403b6cf3f9a5",
  "admin/components/supply/ProductDistributionPanel.tsx": "6a3478c7ae43f72e16200b01a2e092053ff5757672464203e73008a17aee5965",
  "admin/components/supply/ProductHistoryPagination.tsx": "84a4a67680a04f39e4ec7b77146429f93b561b1b5a674530460321996919e67b",
  "admin/components/supply/ProductInventoryDetails.tsx": "ae985bf25317e8187e9f7c1249e6c0005a9eb66ecbfd759746e7d65388cc1d6c",
  "admin/components/supply/ProductInventoryHeader.tsx": "ac787282c49bdd65b79712bc35830caad7b4c852d328f8b9345757e10f575690",
  "admin/components/supply/ProductInventoryWorkspace.tsx": "0ab515179aea1240292f81ccb3a9599f89d2b61520ad789a8b1905f673451fdc",
  "admin/components/supply/ProductMovementBadge.tsx": "3b0843a44a39f3514d35c96dd53fe0419672e6efd58613787986e535aec1a911",
  "admin/components/supply/ProductMovementLegend.tsx": "06fdfa146807657d6361f30408d1c3256b07414a7702e75876b0161535076f43",
  "admin/components/supply/ProductReceivePanel.tsx": "147851fbf15573678920fe8290fdc2f9f23adfa7a1912ee5b86df8280a6a6bf8",
  "admin/components/supply/ProductSearchPicker.tsx": "646927494a25b6bfa4b9b6049ff0319642f025f973df0052f56cee5fc3a177ec",
  "admin/components/supply/ProductWorkspaceAction.tsx": "48e44ab9a9e5cc69ae4392f80ac8655679bb8e5be1b28ff65d58514eb87b2e14",
  "admin/components/supply/QuickActions.tsx": "2b32bb61806beef0f8f9d5804a52bfcce5ae412da78696be1da8a39a9b5a53b7",
  "admin/components/supply/ReceiveSupplyModal.tsx": "8eab5a200ac478cf1e65774a13076df91460c25767539c6e24778e9f1ed82714",
  "admin/components/supply/RecentActivity.tsx": "c04b9a8f8cc4d6e9c09ef3eb3ad7797c3c54a618dee2a95e9ed3e6b2123b36d1",
  "admin/components/supply/ReturnCostSummary.tsx": "b89207c091950f1110eaeea755e1d9017af51dbd2a6da1eb08582b8f08dd755b",
  "admin/components/supply/ReturnsTab.tsx": "0416c47fa41b5e29f436b61e76dd4f34583ad4858045760f2a4ddc6f7b6d2b4b",
  "admin/components/supply/ShipmentDetailsModal.tsx": "739de5712a016d14c2c920c5914b3f33ef1de954dc943e71b9281fc112560d80",
  "admin/components/supply/ShipmentHistoryCard.tsx": "c21b61a52e4a28f41d930eac2cacc593765dbbf5722029340794dadffe10d5ed",
  "admin/components/supply/ShipmentHistoryTab.tsx": "9893743e5197bdd56ffd4cf7220c131ef2ff51d67375e745188c75fc3cc6a3b5",
  "admin/components/supply/StockStatusBadge.tsx": "0ea5766018847922f60f0f7619d390d513e6bc9882df23ffb7aadf2abbe905f9",
  "admin/components/supply/SupplierReturnCosts.tsx": "773f731ee59508a96dda04b273057b4b460743f63f70dd03ce6f8fcf8e122ab4",
  "admin/components/supply/SupplyOverview.tsx": "243f5912164b1eb2d46ee3f784db255fd8bdc304b7426e367802e33dbec02a6e",
  "admin/components/supply/SupplyWorkspaceControls.tsx": "3df72e1b2af767c2959e444cc3bc32b78f72f1478f083be7e9fdf206fac3d643",
  "admin/components/supply/SupplyWorkspacePanel.tsx": "565a118314c7227d9cd8f9975553d3c6915df9dfb91def73b363c9ce6d67ee41",
  "admin/components/supply/TransferCart.tsx": "b47e701150fe720faaae084c406e83bb3ee44e6f81bbf67c125155dba2942033",
  "admin/components/supply/TransferSummary.tsx": "fb28bce1f37c3a2e80ed6ac00ebc92bc77903bbf47fc9ea30d3e4f8833137d73",
  "admin/components/supply/overviewDates.ts": "9068303585453da5d96988dcd2e57d034d25c9b904fe07721cdaa96be26e5c2d",
  "admin/components/supply/productHistoryTypes.ts": "09fec73a0f37586b227ce4408455e9d680be5e8947b42e4afede60eaece7e3e8",
  "admin/components/supply/productMovementPresentation.ts": "a409e33c34313de6982ff2f434874cc88d496294ea958e46df92b8d2cfe037e9",
  "admin/components/supply/productVisuals.tsx": "e3d3f1e9bd2f5907be7b1bb627afbc7cfc3d44b6c33b2d6a42e3308f2182ad10",
  "admin/components/supply/productWorkspaceStyles.ts": "dcc2cc071c888d8183f3c4b7e938185e9216f0b5ed5290f4e245ac1bfb554966",
  "admin/components/supply/supplyOverviewTypes.ts": "76ddb1d30e43550186f0f6c26b04f1bf1380db83d88d888b616131e15ed435b4",
  "admin/components/supply/supplyWorkspaceFilters.ts": "9552e5726f178fb43c7ee371559cdd6a0029dd3873b275e70c2de89cc1051b93",
  "admin/components/supply/supplyWorkspaceTypes.ts": "08f2945b0fd0c15ff7ffbfa9e4d2d97c9074d340e0599f46b49a4e2daa2c54eb"
};
export const stockHooks={
 'admin/components/InventoryPage.tsx':[['<div className="admin-page-shell relative z-10','<div data-omar-admin-stock={isDarkMode ? "dark" : "light"} className="admin-page-shell relative z-10',1]],
 'admin/components/supply/ShipmentDetailsModal.tsx':[['<div className="admin-overlay-shell admin-overlay-shell--scroll z-[9999]','<div data-omar-admin-stock-portal className="admin-overlay-shell admin-overlay-shell--scroll z-[9999]',1]],
};
export const stockDigest=s=>createHash('sha256').update(s).digest('hex');
export function stockThemeSource(source,file){const hooks=stockHooks[file];if(!hooks)return null;const raw=fs.readFileSync(path.join(workspace,file),'utf8');if(stockDigest(raw)!==reviewedStock[file]||![raw,namespaceSource(raw),brandSource(namespaceSource(raw),file)].includes(source))throw Error('Omar stock source drift: '+file);let code=source;for(const[b,a,n]of hooks){if(code.includes(a)||code.split(b).length!==n+1)throw Error('Omar stock hook drift: '+file);code=code.replaceAll(b,a);}return code;}
export const stockClasses=s=>[...new Set([...inventoryClasses(s),...(s.match(/(?<![\w:-])(?:(?:[\w-]+):)*(?:bg|text|border(?:-[lrtbxy])?|from|via|to|shadow|ring|outline)-(?:\[[^\]\s]+\]|(?:teal|indigo|lime|red|emerald|blue|amber|yellow|violet|slate)-\d+)(?:\/(?:\d+|\[[\d.]+\]))?/g)||[])])];
const stockHex={
 '#0a0b0e':'#162127','#0c0c0f':'#162127','#0c0d10':'#1E2C33','#0c0d12':'#1E2C33','#0d0d10':'#1A282F','#0d0e12':'#1E2C33','#0d0f12':'#1E2C33','#0e0e11':'#1E2C33','#0e0f13':'#1E2C33','#101010':'#1A282F','#101114':'#1A282F','#111216':'#1A282F','#121316':'#273740','#141519':'#273740','#14161a':'#35434A','#151515':'#273740','#161618':'#273740','#202020':'#35434A',
 '#111214':'#17232A','#8e939e':'#B8C5CC','#90c6ff':'#3291FF','#f2e4ab':'#D8B887','#f6e8ac':'#D8B887','#d9c983':'#E4C99F',
 '#c82e2b':'#EF3434','#f44336':'#E4C99F','#f04a45':'#E4C99F','#f43f36':'#E4C99F','#ff4343':'#E4C99F','#ff7b77':'#EF3434','#ff847f':'#EF3434','#ff8a80':'#EF3434','#ff9d99':'#EF3434','#ffb1ad':'#EF3434','#ffb1ae':'#EF3434','#ffb8b4':'#EF3434',
};
const hues={red:['#EF3434','#211319','#6E2931'],rose:['#EF3434','#211319','#6E2931'],emerald:['#16C784','#0F2E25','#196B4E'],green:['#16C784','#0F2E25','#196B4E'],blue:['#3291FF','#0C2338','#1D5586'],amber:['#F5A623','#30230F','#795A24'],yellow:['#F5A623','#30230F','#795A24'],violet:['#A78BFA','#251B3A','#5A4384'],purple:['#A78BFA','#251B3A','#5A4384'],teal:['#2DD4BF','#0B2C2D','#196267'],indigo:['#818CF8','#1D2340','#414D83'],lime:['#A3E635','#24311A','#536F2C']};
export function stockPaint(cls){const alpha=cls.match(/\/(\d+)$/);if(alpha&&Number(alpha[1])%5!==0)return null;
 const m=cls.match(/^(?:(disabled:hover|group-focus-within|group-hover|focus-within|focus-visible|hover|focus|disabled|active):)?(bg|text|border|ring|outline|from|via|to)-((?:red|rose|emerald|green|blue|amber|yellow|violet|purple|teal|indigo|lime)-(\d+))(?:\/(\d+|\[[\d.]+\]))?$/);
 if(m){const[,state='',kind,base,shade,a]=m,hue=hues[base.split('-')[0]];let color=kind==='bg'&&(Number(shade)>=800||(Number(shade)<=200&&!a))?hue[1]:kind==='border'&&Number(shade)>=700?hue[2]:hue[0];if(a)color=`color-mix(in srgb, ${color} ${a.startsWith('[')?Number(a.slice(1,-1))*100:Number(a)}%, transparent)`;
 if(['bg','text','border','ring','outline'].includes(kind))return{variant:state,declarations:{[{bg:'background-color',text:'color',border:'border-color',ring:'--tw-ring-color',outline:'outline-color'}[kind]]:color}};
 }
 // Semantic gradient steps keep the established helper's distinct source forms.
 const hex=cls.match(/#[0-9a-fA-F]{6}\b/)?.[0],mapped=hex&&stockHex[hex.toLowerCase()];
 if(cls.includes('outline-')){const source=cls.replace('outline-','border-'),paint=workforcePaint(source);if(paint)return{...paint,declarations:{'outline-color':Object.values(paint.declarations)[0]}};}
 if(mapped){const p=workforcePaint(cls.replace(hex,'#E6D690'));if(p)return{...p,declarations:Object.fromEntries(Object.entries(p.declarations).map(([k,v])=>[k,v.replaceAll('#D8B887',mapped)]))};}
 if(cls==='bg-white')return{variant:'',declarations:{'background-color':'#273740'}};
 return workforcePaint(cls);
}
export function buildStockCSS(root){
 // A portal receives paint only while its owning Inventory page is mounted Dark.
 const scope='html[data-omar-admin-theme="foundation"]:has([data-omar-admin-stock="dark"]) :is([data-omar-admin-stock="dark"],[data-omar-admin-stock-portal])';
 const guard=':not(:where([data-omar-admin-document-protected],[data-omar-admin-document-protected] *,[data-omar-admin-workforce-document],[data-omar-admin-workforce-document] *,.print-template,.print-template *,.print-only,.print-only *)):not(:has([data-omar-admin-document-protected],[data-omar-admin-workforce-document]))';
 const classes=new Set();for(const f of stockFiles){const s=fs.readFileSync(path.join(root,f),'utf8');if(stockDigest(s)!==reviewedStock[f])throw Error('Omar stock paint drift: '+f);stockClasses(s).forEach(c=>classes.add(c));}
 const lines=['/* Omar Admin active Inventory/Supply only. Original shapes, alpha and behavior retained. */','@media screen {'];const order={'':0,'focus-within':1,hover:2,focus:3,'focus-visible':4,disabled:5,active:6,'disabled:hover':7,'group-focus-within':8,'group-hover':9};
 for(const[cls,{variant,declarations}]of[...classes].map(c=>[c,stockPaint(c)]).filter(([,p])=>p).sort((a,b)=>order[a[1].variant]-order[b[1].variant]||a[0].localeCompare(b[0],'en'))){const attr='[class~="'+cls+'"]',suffix=(variant&&!variant.startsWith('group-')?':'+variant:'')+(cls.startsWith('placeholder')?'::placeholder':'');const selectors=variant.startsWith('group-')?[scope+' .group:'+variant.slice(6)+' '+attr+guard]:[scope+attr+guard+suffix,scope+' '+attr+guard+suffix];lines.push('  '+selectors.join(',\n  ')+' { '+Object.entries(declarations).map(([p,v])=>p+': '+v+';').join(' ')+' }');}
 for(const c of ['bg-[#E53935]','bg-[#E6D690]','bg-emerald-500','bg-emerald-500/90','bg-green-500','bg-blue-500','bg-amber-500'])lines.push('  '+scope+' [class~="'+c+'"][class~="text-white"]'+guard+' { color: #17232A; }');
 lines.push('  '+scope+' nav[aria-label="أقسام مركز الإمداد"] button[aria-current="page"]'+guard+' { border-color: #D8B887; }');
 // Only enabled product-workspace field placeholders: 40% -> 75% white.
 // Preserve disabled controls, image placeholder captions and all other alpha.
 lines.push('  '+scope+' :is(input,textarea)[class~="placeholder:text-white/40"]'+guard+':not(:disabled):not([aria-disabled="true"])::placeholder { color: rgba(255,255,255,0.75); }');
 lines.push('}');return lines.join('\n')+'\n';}
export function omarStockTheme({workspace,app,mode}){if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;return{name:'omar-admin-stock-theme',enforce:'pre',buildStart(){if(fs.readFileSync(stockStylesheet,'utf8')!==buildStockCSS(workspace))throw Error('Omar stock stylesheet drift');},transform(source,id){const f=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(f==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(stockStylesheet)+';\n',map:null};const code=stockThemeSource(source,f);return code===null?null:{code,map:null};}};}
