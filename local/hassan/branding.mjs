// Activated only by omarConfig. Canonical components/assets remain untouched.
import fs from 'node:fs';
import path from 'node:path';
const directory=path.dirname(new URL(import.meta.url).pathname);
export const brandCaptions = {
  'admin/components/LoginScreen.tsx':['نادي الرجال السري'],
  'admin/components/Header.tsx':['نادي الرجال السري'],
  'admin/components/EmployeeCard.tsx':['SECRET MEN CLUB'],
  'admin/components/EmployeeDetailsModal.tsx':['THE SECRET MEN CLUB'],
  'admin/components/EmployeeDetailsPage.tsx':['THE SECRET MEN CLUB'],
  'admin/components/EmployeeReport.tsx':['THE SECRET MEN CLUB'],
  'admin/components/InvoicesPage.tsx':['The Secret Men Club'],
  'admin/components/AddEmployeePage.tsx':['THE SECRET MEN CLUB'],
  'admin/components/AdminAttendanceDashboard.tsx':['The Secret Men Club'],
  'admin/components/settlement/SettlementDocument.tsx':['SECRET MEN CLUB'],
  'admin/components/settlement/SettlementStudio.tsx':['Official Secret Men Club Stamp'],
  'mini/components/PagePlaceholder.tsx':['نادي الرجال السري'],
  'mini/components/WaitingScreen.tsx':['نادي الرجال السري','Nady El Regal El Serry'],
  'mini/components/CashierScreen.tsx':['Nady El Regal Premium'],
  'mini/components/QueueTicket.tsx':['نادي الرجال السري',"THE SECRET MEN'S CLUB"],
  'mini/components/ReceiptPrintLayout.tsx':["The Secret Men's Club Experience"],
};
const compact=new Set(['admin/components/LoginScreen.tsx','admin/components/Header.tsx']);
export function brandSource(source,relative){
  const captions=brandCaptions[relative];if(!captions)return source;
  for(const caption of captions){
    if(!source.includes(caption))throw Error('Hassan branding source drift: '+relative);
    // These are reviewed JSX display captions only; never API values or message content.
    source=source.replaceAll(caption,compact.has(relative)?'<HassanWordmark compact />':'HASSAN RAGAB SALON');
  }
  if(compact.has(relative))source="import HassanWordmark from 'virtual:hassan-wordmark';\n"+source;
  if(relative==='admin/components/LoginScreen.tsx')source=source.replace('<Logo size="hero" />','<Logo size="hero" className={isDarkMode ? \'\' : \'hr-wordmark-ink\'} />');
  if(relative==='admin/components/Header.tsx')source=source.replace('mt-0.5 sm:mt-1 opacity-60 overflow-hidden','mt-0.5 sm:mt-1 opacity-100 overflow-hidden');
  return source;
}
export function hassanBranding(workspace,app){
  return {
    name:'omar-visible-branding',enforce:'pre',
    resolveId(id,importer){
      if(id==='virtual:hassan-wordmark')return '\0omar-wordmark';
      if(id==='virtual:hassan-logo')return path.join(directory,'assets/hassan-ragab-logo.png');
      if(importer&&path.resolve(path.dirname(importer.split('?')[0]),id)==path.join(workspace,'mini/src/assets/llooggo.svg'))return path.join(directory,'wordmark-ink.svg');
    },
    load(id){if(id==='\0omar-wordmark')return fs.readFileSync(path.join(directory,'wordmark.mjs'),'utf8');},
    transform(source,id){
      const relative=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');
      if(['admin/components/Logo.tsx','mini/components/Logo.tsx'].includes(relative)){
        const admin=relative.startsWith('admin/');
        return {code:`import React from 'react';import Wordmark from 'virtual:hassan-wordmark';
          const sizes={sm:'w-12 h-12',md:'w-24 h-24',lg:'w-36 h-36',xl:'w-48 h-48',hero:'w-64 h-64 sm:w-80 sm:h-80','super-hero':'w-80 h-80 sm:w-[400px] sm:h-[400px]'};
          export default function Logo({className=${admin?"''":"'w-full h-full'"},size='md'}){return React.createElement('div',{className:${admin?"sizes[size]+' '+":""}className+' hr-logo-slot flex items-center justify-center relative'},React.createElement(Wordmark));}`,map:null};
      }
      const code=brandSource(source,relative);if(code!==source)return {code,map:null};
    },
    transformIndexHtml:{order:'pre',handler(html){
      const title=app==='admin'?'HASSAN RAGAB SALON — Admin':'HASSAN RAGAB SALON — Mini';
      return {html:html.replace(/<title>[^<]*<\/title>/,'<title>'+title+'</title>'),tags:[{tag:'style',injectTo:'head',children:`
        .hr-wordmark-ink,.text-black,.print-template,.print-only{--hr-brand-color:#A8906A}
        .admin-side-nav-brand>div:first-child{width:64px!important;height:48px;border:0;border-radius:0;background:transparent}
        .admin-side-nav-brand .hr-logo-slot{width:100%;height:48px}
        .admin-side-nav[data-expanded="true"] .admin-side-nav-brand>div:first-child{width:112px!important}
        .admin-side-nav-brand .bg-white{--hr-brand-color:#A8906A}
      `}]};
    }},
  };
}

export const omarBranding = hassanBranding;
