// Presentation-only substitutions. Never enabled by the canonical or Admin configs.
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {contract} from './frontend-config.mjs';

const directory=path.dirname(fileURLToPath(import.meta.url));
function once(source,before,after){
 if(source.split(before).length!==2)throw Error('Hassan brand cleanup source drift: '+before.slice(0,90));
 return source.replace(before,after);
}
export function cleanupSource(source,file){
 let code=source;
 if(file==='mini/src/utils/whatsappUtil.ts')code=once(code,'شكرًا لزيارتك صالون نادي الرجال السري فرع oct 🤍','شكرًا لزيارتك Hassan Ragab Salon 🤍');
 if(['mini/components/Receipt.tsx','mini/components/ReceiptPrintLayout.tsx','mini/components/AppointmentDepositReceipt.tsx'].includes(file)){
  code=once(code,"import logo from '../src/assets/llooggo.svg';","import logo from 'virtual:omar-mini-print-logo';");
 }
 if(['mini/components/Receipt.tsx','mini/components/ReceiptPrintLayout.tsx'].includes(file)){
  const qr = "src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent('" + contract.mini.origin + "')}`}";
  code=once(code,qr,'src={omarUnavailableQR}');
  code="import omarUnavailableQR from 'virtual:omar-mini-unavailable-qr';\n"+code;
  code=once(code,'alt="QR"','alt="Salon link unavailable"');
 }
 if(file==='mini/components/ReceiptPrintLayout.tsx'){
  code=once(code,"branchName || 'فرع المنصورة'","branchName || 'الفرع'");
  code=once(code,'Scan & unlock the full experience','Salon link unavailable');
 }
 if(file==='mini/components/CashierScreen.tsx')code=once(code,'Character Selection System • HASSAN RAGAB SALON','Hassan Ragab Salon');
 if(file==='mini/components/Sidebar.tsx')code=once(code,"import Logo from './Logo';","import Logo from 'virtual:omar-mini-sidebar-logo';");
 if(file==='mini/components/WaitingScreen.tsx')code=once(code,"import Logo from './Logo';","import Logo from 'virtual:omar-mini-waiting-print-logo';");
 return code===source?null:code;
}
export function omarMiniBrandCleanup({workspace,app,mode}){
 if(app!=='mini'||!['hassan', 'omar'].includes(mode))return null;
 const assets={
  'virtual:omar-mini-print-logo':'mini-print-logo.svg',
  'virtual:omar-mini-unavailable-qr':'receipt-qr-unavailable.svg',
  'virtual:omar-mini-white-logo':'cashier-header-logo-white-tight.svg',
 };
 return {name:'omar-mini-brand-cleanup',enforce:'pre',
 buildStart(){if(this.meta.watchMode!==true)this.emitFile({type:'asset',fileName:'assets/hr-favicon.svg',source:fs.readFileSync(path.join(directory,'assets/mini-favicon.svg'))});},
 resolveId(id){if(assets[id])return path.join(directory,'assets',assets[id]);if(['virtual:omar-mini-sidebar-logo','virtual:omar-mini-waiting-print-logo'].includes(id))return '\0'+id;},
 load(id){if(!['\0virtual:omar-mini-sidebar-logo','\0virtual:omar-mini-waiting-print-logo'].includes(id))return;
 const ink=id.includes('waiting');
 return `import React from 'react';import Wordmark from 'virtual:hassan-wordmark';import logo from '${ink?'virtual:omar-mini-print-logo':'virtual:omar-mini-white-logo'}';
 export default function Logo({className='w-full h-full'}){return React.createElement('div',{className:className+' hr-logo-slot flex items-center justify-center relative'},React.createElement('span',{'aria-hidden':true,style:{display:'contents',visibility:'hidden'}},React.createElement(Wordmark)),React.createElement('img',{src:logo,alt:'Hassan Ragab Salon',style:{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain'}}));}`;
 },
 transform(source,id){const code=cleanupSource(source,path.relative(workspace,id.split('?')[0]).split(path.sep).join('/'));return code===null?null:{code,map:null};},
 configureServer(server){server.middlewares.use((req,res,next)=>{
 const match=/^\/__hr_brand_qa\/(before|after)-(ReceiptPrintLayout|AppointmentDepositReceipt|Sidebar)$/.exec((req.url||'').split('?')[0]);
 const fixture=path.join(workspace,'.local/hassan/brand-cleanup');
 if(!match||!fs.existsSync(path.join(fixture,'enable')))return next();
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(fixture,match[1]+'-'+match[2]+'-preview.html')));
 });server.middlewares.use('/__hr-favicon.svg',(_req,res)=>{res.setHeader('Content-Type','image/svg+xml');res.end(fs.readFileSync(path.join(directory,'assets/mini-favicon.svg')));});},
 transformIndexHtml:{order:'post',handler(_html,context){const href=context.server?'/__hr-favicon.svg':'./assets/hr-favicon.svg';return [{tag:'link',attrs:{rel:'icon',type:'image/svg+xml',href},injectTo:'head'}];}},
 };
}
