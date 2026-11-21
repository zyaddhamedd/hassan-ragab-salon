// Narrow source-drift gate for the existing Omar literal transform, not a rewriter.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export function isolationSignature(source) {
  const lines=source.split(/\r?\n/).map(line=>line.trim()).filter(line=>
    /\b(localStorage|sessionStorage|indexedDB)\b|import\.meta\.env|https?:\/\/(?!www\.w3\.org)|\b(?:const|let|var)\s+\w*(?:KEY|Key|DATABASE_NAME)\b/.test(line));
  return lines.length ? createHash('sha256').update(lines.join('\n')).digest('hex') : null;
}

export function collectIsolationInventory(workspace) {
  const inventory={};
  function walk(directory) {
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      if(entry.name==='node_modules'||entry.name==='dist')continue;
      const filename=path.join(directory,entry.name);
      if(entry.isDirectory())walk(filename);
      else if(/\.(?:[cm]?[jt]sx?|html)$/.test(entry.name)){
        const signature=isolationSignature(fs.readFileSync(filename,'utf8'));
        if(signature)inventory[path.relative(workspace,filename).split(path.sep).join('/')]=signature;
      }
    }
  }
  for(const app of ['admin','mini'])walk(path.join(workspace,app));
  return Object.fromEntries(Object.entries(inventory).sort(([a],[b])=>a.localeCompare(b)));
}

export function assertIsolationSource(source, relativePath, reviewed) {
  if(isolationSignature(source)!==(reviewed[relativePath]??null)) {
    throw new Error(`Omar isolation source drift: ${relativePath}; review storage keys, env/URL references and expected patterns before updating the inventory`);
  }
}

export function assertIsolationInventory(actual, reviewed) {
  const keys=new Set([...Object.keys(actual),...Object.keys(reviewed)]);
  for(const key of keys) if(actual[key]!==reviewed[key]) throw new Error(`Omar isolation inventory drift: ${key}`);
}
