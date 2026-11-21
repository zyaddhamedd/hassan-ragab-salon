// Explicit offline visual QA fixture, never imported by the application bundle.
// Actual inventory components; mock boundary rejects every mutation and unknown GET.
import fs from 'node:fs';import path from 'node:path';import {createRequire}from 'node:module';
import {inventoryThemeSource,inventoryFiles}from './mini-inventory-theme.mjs';
const workspace=path.resolve(import.meta.dirname,'../..');
export const fixtureDirectory=path.join(workspace,'.local/hassan/inventory-visual-fixture');
export function inventoryFixtureMiddleware(server){
 server.middlewares.use((req,res,next)=>{
  const pathname=(req.url||'').split('?')[0];const files={'/__omar_inventory_visual':'index.html','/__omar_inventory_visual.js':'fixture.js'};
  if(!files[pathname])return next();
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;return res.end();}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!fs.existsSync(path.join(fixtureDirectory,'enabled'))) {res.statusCode=404;return res.end();}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net data:; img-src data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'");
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(fixtureDirectory,files[pathname])));
 });
}
export async function buildInventoryFixture(){
 const require=createRequire(path.join(workspace,'mini/package.json'));const esbuild=require('esbuild');fs.mkdirSync(fixtureDirectory,{recursive:true,mode:0o700});
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Mobile from './components/InventoryOnlyApp';import Desktop from './components/BranchInventoryScreen';
 const q=new URLSearchParams(location.search);document.documentElement.style.setProperty('--mini-shell-height',window.innerHeight+'px');
 const cashier={id:9001,name:'Visual QA',branchId:9001,branchName:'Omar Visual Fixture',branch_id:9001,branch_name:'Omar Visual Fixture'};
 createRoot(document.getElementById('root')).render(q.get('screen')==='desktop'?<Desktop cashier={cashier}/>:<Mobile cashier={cashier} deviceContext={{access_mode:'INVENTORY_ONLY',branch_id:9001,branch_name:'Omar Visual Fixture'}} onLogout={()=>{}}/>);`;
 const mock=String.raw`const q=new URLSearchParams(location.search);const empty=q.get('state')==='empty';
 const products=['AVAILABLE','LOW','OUT','UNKNOWN'].map((status,i)=>({id:i+1,product_id:i+1,name:['شامبو — بيانات عرض','كريم تصفيف — بيانات عرض','زيت — نفد','منتج غير مؤكد'][i],category:'عناية — fixture',unit:'قطعة',selling_price:100,stock_quantity:[24,2,0,0][i],min_stock_threshold:5,status,image_url:null,nearest_expiration:'2026-11-15',nearest_expiration_days:18,latest_received_at:'2026-10-20T12:00:00Z'}));
 const branch={id:9001,name:'Omar Visual Fixture'};
 const items=[{id:1,product_id:1,product_name:products[0].name,quantity:6,requested_quantity:6,final_quantity:6,unit:'قطعة',image_url:null}];
 const shipment={id:1,shipment_ref:'VISUAL-001',status:'IN_TRANSIT',created_at:'2026-10-20T12:00:00Z',received_at:'2026-10-21T12:00:00Z',source_branch_name:'Main Warehouse — fixture',destination_branch_id:9001,destination_branch_name:branch.name,items_count:1,total_quantity:6,items_preview:items,items,note:'Offline visual fixture'};
 const supply={id:1,request_ref:'VISUAL-REQ-001',branch_id:9001,status:'PENDING',created_at:shipment.created_at,created_by_employee_id:9001,created_by_employee_name:'Visual QA',items_count:1,total_requested_quantity:6,items};
 const ret={id:1,return_ref:'VISUAL-RET-001',branch_id:9001,product_id:1,product_name:products[0].name,product_unit:'قطعة',requested_quantity:1,branch_stock_snapshot:24,reason:'DAMAGED',reason_label:'تالف',status:'PENDING',created_at:shipment.created_at,updated_at:shipment.created_at,created_by_employee_id:9001,created_by_employee_name:'Visual QA'};
 const page=items=>({items,page:1,per_page:10,total:items.length,total_pages:1,has_more:false});
 export const BACKEND_URL='';const denied=async()=>{throw Error('OFFLINE FIXTURE: mutations forbidden')};
 export const apiClient={post:denied,put:denied,patch:denied,delete:denied,get:async(url)=>{
 const p=url.split('?')[0];if(q.get('state')==='loading')return new Promise(()=>{});if(q.get('state')==='error')throw Error('Offline visual error state');
 if(p==='/inventory')return {branch,products:empty?[]:products,recent_activity:[]};
 if(p==='/inventory/summary')return {active_supply_requests:empty?0:1,pending_supply_requests:empty?0:1,pending_returns:empty?0:1};
 if(p==='/shipments/incoming')return empty?[]:[shipment];
 if(p==='/shipments/history')return {shipments:empty?[]:[{...shipment,status:'RECEIVED'}],pagination:{page:1,has_next:false,total:empty?0:1}};
 if(/^\/shipments\/\d+$/.test(p))return shipment;
 if(p==='/supply-requests')return page(empty?[]:[supply]);if(/^\/supply-requests\/\d+$/.test(p))return supply;
 if(p==='/returns')return page(empty?[]:[ret]);if(/^\/returns\/\d+$/.test(p))return ret;
 if(p==='/products/search')return products;
 if(/^\/inventory\/products\/\d+\/details$/.test(p)){const product=products[Number(p.split('/')[3])-1]||products[0];return {product,total_stock:product.stock_quantity,nearest_expiration:product.nearest_expiration,latest_received_at:product.latest_received_at,batches:['HEALTHY','EXPIRING_SOON','EXPIRED','NO_EXPIRY'].map((status,i)=>({batch_id:i+1,batch_number:'VISUAL-'+(i+1),remaining_quantity:6,expiration_date:'2026-11-15',days_remaining:18,status}))};}
 if(p.includes('activity'))return {items:[],pagination:{page:1,has_next:false},summary:{}};
 throw Error('Unreviewed fixture GET: '+p);
 }};`;
 const result=await esbuild.build({stdin:{contents:entry,resolveDir:path.join(workspace,'mini'),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"development"'},loader:{'.png':'dataurl','.svg':'dataurl','.jpg':'dataurl'},plugins:[{name:'offline-inventory-boundary',setup(build){build.onResolve({filter:/\/api\/client$/},()=>({path:'offline-api',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js'}));build.onLoad({filter:/\.tsx$/},args=>{const file=path.relative(workspace,args.path).split(path.sep).join('/');if(!inventoryFiles.includes(file))return;const source=fs.readFileSync(args.path,'utf8');return {contents:inventoryThemeSource(source,file)||source,loader:'tsx'};});}}]});
 fs.writeFileSync(path.join(fixtureDirectory,'fixture.js'),result.outputFiles[0].contents);
 const head=fs.readFileSync(path.join(workspace,'mini/index.html'),'utf8').split('<head>')[1].split('</head>')[0].replace(/<title>.*?<\/title>/s,'<title>Omar inventory OFFLINE visual fixture</title>');
 const theme=fs.readFileSync(path.join(workspace,'local/omar/mini-theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(workspace,'local/omar/mini-inventory-theme.css'),'utf8');
 fs.writeFileSync(path.join(fixtureDirectory,'index.html'),'<!DOCTYPE html><html lang="ar" dir="rtl"><head>'+head+'<style>'+fs.readFileSync(path.join(workspace,'mini/index.css'),'utf8')+'</style><script>if(new URLSearchParams(location.search).get("theme")==="1")document.documentElement.setAttribute("data-omar-mini-theme","foundation")</script><style>'+theme+'</style></head><body><div id="root"></div><script src="/__omar_inventory_visual.js"></script></body></html>');
 fs.writeFileSync(path.join(fixtureDirectory,'enabled'),'Offline visual QA only\n',{mode:0o600});
}
if(process.argv[1]===import.meta.filename)await buildInventoryFixture();
