// Explicitly authorized Omar shell geometry; independent of paint-only themes.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const compactStylesheet=fileURLToPath(new URL('./admin-compact-shell.css',import.meta.url));
const logoId='virtual:omar-admin-sidebar-logo';
export function compactShellSource(source,file){
 if(!['admin/components/Header.tsx','admin/components/SideNav.tsx'].includes(file))return null;
 let code=source;
 const replace=(before,after)=>{if(code.split(before).length!==2)throw Error('Omar compact shell source drift: '+file+' '+before);code=code.replace(before,after);};
 if(file.endsWith('/Header.tsx')){
  const row=/<div className="flex items-center gap-1 sm:gap-2 mt-0\.5 sm:mt-1 opacity-100 overflow-hidden">\s*<div[^\n]+<\/div>\s*<p data-omar-admin-header-subtitle[^\n]+<\/p>\s*<div[^\n]+<\/div>\s*<\/div>/g;
  if([...code.matchAll(row)].length!==1)throw Error('Omar subtitle row drift');
  code=code.replace(row,'');
  replace('              <select\n','              <select aria-label="اختيار الفرع"\n');
  replace('<MapPin size={14} className="text-[#E53935]" />','<MapPin data-omar-branch-pin size={14} className="text-[#E53935]" />');
  replace('<div className="max-w-7xl','<div data-omar-header-frame className="max-w-7xl');
  replace('<div className="flex items-center gap-2 sm:gap-4 flex-1">','<div data-omar-header-profile className="flex items-center gap-2 sm:gap-4 flex-1">');
  replace('<div className="flex flex-col items-center justify-center flex-1 text-center truncate">','<div data-omar-header-title className="flex flex-col items-center justify-center flex-1 text-center truncate">');
  replace('<div className="flex items-center justify-end gap-3 sm:gap-6 flex-1">','<div data-omar-header-branch className="flex items-center justify-end gap-3 sm:gap-6 flex-1">');
 }else{
  const caption=/<div className="admin-side-nav-label min-w-0">\s*<h2[^\n]+>نظام القيادة التنفيذي<\/h2>\s*<div[^\n]+\/>(?:\s*)<\/div>/g;
  if([...code.matchAll(caption)].length!==1)throw Error('Omar Sidebar caption drift');
  code=code.replace(caption,'');
  replace('<Logo size="sm" />','<OmarAdminSidebarLogo isDarkMode={isDarkMode} />');
  code="import OmarAdminSidebarLogo from '"+logoId+"';\n"+code;
 }
 return code;
}
export function omarCompactShell({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return{name:'omar-admin-compact-shell',enforce:'pre',
 resolveId(id){if(id===logoId)return '\0'+logoId;},
 load(id){if(id!=='\0'+logoId)return null;return `import React from 'react';
  import logo from ${JSON.stringify(fileURLToPath(new URL('./assets/hassan-ragab-logo.png',import.meta.url)))};
  export default function OmarAdminSidebarLogo(){return React.createElement('img',{src:logo,alt:'Hassan Ragab Salon',className:'omar-admin-sidebar-logo object-contain',style:{maxHeight:'40px',aspectRatio:'849/410',objectFit:'contain'}});}`;},
 transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(file==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(compactStylesheet)+';\n',map:null};const code=compactShellSource(source,file);return code===null?null:{code,map:null};}
 };
}
