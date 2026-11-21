// Explicit opt-in, fictional shell fixture. Real Header/SideNav/BottomNav and App shell JSX.
import fs from'node:fs';import path from'node:path';import{createRequire}from'node:module';
import{adminThemeSource}from'./admin-theme.mjs';import{omarBranding}from'./branding.mjs';
const workspace=path.resolve(import.meta.dirname,'../..');export const adminShellEvidence=path.join(workspace,'.local/hassan/admin-shell-visual');
export function adminShellFixtureMiddleware(server){server.middlewares.use((req,res,next)=>{
 const files={'/__omar_admin_shell':'index.html','/__omar_admin_shell.js':'fixture.js'};const file=files[(req.url||'').split('?')[0]];if(!file)return next();
 if(!['GET','HEAD'].includes(req.method)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!fs.existsSync(path.join(adminShellEvidence,'enabled'))){res.statusCode=404;return res.end();}
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'");res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(adminShellEvidence,file)));
});}
export async function buildAdminShellFixture(){
 fs.mkdirSync(adminShellEvidence,{recursive:true,mode:0o700});
 const require=createRequire(path.join(workspace,'admin/package.json')),esbuild=require('esbuild');
 const app=fs.readFileSync(path.join(workspace,'admin/App.tsx'),'utf8');const start=app.lastIndexOf('\n  return (\n    <div className={`min-h-screen');if(start<0)throw Error('App fixture shell drift');const shell=app.slice(start,app.lastIndexOf('\n};'));
 const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{CheckCircle2}from'lucide-react';import SideNav from'./components/SideNav';import Header from'./components/Header';import BottomNav from'./components/BottomNav';
 const q=new URLSearchParams(location.search);function Fixture(){const[isDarkMode,setIsDarkMode]=useState(q.get('mode')!=='light');const[isSidebarOpen,setIsSidebarOpen]=useState(false);const[effectiveActiveTab,setActiveTab]=useState('dashboard');const[selectedBranch,setSelectedBranch]=useState('All');const currentUser={role:'SUPER_ADMIN'},isStoreManager=false,showBranchToast=false,pageTitles={dashboard:'لوحة التحكم',services:'الخدمات'},branchLabels={All:'كل الفروع'},appLayoutStyle={'--app-sidebar-offset':'72px'};
 const handleNavigate=id=>{setActiveTab(id);setIsSidebarOpen(false);};const handleLogout=()=>{throw Error('Offline fixture: logout forbidden');};const supplyNavigation={updateLocation(){}};
 const renderContent=()=> <div className="admin-page-shell"><section data-protected-fixture style={{background:'#111111',color:'#E53935',border:'1px solid rgba(255,255,255,.07)',padding:20,borderRadius:28}}><h2>Protected dashboard/chart/receipt sentinel — fictional</h2><svg width="140" height="50"><defs><linearGradient id="protected"><stop stopColor="#E53935" stopOpacity="0.3"/><stop offset="100%" stopColor="#E53935" stopOpacity="0"/></linearGradient></defs><rect width="140" height="50" fill="url(#protected)"/></svg><span>250 EGP • Fictional</span></section><div style={{height:1400}}>Offline scrolling area</div></div>;
 ${shell}
 }
 createRoot(document.getElementById('root')).render(<Fixture/>);`;
 const result=await esbuild.build({stdin:{contents:adminThemeSource(entry,'admin/App.tsx'),resolveDir:path.join(workspace,'admin'),loader:'tsx',sourcefile:'shell-fixture.tsx'},bundle:true,write:false,nodePaths:[path.join(workspace,'admin/node_modules')],format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'offline-admin-shell',setup(build){
 build.onResolve({filter:/\/api\/auth$/},()=>({path:'auth',namespace:'fixture'}));build.onResolve({filter:/\/api\/client$/},()=>({path:'api',namespace:'fixture'}));
 build.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='auth'?"export const getCurrentUser=()=>({role:'SUPER_ADMIN',full_name:'Omar Fictional QA'});":"export default {get:async p=>{if(p!=='/branches')throw Error('Unreviewed read');return {data:[{id:9001,name:'Omar Fictional Branch',city:'Giza'}]};},post:()=>{throw Error('Writes forbidden');}};"}));
 build.onResolve({filter:/^virtual:omar-wordmark$/},()=>({path:path.join(workspace,'local/omar/wordmark.mjs')}));
 build.onLoad({filter:/\.tsx$/},args=>{const file=path.relative(workspace,args.path).split(path.sep).join('/');let source=fs.readFileSync(args.path,'utf8');const branded=omarBranding(workspace,'admin').transform(source,args.path);source=branded?.code||source;return{loader:'tsx',contents:adminThemeSource(source,file)||source};});
 }}]});
 fs.writeFileSync(path.join(adminShellEvidence,'fixture.js'),result.outputFiles[0].contents);
 const html=fs.readFileSync(path.join(workspace,'admin/index.html'),'utf8');const head=html.split('<head>')[1].split('</head>')[0];const brand=omarBranding(workspace,'admin').transformIndexHtml.handler(html).tags.map(t=>t.children).join('\n');
 fs.writeFileSync(path.join(adminShellEvidence,'index.html'),'<!doctype html><html lang="ar" dir="rtl"><head>'+head+'<style>'+fs.readFileSync(path.join(workspace,'admin/index.css'),'utf8')+'\n'+brand+'\n'+fs.readFileSync(path.join(workspace,'local/omar/admin-theme.css'),'utf8')+'</style><script>if(new URLSearchParams(location.search).get("theme")==="1")document.documentElement.setAttribute("data-omar-admin-theme","foundation")</script></head><body><div id="root"></div><script src="/__omar_admin_shell.js"></script></body></html>');
 fs.writeFileSync(path.join(adminShellEvidence,'enabled'),'Explicit fictional shell QA\n',{mode:0o600});
}
if(process.argv[1]===import.meta.filename)await buildAdminShellFixture();
