// Explicit local launcher. Never loads the original application Vite configuration.
import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {workspace, contract, omarConfig} from './frontend-config.mjs';
const args=process.argv.slice(2);
const app=args[0];
if(args.length!==1||!['admin','mini'].includes(app))throw new Error('Usage: node local/omar/frontend-dev.mjs <admin|mini>');
if(fs.realpathSync(process.cwd())!==workspace)throw new Error('Run from the Omar workspace');
const branch=spawnSync('git',['branch','--show-current'],{encoding:'utf8'});
if(branch.status!==0||branch.stdout.trim()!=='feat/omar-fahim-setup')throw new Error('Wrong Omar branch');
await omarConfig(app,{mode:'omar'}); // Enforces reviewed contract, source inventory and isolated env path.
const port=contract[app].port;
const listener=spawnSync('/usr/sbin/lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'});
if(listener.status!==1||listener.stdout||listener.stderr)throw new Error('Omar port is occupied or ownership is uncertain; stop without touching other processes');
const child=spawn(process.execPath,[path.join(workspace,app,'node_modules/vite/bin/vite.js'),
  '--config',path.join(workspace,`local/omar/${app}.vite.config.mjs`),'--mode','omar',
  '--host','127.0.0.1','--port',String(port),'--strictPort'],{
  cwd:path.join(workspace,app),stdio:'inherit',
  env:{PATH:'/opt/homebrew/bin:/usr/bin:/bin',HOME:process.env.HOME,LANG:'en_US.UTF-8'},
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(child.exitCode===null)child.kill(signal);});
child.on('error',()=>{console.error('Omar Vite child could not start');process.exit(1);});
child.on('exit',(code,signal)=>process.exit(code??(signal==='SIGINT'?0:1)));
