// Real components, fictional data, denied network/mutations. Explicit offline QA only.
import fs from 'node:fs';import path from 'node:path';import{createRequire}from'node:module';
import{buildAuthFixture,authFixtureDirectory}from'./mini-auth-visual-fixture.mjs';
import{buildInventoryFixture,fixtureDirectory}from'./mini-inventory-visual-fixture.mjs';
import{operationalThemeSource}from'./mini-operational-theme.mjs';
const workspace=path.resolve(import.meta.dirname,'../..');
export const qualityDirectory=path.join(workspace,'.local/hassan/quality-visual');
export function qualityFixtureMiddleware(server){server.middlewares.use((req,res,next)=>{
 const name=(req.url||'').split('?')[0].replace(/^\/__omar_quality\//,'');
 if(!['attendance','auth','inventory','attendance.js','auth.js','inventory.js','contrast.css'].includes(name)||!req.url.startsWith('/__omar_quality/'))return next();
 if(!['GET','HEAD'].includes(req.method)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!fs.existsSync(path.join(qualityDirectory,'enabled'))){res.statusCode=404;return res.end();}
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net data:; img-src data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'");
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
 res.end(fs.readFileSync(path.join(qualityDirectory,name.includes('.')?name:name+'.html')));
});}
export async function buildQualityFixture(){
 fs.mkdirSync(qualityDirectory,{recursive:true,mode:0o700});
 try{await buildAuthFixture();await buildInventoryFixture();}finally{for(const dir of [authFixtureDirectory,fixtureDirectory])fs.rmSync(path.join(dir,'enabled'),{force:true});}
 const inject=html=>html.replace('</head>',`<script>if(new URLSearchParams(location.search).get('quality')==='1'){const link=document.createElement('link');link.rel='stylesheet';link.href='/__omar_quality/contrast.css';document.head.append(link);}</script></head>`);
 for(const [name,dir,route]of [['auth',authFixtureDirectory,'/__omar_auth_visual.js'],['inventory',fixtureDirectory,'/__omar_inventory_visual.js']]){
 fs.copyFileSync(path.join(dir,'fixture.js'),path.join(qualityDirectory,name+'.js'));
 fs.writeFileSync(path.join(qualityDirectory,name+'.html'),inject(fs.readFileSync(path.join(dir,'index.html'),'utf8').replace(route,'/__omar_quality/'+name+'.js')));
 }
 const require=createRequire(path.join(workspace,'mini/package.json')),esbuild=require('esbuild');
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Attendance from './components/AttendanceScreen';
 const staff=[{id:1,name:'Fictional Present',role:'حلاق',isPresent:true,avatar:''},{id:2,name:'Fictional Absent',role:'حلاق',isPresent:false,avatar:''},{id:3,name:'Fictional Assistant',role:'مساعد',isPresent:true,avatar:''}];
 createRoot(document.getElementById('root')).render(<div data-omar-mini-shell="foundation"><Attendance staff={staff} cashier={{branchName:'Omar Offline QA'}} onToggleAttendance={async()=>{throw Error('Attendance writes forbidden in fixture');}}/></div>);`;
 const result=await esbuild.build({stdin:{contents:entry,resolveDir:path.join(workspace,'mini'),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'quality-boundary',setup(build){build.onResolve({filter:/\/api\/client$/},()=>({path:'offline',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:"export const BACKEND_URL='';",loader:'js'}));build.onLoad({filter:/AttendanceScreen\.tsx$/},args=>({contents:operationalThemeSource(fs.readFileSync(args.path,'utf8'),'mini/components/AttendanceScreen.tsx'),loader:'tsx'}));}}]});
 fs.writeFileSync(path.join(qualityDirectory,'attendance.js'),result.outputFiles[0].contents);
 const head=fs.readFileSync(path.join(workspace,'mini/index.html'),'utf8').split('<head>')[1].split('</head>')[0];
 const styles=['mini/index.css','local/omar/mini-theme.css','local/omar/mini-operational-theme.css'].map(f=>fs.readFileSync(path.join(workspace,f),'utf8')).join('\n');
 fs.writeFileSync(path.join(qualityDirectory,'attendance.html'),inject('<!doctype html><html lang="ar" dir="rtl" data-omar-mini-theme="foundation"><head>'+head+'<style>'+styles+'</style></head><body><div id="root"></div><script src="/__omar_quality/attendance.js"></script></body></html>'));
 fs.copyFileSync(path.join(workspace,'local/omar/mini-text-contrast.css'),path.join(qualityDirectory,'contrast.css'));
 fs.writeFileSync(path.join(qualityDirectory,'enabled'),'Explicit offline QA\n',{mode:0o600});
}
if(process.argv[1]===import.meta.filename)await buildQualityFixture();
