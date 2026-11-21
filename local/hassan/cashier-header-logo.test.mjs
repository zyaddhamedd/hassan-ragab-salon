import {assertCanonicalRuntimeUnchanged} from './canonical-runtime-guard.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash}from 'node:crypto';import {execFileSync}from 'node:child_process';import {createRequire}from 'node:module';
import {cashierLogoFile,cashierWhiteLogoFile,cashierTightLogoFile,tightWhiteLogoSVG,tightLogoBounds,whiteLogoSVG,cashierLogoSHA256,cashierLogoCSS,originalCashierBrand,omarCashierBrand,cashierHeaderLogoSource,omarCashierHeaderLogo}from './cashier-header-logo.mjs';
import miniConfig from './mini.vite.config.mjs';import adminConfig from './admin.vite.config.mjs';
const workspace=path.resolve(import.meta.dirname,'../..'),read=f=>fs.readFileSync(path.join(workspace,f),'utf8');
test('exact discovered PNG bytes, format, alpha channel and dimensions are preserved',()=>{
 const bytes=fs.readFileSync(path.join(workspace,cashierLogoFile));assert.equal(createHash('sha256').update(bytes).digest('hex'),cashierLogoSHA256);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),1792);assert.equal(bytes.readUInt32BE(20),878);assert.equal(bytes[24],8);assert.equal(bytes[25],6);
});
test('header replacement preserves all original nodes/expressions and rejects source drift',()=>{
 const source=read('mini/components/CashierScreen.tsx'),result=cashierHeaderLogoSource(source,'mini/components/CashierScreen.tsx');
 assert.equal(result.replace("import omarCashierHeaderLogoURL from 'virtual:omar-cashier-header-logo';\n",'').replace(omarCashierBrand,originalCashierBrand),source);
 assert.ok(result.includes('object-fit')===false);assert.throws(()=>cashierHeaderLogoSource('missing','mini/components/CashierScreen.tsx'),/drift/);
 assert.throws(()=>cashierHeaderLogoSource(result,'mini/components/CashierScreen.tsx'),/drift/);
 for(const f of ['mini/components/Logo.tsx','mini/components/Receipt.tsx','mini/components/ReceiptPrintLayout.tsx','mini/components/Sidebar.tsx','mini/components/LoginScreen.tsx','admin/components/Header.tsx'])assert.equal(cashierHeaderLogoSource('protected',f),null);
});
test('activation/imports are exclusive to Omar Mini, with existing branding and themes untouched',async()=>{
 for(const [app,mode]of [['admin','omar'],['mini','production'],['mini','development']])assert.equal(omarCashierHeaderLogo({workspace,app,mode}),null);
 const config=await miniConfig({mode:'omar'}),admin=await adminConfig({mode:'omar'});const names=config.plugins.flat().filter(Boolean).map(p=>p.name);
 assert.ok(names.indexOf('omar-cashier-header-logo')>names.indexOf('omar-mini-inventory-theme'));assert.ok(names.indexOf('omar-cashier-header-logo')<names.indexOf('vite:react-babel'));
 assert.ok(!admin.plugins.flat().filter(Boolean).some(p=>p.name==='omar-cashier-header-logo'));
 const plugin=omarCashierHeaderLogo({workspace,app:'mini',mode:'omar'});assert.equal(plugin.resolveId('virtual:omar-cashier-header-logo'),path.join(workspace,cashierTightLogoFile));assert.equal(plugin.resolveId('../src/assets/llooggo.svg'),undefined);
 assertCanonicalRuntimeUnchanged(workspace);
});
test('new presentation CSS scopes only header brand; screen geometry gauge and print restoration are explicit',()=>{
 const require=createRequire(path.join(workspace,'mini/package.json')),css=fs.readFileSync(cashierLogoCSS,'utf8'),root=require('postcss').parse(css);
 root.walkRules(r=>{for(const s of r.selectors)assert.match(s,/^html\[data-omar-mini-theme="foundation"\] \[data-omar-mini-pos="cashier"\] \[data-omar-cashier-header-brand\]/);r.walkDecls(d=>{assert.ok(!d.important);assert.ok(!/background|shadow|border|filter|font|padding|transform/.test(d.prop));if(r.parent.type!=='atrule'){assert.equal(d.prop,'display');assert.equal(d.value,'none');}else assert.equal(r.parent.params,'screen');});});
 assert.ok(css.includes('object-fit: contain'));assert.ok(css.includes('visibility: hidden'));assert.ok(!css.includes('@media print'));
});

test('brand size comes exclusively from original in-flow text; image cannot enlarge it',()=>{
 const require=createRequire(path.join(workspace,'mini/package.json')),root=require('postcss').parse(fs.readFileSync(cashierLogoCSS,'utf8'));
 root.walkRules(r=>{if(r.parent.type==='atrule'&&r.selector.endsWith('[data-omar-cashier-header-brand]'))assert.deepEqual(r.nodes.map(d=>[d.prop,d.value]),[['position','relative']]);});
 const css=fs.readFileSync(cashierLogoCSS,'utf8');assert.ok(!/220px|108px|120px|margin:|min-height:/.test(css));assert.match(css,/width: 125px/);assert.match(css,/height: auto/);assert.match(css,/position: absolute/);
});

