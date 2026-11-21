// Offline synthetic receipt evidence. No application startup, API calls or printing.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const root=process.cwd(),req=Module.createRequire(path.join(root,'mini/package.json'));
const React=req('react'),{renderToStaticMarkup}=req('react-dom/server'),esbuild=req('esbuild');
(async()=>{
const {cleanupSource,omarMiniBrandCleanup}=await import('./mini-brand-cleanup.mjs');
const {brandSource}=await import('./branding.mjs');
const {namespaceSource}=await import('./frontend-config.mjs');
const {themeSource}=await import('./mini-theme.mjs');
let themed=false;
function compile(source,filename){const module=new Module(filename);module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));module._compile(esbuild.transformSync(source,{loader:'tsx',format:'cjs',jsx:'transform'}).code,filename);return module.exports;}
const data=file=>'data:image/svg+xml;base64,'+fs.readFileSync(path.join(root,'local/omar',file)).toString('base64');
const originalLoad=Module._load;
Module._load=function(id,parent,...rest){
 if(id==='virtual:omar-wordmark')return compile(fs.readFileSync(path.join(root,'local/omar/wordmark.mjs'),'utf8'),path.join(root,'mini/qa-wordmark.cjs'));
 if(id==='virtual:omar-mini-white-logo')return data('assets/cashier-header-logo-white-tight.svg');
 if(id==='virtual:omar-mini-sidebar-logo')return compile(omarMiniBrandCleanup({workspace:root,app:'mini',mode:'omar'}).load('\0'+id),path.join(root,'mini/qa-logo.cjs'));
 if(id==='./Logo'&&parent.filename.endsWith('/Sidebar.tsx'))return compile(`import React from 'react';import Wordmark from 'virtual:omar-wordmark';export default function Logo({className='w-full h-full'}){return React.createElement('div',{className:className+' omar-logo-slot flex items-center justify-center relative'},React.createElement(Wordmark));}`,path.join(root,'mini/qa-logo.cjs'));
 if(id==='virtual:omar-mini-print-logo')return data('assets/mini-print-logo.svg');
 if(id==='virtual:omar-mini-unavailable-qr')return data('assets/receipt-qr-unavailable.svg');
 return originalLoad.call(this,id,parent,...rest);
};
require.extensions['.svg']=module=>{module.exports=data('wordmark-ink.svg');};
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(module,filename)=>{
 const file=path.relative(root,filename),raw=brandSource(namespaceSource(fs.readFileSync(filename,'utf8')),file),source=themeSource(raw,file)||raw;
 module._compile(esbuild.transformSync(themed?(cleanupSource(source,file)||source):source,{loader:ext==='.tsx'?'tsx':'ts',format:'cjs',jsx:'transform'}).code,filename);
};
global.fetch=()=>{throw Error('Fixture network prohibited');};
const messages=[];
const props={invoiceId:'FICTIONAL-QA',groups:[{customerName:'Fictional QA',barber:'QA Barber',services:[{name:'QA service',price:250}],subtotal:250}],subtotal:250,total:230,discountAmount:20,depositApplied:50,payments:[{method:'CASH',amount:180}],dateStr:'2026-10-28',timeStr:'10:00'};
const deposit={receipt_number:'FICTIONAL-DEPOSIT',amount:50,payment_method:'CASH',payment_method_label:'نقدي',branch_name:'Omar Fahim Salon',customer_name:'Fictional QA',created_at:'2026-10-28T10:00:00Z'};
const output=path.join(root,'.local/omar/brand-cleanup');fs.mkdirSync(output,{recursive:true});
for(const mode of ['before','after']){
 themed=mode==='after';
 const utilityFile=path.join(root,'mini/src/utils/whatsappUtil.ts');delete require.cache[utilityFile];
 messages.push(require(utilityFile).buildInvoiceWhatsAppMessage({...props,branchName:'Omar Fahim Salon'}));
 for(const name of ['ReceiptPrintLayout','AppointmentDepositReceipt','Sidebar']){
  const filename=path.join(root,'mini/components',name+'.tsx');delete require.cache[filename];
  const component=require(filename).default;
  const markup=renderToStaticMarkup(React.createElement(component,name==='ReceiptPrintLayout'?props:name==='Sidebar'?{activePage:'الكاشير',isOpen:true,setActivePage(){},onToggle(){},onLogout(){}}:{receipt:deposit,onClose(){}}));
  fs.writeFileSync(path.join(output,mode+'-'+name+'.html'),markup);
  let preview=markup.replace(/https:\/\/api.qrserver.com[^"]*/g,'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"/>').toString('base64')).replaceAll('@media screen','@media not all').replaceAll('@media print','@media screen');
  const sourceHead=fs.readFileSync(path.join(root,'mini/index.html'),'utf8').split('<head>')[1].split('</head>')[0];
  const css=fs.readFileSync(path.join(root,'.local/omar/frontend-build/mini/assets',fs.readdirSync(path.join(root,'.local/omar/frontend-build/mini/assets')).find(f=>/^index-.*\.css$/.test(f))),'utf8');
  const html='<!doctype html><html lang="ar" dir="rtl" data-omar-mini-theme="foundation"><head>'+sourceHead+'<style>'+fs.readFileSync(path.join(root,'mini/index.css'),'utf8')+'\n'+css+'</style></head><body style="background:#162127;--mini-sidebar-width:280px">'+preview+'</body></html>';
  fs.writeFileSync(path.join(output,`${mode}-${name}-preview.html`),html);
 }
}
const before=fs.readFileSync(path.join(output,'before-ReceiptPrintLayout.html'),'utf8'),after=fs.readFileSync(path.join(output,'after-ReceiptPrintLayout.html'),'utf8');
const normalize=s=>s.replace(/<link rel="preload"[^>]*\/>/g,'').replace(/src="[^"]*"/g,'src="ASSET"').replace(/alt="(?:QR|Salon link unavailable)"/g,'alt="QR"').replaceAll('فرع المنصورة','الفرع').replaceAll('Scan &amp; unlock the full experience','Salon link unavailable');
require('node:assert/strict').equal(normalize(after),normalize(before));
require('node:assert/strict').equal(messages[1].replace('شكرًا لزيارتك Omar Fahim Salon 🤍','شكرًا لزيارتك صالون نادي الرجال السري فرع oct 🤍'),messages[0]);
fs.writeFileSync(path.join(output,'whatsapp-fictional.txt'),messages[1]);
const depositBefore=fs.readFileSync(path.join(output,'before-AppointmentDepositReceipt.html'),'utf8'),depositAfter=fs.readFileSync(path.join(output,'after-AppointmentDepositReceipt.html'),'utf8');
require('node:assert/strict').equal(normalize(depositAfter),normalize(depositBefore));
console.log('Real thermal receipt markup identical outside explicitly authorized brand/QR content; financial cells and print CSS exact.');
})();
