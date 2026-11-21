// Exact owner-supplied mobile test origin. No wildcard hosts or backend exposure.
import path from 'node:path';
export const adminMobileOrigin='https://z32jt2kl-3100.eun1.devtunnels.ms';
export function enableAdminMobile(config,{workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))throw Error('Mobile test setup is Omar Admin only');
 const originPlugin=config.plugins.find(p=>p?.name==='omar-local-isolation');
 if(!originPlugin||config.server.host!=='127.0.0.1'||config.server.port!==3100)throw Error('Unexpected Omar Admin server contract');
 const oldLoad=originPlugin.load;
 originPlugin.load=function(id){
  const result=oldLoad.call(this,id);
  if(id!=='\0omar-origin')return result;
  if(!result.includes('http://127.0.0.1:3100'))throw Error('Admin origin guard drift');
  return `if(!${JSON.stringify(['http://127.0.0.1:3100',adminMobileOrigin])}.includes(window.location.origin)) throw new Error('Wrong Omar frontend origin');`;
 };
 config.define['import.meta.env.VITE_API_URL']='window.location.origin';
 const policy=`connect-src 'self' http://127.0.0.1:5104 ws://127.0.0.1:3100 wss://${new URL(adminMobileOrigin).host}; form-action 'self'; base-uri 'self'; object-src 'none'`;
 config.server.headers['Content-Security-Policy']=policy;
 const originalHTML=originPlugin.transformIndexHtml.handler;
 originPlugin.transformIndexHtml.handler=function(...args){return originalHTML.apply(this,args).map(tag=>tag.attrs?.['http-equiv']==='Content-Security-Policy'?{...tag,attrs:{...tag.attrs,content:policy}}:tag);};
 config.server.allowedHosts=[new URL(adminMobileOrigin).hostname];
 // Let Vite derive ws/wss, host and port from the actual page URL.
 config.server.hmr={};
 // Restrict public dev-server file access to presentation inputs only.
 config.server.fs={strict:true,allow:['admin','mini','local/omar'].map(p=>path.join(workspace,p)),deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.local/**','**/backend/**']};
 return config;
}
