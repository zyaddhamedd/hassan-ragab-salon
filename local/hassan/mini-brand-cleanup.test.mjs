import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {cleanupSource,omarMiniBrandCleanup} from './mini-brand-cleanup.mjs';
import {brandSource} from './branding.mjs';
import {namespaceSource} from './frontend-config.mjs';
const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
function before(file){return brandSource(namespaceSource(read(file),file),file);}
test('Mini-only explicit activation; Admin and default excluded',()=>{
 assert.equal(omarMiniBrandCleanup({workspace:root,app:'admin',mode:'omar'}),null);
 assert.equal(omarMiniBrandCleanup({workspace:root,app:'mini',mode:'production'}),null);
 assert.equal(cleanupSource('untouched','admin/components/Receipt.tsx'),null);
});
test('WhatsApp changes exactly one thank-you caption, no values or URL behavior',()=>{
 const file='mini/src/utils/whatsappUtil.ts',source=read(file),result=cleanupSource(source,file);
 assert.equal(result.replace('شكرًا لزيارتك Omar Fahim Salon 🤍','شكرًا لزيارتك صالون نادي الرجال السري فرع oct 🤍'),source);
});
test('receipts preserve classes/geometry; local non-QR placeholder and Mini-only logo',()=>{
 for(const file of ['mini/components/Receipt.tsx','mini/components/ReceiptPrintLayout.tsx']){
 const source=before(file),result=cleanupSource(source,file);
 assert.ok(result.includes('src={omarUnavailableQR}'));assert.ok(!result.includes('qrserver.com'));
 assert.deepEqual(result.match(/className="[^"]*"/g),source.match(/className="[^"]*"/g));
 assert.ok(result.includes('virtual:omar-mini-print-logo'));
 if(file.includes('PrintLayout')){assert.ok(!result.includes('فرع المنصورة'));assert.ok(result.includes("branchName || 'الفرع'"));}
 }
});
test('source drift fails closed',()=>{assert.throws(()=>cleanupSource('changed','mini/src/utils/whatsappUtil.ts'),/drift/);});
test('logo derivation keeps exact alpha source and print intrinsic ratio',()=>{
 const white=read('local/omar/assets/cashier-header-logo-white-tight.svg');
 const ink=read('local/omar/assets/mini-print-logo.svg');
 assert.equal(ink,white.replace('fill="#FFFFFF"','fill="#121212"').replace('width="1435" height="844" viewBox="193 25 1435 844"','width="2050" height="1208" viewBox="193 25 1435 844"'));
 assert.equal(read('local/omar/assets/mini-favicon.svg'),white);
});
test('footer is simple brand label; Sidebar and Waiting replacement preserves source outside import',()=>{
 const file='mini/components/CashierScreen.tsx';assert.ok(cleanupSource(before(file),file).includes('Omar Fahim Salon'));
 for(const file of ['mini/components/Sidebar.tsx','mini/components/WaitingScreen.tsx']){
 const source=read(file),result=cleanupSource(source,file);
 assert.equal(result.split('\n').length,source.split('\n').length);
 assert.equal(result.replace(/import Logo from 'virtual:[^']+';/,"import Logo from './Logo';"),source);
 }
});
