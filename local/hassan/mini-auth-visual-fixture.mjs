// Explicit, offline visual fixtures. Real Login handlers use an isolated mock
// boundary; App auth panels are verbatim JSX, not an instantiated live App.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {authAppPanels,authThemeSource,authAppFile,authLoginFile} from './mini-auth-theme.mjs';
import {loginLayoutSource} from './mini-login-layout.mjs';
import {cashierTightLogoFile} from './cashier-header-logo.mjs';
import {omarBranding} from './branding.mjs';
const workspace=path.resolve(import.meta.dirname,'../..');
export const authFixtureDirectory=path.join(workspace,'.local/hassan/auth-visual-fixture');
export function authFixtureMiddleware(server){
 server.middlewares.use((req,res,next)=>{
  const route=(req.url||'').split('?')[0],files={'/__omar_auth_visual':'index.html','/__omar_auth_visual.js':'fixture.js'};
  if(!files[route])return next();
  if(!['GET','HEAD'].includes(req.method)){res.statusCode=405;return res.end();}
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!fs.existsSync(path.join(authFixtureDirectory,'enabled'))){res.statusCode=404;return res.end();}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src https://fonts.gstatic.com https://cdn.jsdelivr.net data:; img-src data:; connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'");
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',route.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(authFixtureDirectory,files[route])));
 });
}
export async function buildAuthFixture(){
 const require=createRequire(path.join(workspace,'mini/package.json')),esbuild=require('esbuild');fs.mkdirSync(authFixtureDirectory,{recursive:true,mode:0o700});
 const source=fs.readFileSync(path.join(workspace,authAppFile),'utf8'),panels=authAppPanels(authThemeSource(source,authAppFile));
 const panelCode=Object.entries(panels).map(([state,jsx],i)=>`function Panel${i}(){return (${jsx});}`).join('\n');
 const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Login from './components/LoginScreen';import CompactLogin from 'virtual:omar-compact-login-fixture';
 const q=new URLSearchParams(location.search),state=q.get('state')||'login';
 const handleLogout=()=>{throw Error('OFFLINE fixture: session mutation forbidden');};
 document.documentElement.style.setProperty('--mini-shell-height',window.innerHeight+'px');
 ${panelCode}
 const LoginView=q.get('layout')==='compact'?CompactLogin:Login;
 const panels={'bootstrap':Panel0,'device-check':Panel1,'access-denied':Panel2},Panel=panels[state];
 const message=state==='expired'?'انتهت صلاحية الجلسة. سجّل الدخول مرة أخرى.':state==='external-device-error'?'تعذر التحقق من صلاحية هذا الجهاز. سجّل الدخول مرة أخرى.':null;
 createRoot(document.getElementById('root')).render(Panel?<Panel/>:<LoginView onLogin={()=>{throw Error('OFFLINE fixture must never authenticate');}} externalError={message}/>);`;
 const mock=String.raw`const state=new URLSearchParams(location.search).get('state')||'login';
 export const DEVICE_ID='OMAR-OFFLINE-VISUAL-DEVICE';
 export const prepareLoginDeviceProof=async()=>null;
 export const finalizeDeviceEnrollment=async()=>{if(state==='finalization-loading')return new Promise(()=>{});throw Error('OFFLINE fixture: real enrollment forbidden');};
 const scenarios={
 invalid:{message:'بيانات تسجيل الدخول غير صحيحة.',code:'INVALID_CREDENTIALS'},
 enrollment:{message:'Offline enrollment required',code:'DEVICE_ENROLLMENT_REQUIRED',pairing_code:'QA-PAIR-0000',expires_at:'2030-01-01T00:00:00Z',limit_reached:true},
 pending:{message:'Offline approval pending',code:'DEVICE_ENROLLMENT_REQUIRED',pairing_code:'QA-PAIR-0000',expires_at:'2030-01-01T00:00:00Z'},
 finalization:{message:'Offline finalization required',code:'DEVICE_FINALIZATION_REQUIRED',pending_enrollment_id:9001},
 'finalization-loading':{message:'Offline finalization required',code:'DEVICE_FINALIZATION_REQUIRED',pending_enrollment_id:9001},
 'finalization-disabled':{message:'Offline finalization required',code:'DEVICE_FINALIZATION_REQUIRED'},
 'repair-missing':{message:'Offline key missing',code:'DEVICE_PROOF_KEY_MISSING'},
 'repair-mismatch':{message:'Offline key mismatch',code:'DEVICE_PROOF_KEY_MISMATCH'},
 'repair-storage':{message:'Offline proof storage unavailable',code:'DEVICE_PROOF_STORAGE_UNAVAILABLE'},
 repair:{message:'Offline proof repair required',code:'DEVICE_PROOF_REPAIR_REQUIRED'},
 unauthorized:{message:'Unauthorized Device',code:'DEVICE_NOT_AUTHORIZED'},
 generic:{message:'خطأ مصادقة تجريبي — لا يوجد اتصال بخادم.',code:'OFFLINE_AUTH_ERROR'}
 };
 const denied=async()=>{throw Error('OFFLINE fixture: mutation/read forbidden');};
 export const apiClient={get:denied,put:denied,patch:denied,delete:denied,post:async(url,body)=>{
 if(url!=='/auth/login'||body.email!=='visual.qa.invalid'||body.password!=='fictional-only')throw Error('Unreviewed fixture action');
 if(state==='loading')return new Promise(()=>{});
 const scenario=scenarios[state];if(!scenario)throw Error('Unreviewed fixture state');
 throw Object.assign(new Error(scenario.message),scenario);
 }};`;
 const result=await esbuild.build({stdin:{contents:entry,resolveDir:path.join(workspace,'mini'),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',loader:{'.svg':'dataurl'},nodePaths:[path.join(workspace,'mini/node_modules')],define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'offline-auth-boundary',setup(build){
  build.onResolve({filter:/\/api\/client$/},()=>({path:'offline-auth-api',namespace:'fixture'}));
  build.onResolve({filter:/^virtual:omar-compact-login-fixture$/},()=>({path:path.join(workspace,authLoginFile),namespace:'compact-login'}));
  build.onResolve({filter:/^virtual:omar-login-white-logo$/},()=>({path:path.join(workspace,cashierTightLogoFile)}));
  build.onLoad({filter:/.*/,namespace:'compact-login'},args=>({contents:loginLayoutSource(authThemeSource(fs.readFileSync(args.path,'utf8'),authLoginFile),authLoginFile).replace('<form onSubmit=', '<form autoComplete="off" onSubmit=').replaceAll('<input\n','<input autoComplete="new-password"\n'),loader:'tsx',resolveDir:path.dirname(args.path)}));
  build.onResolve({filter:/^virtual:omar-wordmark$/},()=>({path:path.join(workspace,'local/omar/wordmark.mjs')}));
  build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js'}));
  build.onLoad({filter:/\.tsx$/},args=>{const relative=path.relative(workspace,args.path).split(path.sep).join('/');
   if(relative===authLoginFile){
    // Fixture-only autocomplete hints prevent Chrome importing saved logins.
    // UI handlers/classes/structure remain the actual component in both variants.
    const code=authThemeSource(fs.readFileSync(args.path,'utf8'),relative).replace('<form onSubmit=', '<form autoComplete="off" onSubmit=').replaceAll('<input\n', '<input autoComplete="new-password"\n');
    return {contents:code,loader:'tsx'};
   }
   if(relative==='mini/components/Logo.tsx')return {contents:omarBranding(workspace,'mini').transform(fs.readFileSync(args.path,'utf8'),args.path).code,loader:'tsx'};
  });
 }}]});
 fs.writeFileSync(path.join(authFixtureDirectory,'fixture.js'),result.outputFiles[0].contents);
 const head=fs.readFileSync(path.join(workspace,'mini/index.html'),'utf8').split('<head>')[1].split('</head>')[0].replace(/<title>.*?<\/title>/s,'<title>Omar auth OFFLINE visual fixture</title>');
 const theme=fs.readFileSync(path.join(workspace,'local/omar/mini-theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(workspace,'local/omar/mini-auth-theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(workspace,'local/omar/mini-login-layout.css'),'utf8');
 fs.writeFileSync(path.join(authFixtureDirectory,'index.html'),'<!DOCTYPE html><html lang="ar" dir="rtl"><head>'+head+'<style>'+fs.readFileSync(path.join(workspace,'mini/index.css'),'utf8')+'</style><script>if(new URLSearchParams(location.search).get("theme")==="1")document.documentElement.setAttribute("data-omar-mini-theme","foundation")</script><style>'+theme+'</style></head><body><div id="root"></div><script src="/__omar_auth_visual.js"></script></body></html>');
 fs.writeFileSync(path.join(authFixtureDirectory,'enabled'),'Explicit offline visual QA only\n',{mode:0o600});
}
if(process.argv[1]===import.meta.filename)await buildAuthFixture();