test('white silhouette keeps original alpha while the larger image floats inside the unchanged header',()=>{
 const png=fs.readFileSync(path.join(workspace,cashierLogoFile)),svg=read(cashierWhiteLogoFile),css=fs.readFileSync(cashierLogoCSS,'utf8');
 assert.equal(svg,whiteLogoSVG(png));assert.match(svg,/mask-type="alpha"/);assert.match(svg,/fill="#FFFFFF"/);assert.ok(!/<filter|<path|<text|stroke=/.test(svg));
 const embedded=Buffer.from(svg.match(/base64,([^" ]+)/)[1],'base64');assert.equal(createHash('sha256').update(embedded).digest('hex'),cashierLogoSHA256);
 assert.match(css,/width: 125px/);assert.match(css,/height: auto/);assert.match(css,/right: 0/);assert.match(css,/object-fit: contain/);
});


if(process.env.OMAR_HEADER_GEOMETRY_EVIDENCE){
 const dir=fs.realpathSync(process.env.OMAR_HEADER_GEOMETRY_EVIDENCE);assert.ok(dir.startsWith(workspace+'/.local/hassan/'));
 for(const state of ['closed','open'])test('exact pre-logo header/search/invoice geometry restored: sidebar '+state,()=>{
  const before=JSON.parse(fs.readFileSync(path.join(dir,'original-'+state+'.json'))),after=JSON.parse(fs.readFileSync(path.join(dir,'corrected-'+state+'.json')));assert.deepEqual(after,before);
  assert.equal(after.header[3],101);assert.deepEqual(after.document,after.viewport);assert.equal(after.brand[3],37.5);assert.equal(after.search.length,2);
 });
 test('fresh original text reference matches independently saved actual pre-logo evidence',()=>{
  const fresh=JSON.parse(fs.readFileSync(path.join(dir,'original-closed.json'))),old=JSON.parse(fs.readFileSync(path.join(workspace,'.local/hassan/cashier-header-logo-1793141274500/before-closed.json')));
  assert.deepEqual(fresh.header,old.header);assert.deepEqual(fresh.brand,old.brand);assert.deepEqual(fresh.controls.map(c=>({text:c.text,box:c.box})),old.controls.map(c=>({text:c.text,box:c.box})));
 });
}

test('tight white derivative removes transparent viewport only, preserving every visible pixel',async()=>{
 const {inflateSync}=await import('node:zlib');const png=fs.readFileSync(path.join(workspace,cashierLogoFile)),idat=[];let width,height;
 for(let offset=8;offset<png.length;){const n=png.readUInt32BE(offset),type=png.toString('ascii',offset+4,offset+8),chunk=png.subarray(offset+8,offset+8+n);if(type==='IHDR'){width=chunk.readUInt32BE(0);height=chunk.readUInt32BE(4);assert.equal(chunk[8],8);assert.equal(chunk[9],6);assert.equal(chunk[12],0);}if(type==='IDAT')idat.push(chunk);offset+=n+12;}
 const raw=inflateSync(Buffer.concat(idat)),stride=width*4;let previous=Buffer.alloc(stride),offset=0,left=width,top=height,right=0,bottom=0;
 for(let y=0;y<height;y++){const filter=raw[offset++],row=Buffer.from(raw.subarray(offset,offset+stride));offset+=stride;
  for(let x=0;x<stride;x++){const a=x>=4?row[x-4]:0,b=previous[x],c=x>=4?previous[x-4]:0,p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);const predictor=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):pa<=pb&&pa<=pc?a:pb<=pc?b:c;row[x]=(row[x]+predictor)&255;}
  for(let x=0;x<width;x++)if(row[x*4+3]>0){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1);}previous=row;
 }
 assert.deepEqual([left,top,right-left,bottom-top],tightLogoBounds);
 const tight=read(cashierTightLogoFile),original=read(cashierWhiteLogoFile);assert.equal(tight,tightWhiteLogoSVG(png));assert.equal(tight.replace('width="1435" height="844" viewBox="193 25 1435 844"','width="1792" height="878" viewBox="0 0 1792 878"'),original);
 const slotHeight=37.5,oldVisibleHeight=slotHeight*844/878,newVisibleHeight=slotHeight;assert.ok(newVisibleHeight>oldVisibleHeight);assert.ok(newVisibleHeight/oldVisibleHeight<1.05,'Tall original artwork limits lossless fill gain to about 4%');
});
if(process.env.OMAR_HEADER_FILL_EVIDENCE)test('fill optimization changes no header/container/control/search/invoice geometry',()=>{
 const dir=fs.realpathSync(process.env.OMAR_HEADER_FILL_EVIDENCE);assert.ok(dir.startsWith(workspace+'/.local/hassan/'));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'after.json'))),JSON.parse(fs.readFileSync(path.join(dir,'before.json'))));
});

if(process.env.OMAR_LARGER_LOGO_EVIDENCE)test('larger artwork stays inside original header without moving controls or overlapping buttons',()=>{
 const dir=fs.realpathSync(process.env.OMAR_LARGER_LOGO_EVIDENCE);assert.ok(dir.startsWith(workspace+'/.local/hassan/'));
 const actual=JSON.parse(fs.readFileSync(path.join(dir,'geometry.json'))),original=JSON.parse(fs.readFileSync(path.join(workspace,'.local/hassan/cashier-logo-geometry-1793147547183/original-closed.json')));assert.deepEqual(actual,original);
 const image=JSON.parse(fs.readFileSync(path.join(dir,'image.json')));assert.equal(image.headerHeight,101);assert.equal(image.image[2],125);assert.ok(image.image[3]>73&&image.image[3]<74);assert.equal(image.insideHeader,true);assert.equal(image.overlap,false);
});
