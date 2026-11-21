import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {brandCaptions,brandSource,omarBranding} from './branding.mjs';
const root=path.resolve(import.meta.dirname,'../..');
test('every reviewed visible brand caption is replaced only in Omar overlay',()=>{
 for(const [relative,captions] of Object.entries(brandCaptions)){
  const source=fs.readFileSync(path.join(root,relative),'utf8');const result=brandSource(source,relative);
  for(const caption of captions){assert.ok(source.includes(caption));assert.ok(!result.includes(caption));}
  assert.ok(result.includes('OMAR FAHIM SALON')||result.includes('<OmarWordmark compact />'));
  assert.equal(brandSource(source,'unrelated.tsx'),source);
 }
});
test('caption drift fails closed; receipt formulas, links and WhatsApp source remain intact',()=>{
 assert.throws(()=>brandSource('missing','admin/components/Header.tsx'),/drift/);
 for(const file of ['mini/components/Receipt.tsx','mini/components/AppointmentDepositReceipt.tsx','mini/src/utils/whatsappUtil.ts']){
  const source=fs.readFileSync(path.join(root,file),'utf8');assert.equal(brandSource(source,file),source);
 }
 const file='mini/components/ReceiptPrintLayout.tsx',source=fs.readFileSync(path.join(root,file),'utf8');
 assert.equal(brandSource(source,file).replaceAll('OMAR FAHIM SALON',"The Secret Men's Club Experience"),source);
});
test('only approved receipt logo asset is selected, preserving its viewBox',()=>{
 const plugin=omarBranding(root,'mini','/unused/react.js');
 assert.equal(plugin.resolveId('../src/assets/llooggo.svg',path.join(root,'mini/components/Receipt.tsx')),path.join(root,'local/omar/wordmark-ink.svg'));
 assert.equal(plugin.resolveId('../assets/unrelated.svg',path.join(root,'admin/components/Logo.tsx')),undefined);
 for(const f of ['mini/src/assets/llooggo.svg','local/omar/wordmark-ink.svg'])assert.match(fs.readFileSync(path.join(root,f),'utf8'),/viewBox="0 0 2050(?:\.000000)? 1208(?:\.000000)?"/);
});

test('virtual component keeps a bare React import for both dev optimization and builds',()=>{
 const plugin=omarBranding(root,'admin');
 const code=plugin.load('\0omar-wordmark');
 assert.match(code,/import React from 'react'/);
 assert.ok(!code.includes('/node_modules/react/index.js'));
 for(const name of ['admin/components/Logo.tsx','mini/components/Logo.tsx']){
  const original=fs.readFileSync(path.join(root,name),'utf8');
  assert.ok(original.includes('.svg'));
  const replacement=plugin.transform(original,path.join(root,name)).code;
  assert.ok(replacement.includes('virtual:omar-wordmark'));assert.ok(!replacement.includes('.svg'));
 }
});
