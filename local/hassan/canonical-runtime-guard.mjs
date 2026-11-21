// Standalone integrity baseline: no Git history, remote, or commit lookup.
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
export function assertCanonicalRuntimeUnchanged(workspace,extra=[]){
 const baseline=JSON.parse(fs.readFileSync(path.join(workspace,'local/omar/standalone-source-baseline.json'),'utf8'));
 for(const[file,hash]of Object.entries(baseline)){assert.equal(createHash('sha256').update(fs.readFileSync(path.join(workspace,file))).digest('hex'),hash,'Standalone source drift: '+file);}
 return '';
}
