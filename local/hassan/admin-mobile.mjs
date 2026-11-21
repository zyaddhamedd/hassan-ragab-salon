// Exact owner-supplied mobile test origin. No wildcard hosts or backend exposure.
import path from 'node:path';
import {contract} from './frontend-config.mjs';
export const adminMobileOrigin='http://127.0.0.1:3200';
export function enableAdminMobile(config,{workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))throw Error('Mobile test setup is Hassan Admin only');
 const originPlugin=config.plugins.find(p=>['hassan-local-isolation', 'omar-local-isolation'].includes(p?.name));
 if(!originPlugin||config.server.host!=='127.0.0.1'||config.server.port!==contract.admin.port)throw Error('Unexpected Hassan Admin server contract');
 const oldLoad=originPlugin.load;
 originPlugin.load=function(id){
  const result=oldLoad.call(this,id);
  if(!['\0hassan-origin', '\0omar-origin'].includes(id))return result;
  return `if(!${JSON.stringify([contract.admin.origin])}.includes(window.location.origin)) throw new Error('Wrong Hassan frontend origin');`;
 };
 const policy=`connect-src 'self' ${contract.backend} ws://127.0.0.1:${contract.admin.port}; form-action 'self'; base-uri 'self'; object-src 'none'`;
 config.server.headers['Content-Security-Policy']=policy;
 const originalHTML=originPlugin.transformIndexHtml.handler;
 originPlugin.transformIndexHtml.handler=function(...args){return originalHTML.apply(this,args).map(tag=>tag.attrs?.['http-equiv']==='Content-Security-Policy'?{...tag,attrs:{...tag.attrs,content:policy}}:tag);};
 // Restrict public dev-server file access to presentation inputs only.
 config.server.fs={strict:true,allow:['admin','mini','local/hassan'].map(p=>path.join(workspace,p)),deny:['.env','.env.*','*.{crt,pem}','**/.git/**','**/.local/**','**/backend/**']};
 return config;
}
