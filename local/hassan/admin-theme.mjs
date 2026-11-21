// Omar Admin shell RGB overlay. Canonical sources and behavior remain untouched.
import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
export const adminThemeStylesheet=fileURLToPath(new URL('./admin-theme.css',import.meta.url));
export const adminPalette={page:'#162127',input:'#1A282F',surface:'#1E2C33',card:'#273740',border:'#3A4C56',text:'#F3F4F2',secondary:'#B4BEC3',muted:'#96A5AE',accent:'#D8B887','on-accent':'#17232A',hover:'#E4C99F',pressed:'#C4A474',selected:'#35434A',success:'#79B69B',warning:'#D6B576',error:'#DF9290',info:'#91B7CC'};
export const shellFiles={sidebar:'admin/components/SideNav.tsx',header:'admin/components/Header.tsx',bottom:'admin/components/BottomNav.tsx'};
const paintPattern=/(?<![\w:-])(?:(?:[\w-]+):)*(?:bg|text|border|shadow)-(?:\[[^\]\s]+\]|white|black|transparent|current|gray-\d+)(?:\/(?:\d+|\[[\d.]+\]))?/g;
export const shellPaintClasses=s=>[...new Set(s.match(paintPattern)||[])].sort();
export const shellPaintDigest=s=>createHash('sha256').update(JSON.stringify(shellPaintClasses(s))).digest('hex');
export const reviewedShellPaint={
  "admin/components/SideNav.tsx": "60637a14b2109a25c107508538d447964c4dcf0544ff61cd5625568ddd0d41b8",
  "admin/components/Header.tsx": "4940284c10305966f351af9b378a687fb263590304ad7f63ab01804f926a6ba5",
  "admin/components/BottomNav.tsx": "733b5bf6d636f627a2ebfe44758d5990abacfb212187a3c247f7b283f290c97c"
};
export const adminShellHooks={
 'admin/App.tsx':[['<div className={`min-h-screen flex animate-fade-in theme-transition','<div data-omar-admin-shell={isDarkMode ? "dark" : "light"} className={`min-h-screen flex animate-fade-in theme-transition']],
 'admin/components/SideNav.tsx':[['<aside\n      id="admin-sidebar"','<aside data-omar-admin-region="sidebar" data-omar-admin-mode={isDarkMode ? "dark" : "light"}\n      id="admin-sidebar"'],['<button type="button" onClick={onLogout}','<button data-omar-admin-semantic="logout" type="button" onClick={onLogout}']],
 'admin/components/Header.tsx':[['<header\n      className=','<header data-omar-admin-region="header" data-omar-admin-mode={isDarkMode ? "dark" : "light"}\n      className='],['<p className="text-[#E53935] text-[7px] sm:text-[8px]','<p data-omar-admin-header-subtitle className="text-[#E53935] text-[7px] sm:text-[8px]']],
 'admin/components/BottomNav.tsx':[['<div\n            className=','<div data-omar-admin-region="bottom" data-omar-admin-mode={isDarkMode ? "dark" : "light"}\n            className=']],
};
export function adminThemeSource(source,file){
 const hooks=adminShellHooks[file];if(!hooks)return null;
 if(reviewedShellPaint[file]&&shellPaintDigest(source)!==reviewedShellPaint[file])throw Error('Omar Admin shell paint drift: '+file);
 let code=source;for(const[before,after]of hooks){if(code.split(before).length!==2||code.includes(after))throw Error('Omar Admin shell hook drift: '+file);code=code.replace(before,after);}return code;
}
const token=n=>'var(--omar-admin-'+n+')';
const accent='var(--omar-admin-navigation-accent, var(--omar-admin-accent))';
export function shellPaint(cls,region){
 const m=cls.match(/^(?:(group-hover|hover):)?(bg|text|border|shadow)-(.+)$/);if(!m)return null;
 const[,variant='',kind,value]=m;
 if(kind==='shadow'&&value==='[0_0_4px_#E53935]')return{variant,declarations:{'--tw-shadow':'0 0 4px #D8B887'}};
 const v=value.match(/^(\[[^\]]+\]|[^/]+)(?:\/(\d+|\[[\d.]+\]))?$/);if(!v)return null;let[,base,alpha]=v;
 base=base.replace(/^\[|\]$/g,'');let color;
 const rgba=base.match(/^rgba\(229,57,53,([\d.]+)\)$/);if(rgba){color=accent;alpha='['+rgba[1]+']';}
 else if(base==='#E53935')color=accent;
 else if(base==='#E6D690')color=token('accent');
 else if(base==='#0B0B0B')color=token(region==='sidebar'?'surface':'input');
 else if(base==='#000000'||base==='#0D0D0D')color=token('surface');
 else if(base==='#161616'||base==='#1A1A1A')color=token('card');
 else if(base==='white')color=token(kind==='border'?'border':'text');
 else if(base==='#9E9E9E'||base==='gray-300')color=token('secondary');
 else if(base==='#7A7A7A'||base==='gray-500')color=token('muted');
 if(!color)return null;
 if(alpha!==undefined)color=`color-mix(in srgb, ${color} ${alpha.startsWith('[')?Number(alpha.slice(1,-1))*100:Number(alpha)}%, transparent)`;
 return{variant,declarations:{[{'bg':'background-color','text':'color','border':'border-color'}[kind]]:color}};
}
export function buildAdminThemeCSS(workspace){
 const lines=['/* Omar Admin Dark shell only. Original geometry, state forms and alpha retained. */','@media screen {'];
 lines.push('  html[data-omar-admin-theme="foundation"] { '+Object.entries(adminPalette).map(([k,v])=>'--omar-admin-'+k+': '+v+';').join(' ')+' }');
 lines.push('  html[data-omar-admin-theme="foundation"] [data-omar-admin-shell="dark"][class~="bg-[#0D0D0D]"] { background-color: var(--omar-admin-page); }');
 const excluded=':not(:where(.admin-side-nav-brand,.admin-side-nav-brand *,.omar-logo-slot,.omar-logo-slot *,.omar-wordmark ,.omar-wordmark *))';
 for(const[region,file]of Object.entries(shellFiles)){
  const source=fs.readFileSync(path.join(workspace,file),'utf8');if(shellPaintDigest(source)!==reviewedShellPaint[file])throw Error('Omar Admin paint drift: '+file);
  const scope=`html[data-omar-admin-theme="foundation"] [data-omar-admin-region="${region}"][data-omar-admin-mode="dark"]`;
  const rules=shellPaintClasses(source).map(c=>[c,shellPaint(c,region)]).filter(([,p])=>p).sort((a,b)=>({'':0,hover:1,'group-hover':2}[a[1].variant]-{'':0,hover:1,'group-hover':2}[b[1].variant])||a[0].localeCompare(b[0],'en'));
  for(const[cls,{variant,declarations}]of rules){const attr='[class~="'+cls+'"]';const protect=excluded+(Object.hasOwn(declarations,'color')?':not(:has(.omar-wordmark))':'');const selectors=variant==='group-hover'?[scope+' .group:hover '+attr+protect]:[scope+attr+protect+(variant?':hover':''),scope+' '+attr+protect+(variant?':hover':'')];lines.push('  '+selectors.join(',\n  ')+' { '+Object.entries(declarations).map(([k,v])=>k+': '+v+';').join(' ')+' }');}
  if(region==='sidebar'){
   lines.push('  '+scope+' .admin-side-nav-control { color: var(--omar-admin-accent); }');
   lines.push('  '+scope+' :is(.admin-side-nav-item,.admin-side-nav-control):focus-visible { outline-color: var(--omar-admin-accent); }');
   lines.push('  '+scope+' [data-omar-admin-semantic="logout"] { --omar-admin-navigation-accent: #EF3434; }');
   lines.push('  '+scope+' .sidebar-scroll { scrollbar-color: rgba(216,184,135,0.25) transparent; }');
   lines.push('  '+scope+' .sidebar-scroll::-webkit-scrollbar-thumb { background-color: rgba(216,184,135,0.25); }');
   lines.push('  '+scope+' .sidebar-scroll::-webkit-scrollbar-thumb:hover { background-color: rgba(216,184,135,0.55); }');
  }
 }
 // Owner-authorized content removal in both modes. Retain the original line box
 // so title alignment and all header control rectangles remain unchanged.
 lines.push('  html[data-omar-admin-theme="foundation"] [data-omar-admin-region="header"] [data-omar-admin-header-subtitle] { visibility: hidden; }');
 lines.push('}');return lines.join('\n')+'\n';
}
export function omarAdminTheme({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return{name:'omar-admin-theme-foundation',enforce:'pre',
 async configureServer(server){const{adminShellFixtureMiddleware}=await import('./admin-shell-visual-fixture.mjs');adminShellFixtureMiddleware(server);},
 buildStart(){if(fs.readFileSync(adminThemeStylesheet,'utf8')!==buildAdminThemeCSS(workspace))throw Error('Omar Admin stylesheet drift');},
 transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(file==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(adminThemeStylesheet)+';\n',map:null};const code=adminThemeSource(source,file);return code===null?null:{code,map:null};},
 transformIndexHtml:{order:'pre',handler(html){if(!html.includes('<html ')||html.includes('data-omar-admin-theme'))throw Error('Omar Admin HTML hook drift');return html.replace('<html ','<html data-omar-admin-theme="foundation" ');}},
 };
}
