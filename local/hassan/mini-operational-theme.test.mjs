import {assertCanonicalRuntimeUnchanged} from './canonical-runtime-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {operationalScreens,operationalHooks,operationalThemeSource,operationalStylesheet,
  reviewedOperationalPaint,paintClasses,paintDigest,paintColor,operationalPaint,
  buildOperationalCSS,omarOperationalTheme} from './mini-operational-theme.mjs';
import miniConfig from './mini.vite.config.mjs';
import adminConfig from './admin.vite.config.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(workspace,'mini/package.json'));
const css=fs.readFileSync(operationalStylesheet,'utf8'),root=require('postcss').parse(css);
const read=file=>fs.readFileSync(path.join(workspace,file),'utf8');
const colorForms=value=>value.replace(/rgba?\(([^)]*)\)|color\(srgb ([^)]*)\)/g,(_,rgb,srgb)=>{
  const raw=rgb??srgb,alpha=raw.includes('/')?raw.split('/')[1].trim():raw.split(',').length===4?raw.split(',')[3].trim():'1';
  return 'COLOR('+Number.parseFloat(alpha).toFixed(6)+')';
}).replace(/#[\da-f]{3,8}\b/gi,'COLOR(1.000000)');

test('operational plugin is Omar Mini only and ordered after approved themes, before React',async()=>{
  for(const [app,mode] of [['admin','omar'],['mini','development'],['mini','production']])assert.equal(omarOperationalTheme({workspace,app,mode}),null);
  const mini=await miniConfig({mode:'omar'}),admin=await adminConfig({mode:'omar'});
  const names=mini.plugins.flat().filter(Boolean).map(p=>p.name);
  assert.ok(names.indexOf('omar-mini-operational-theme')>names.indexOf('omar-mini-cashier-theme'));
  assert.ok(names.indexOf('omar-mini-operational-theme')<names.indexOf('vite:react-babel'));
  assert.ok(!admin.plugins.flat().filter(Boolean).some(p=>p.name==='omar-mini-operational-theme'));
});

test('seven screens have attribute-only fail-closed hooks, including all four Treasury branches',()=>{
  assert.equal(Object.keys(operationalScreens).length,7);
  for(const file of Object.values(operationalScreens)){
    const original=read(file),themed=operationalThemeSource(original,file);
    let restored=themed;
    for(const [before,after] of [...operationalHooks[file]].reverse())restored=restored.replaceAll(after,before);
    assert.equal(restored,original);
    assert.throws(()=>operationalThemeSource(themed,file),/hook drift/);
    assert.throws(()=>operationalThemeSource(original+'\n// bg-[#NEW_COLOR]',file),/inventory drift/);
    assert.equal(paintDigest(original),reviewedOperationalPaint[file]);
  }
  const treasury=operationalThemeSource(read(operationalScreens.treasury),operationalScreens.treasury);
  assert.equal((treasury.match(/data-omar-mini-screen="treasury"/g)||[]).length,4);
});

test('stylesheet generation is deterministic and all rules are screen-only and narrowly scoped',()=>{
  assert.equal(css,buildOperationalCSS(workspace));
  assert.equal(buildOperationalCSS(workspace),buildOperationalCSS(workspace));
  const colors=new Set(['background-color','color','border-color','border-top-color','border-right-color','border-bottom-color','border-left-color','fill']);
  const vars=new Set(['--tw-shadow','--tw-shadow-color','--tw-drop-shadow','--tw-ring-color','--tw-gradient-from','--tw-gradient-to','--omar-mini-operational-red']);
  root.walkRules(rule=>{
    let parent=rule.parent;while(parent&&!(parent.type==='atrule'&&parent.name==='media'&&parent.params==='screen'))parent=parent.parent;
    assert.ok(parent);
    for(const selector of rule.selectors)assert.match(selector,/^html\[data-omar-mini-theme="foundation"\] \[data-omar-mini-shell\] \[data-omar-mini-screen="(?:waiting|customers|barbers|appointments|attendance|expenses|treasury)"\]/);
    rule.walkDecls(d=>{assert.ok(colors.has(d.prop)||vars.has(d.prop)||d.prop==='background-image',d.prop);assert.ok(!d.important);assert.notEqual(d.value,'none');});
  });
});

test('all recolored effect forms, alpha and existing interaction states are retained',()=>{
  let effects=0;
  for(const file of Object.values(operationalScreens))for(const c of paintClasses(read(file))){
    const paint=operationalPaint(c);if(!paint)continue;
    const suffix=c.match(/\/(\d+|\[[\d.]+\])$/)?.[1];
    const alpha=suffix?(suffix.startsWith('[')?Number(suffix.slice(1,-1))*100:Number(suffix)):null;
    for(const [p,value] of Object.entries(paint.declarations)){
      if(paint.originalEffect){
        assert.equal(colorForms(value).replaceAll(' ',''),colorForms(paint.originalEffect).replaceAll(' ',''));effects++;continue;
      }
      if(p==='--tw-gradient-to'&&c.startsWith('from-')){assert.ok(value.includes(' 0%, transparent)'));continue;}
      if(alpha!==null)assert.ok(value.includes(' '+alpha+'%, transparent)'),c);
    }
  }
  assert.ok(effects>10);
  for(const [screen] of Object.entries(operationalScreens)){
    const selectors=[];root.walkRules(r=>{if(r.selector.includes('screen="'+screen+'"'))selectors.push(r.selector);});
    const joined=selectors.join('\n');
    if(joined.includes('[class~="focus-within:')&&joined.includes('[class~="hover:'))assert.ok(joined.indexOf('[class~="focus-within:')<joined.indexOf('[class~="hover:'));
  }
});

test('destructive, warning, success and financial channels remain distinct',()=>{
  assert.match(paintColor('#E53935',undefined,'text'),/mini-error/);
  assert.match(paintColor('rose-500',undefined,'bg'),/mini-error/);
  assert.match(paintColor('emerald-400',undefined,'text'),/mini-success/);
  assert.match(paintColor('amber-400',undefined,'text'),/mini-warning/);
  assert.match(paintColor('blue-400',undefined,'text'),/mini-info/);
  assert.equal(paintColor('violet-400',undefined,'text'),null,'Keep existing Instapay identity');
  assert.match(css,/data-omar-mini-color-role="accent"\] \{ --omar-mini-operational-red: var\(--omar-mini-accent\)/);
});

test('Waiting, Barbers, Treasury print strings and receipt sources are unchanged and excluded',()=>{
  for(const file of Object.values(operationalScreens)){
    const original=read(file),themed=operationalThemeSource(original,file);
    const literals=s=>[...s.matchAll(/`(?:[^`\\]|\\.)*`/gs)].map(m=>m[0]);
    // Includes full HTML print templates, inline print styles and UI templates.
    assert.deepEqual(literals(themed),literals(original));
  }
  root.walkRules(rule=>{
    const token=rule.selector.match(/\[class~="([^"]+)"\]/)?.[1];
    if(!token)return;
    if(rule.nodes.some(d=>['color','fill'].includes(d.prop)))assert.ok(rule.selectors.every(s=>s.includes(']:not(:where(')),'Do not override screen root foreground');
    for(const selector of rule.selectors)if(selector.includes('] [class~='))assert.ok(selector.includes('.print-template *')&&selector.includes('.no-print *')&&selector.includes('.omar-logo-slot *'));
  });
  assert.ok(!/@media\s+print/.test(css));
  for(const file of ['mini/components/Receipt.tsx','mini/components/AppointmentDepositReceipt.tsx','mini/components/ReceiptPrintLayout.tsx'])assert.equal(operationalThemeSource('protected',file),null);
});

test('Cashier foundation remains byte-identical; canonical Mini/Admin and all out-of-scope files unchanged',()=>{
  const golden={'local/omar/mini-theme.css':'6564445188c15149432fbfd758b9f18eea30ce6c89167aebbe165b0554c827cd',
    'local/omar/mini-theme.mjs':'d1c63a97c41fa7ffe11dbd4b46189f85df528910ca23ab2c65fd924f4e3b767b',
    'local/omar/mini-cashier-theme.mjs':'450f193b387d7292b10b052c7833fe21948d33f42dfedc4d8c651ccf512b9a8c'};
  for(const [file,hash] of Object.entries(golden))assert.equal(createHash('sha256').update(read(file)).digest('hex'),hash);
 assertCanonicalRuntimeUnchanged(workspace);
  for(const file of ['mini/components/CashierScreen.tsx','mini/components/InvoiceSection.tsx','mini/components/StorageScreen.tsx','mini/components/InventoryOnlyApp.tsx','mini/components/LoginScreen.tsx','mini/App.tsx','admin/index.tsx'])assert.equal(operationalThemeSource('protected',file),null);
});

if(process.env.OMAR_OPERATIONAL_EVIDENCE){
  const directory=fs.realpathSync(process.env.OMAR_OPERATIONAL_EVIDENCE);assert.ok(directory.startsWith(workspace+'/.local/hassan/'));
  const before=JSON.parse(fs.readFileSync(path.join(directory,'before-computed.json'),'utf8'));
  const after=JSON.parse(fs.readFileSync(path.join(directory,'after-computed.json'),'utf8'));
  const pulse=JSON.parse(fs.readFileSync(path.join(directory,'pulse-definition.json'),'utf8'));
  assert.deepEqual(pulse.themed,pulse.original,'The running pulse timeline must remain identical');
  assert.deepEqual(pulse.original.keyframes,['@keyframes pulse{50%{opacity:.5}}']);
  assert.equal(pulse.original.timing.animationDuration,'2s');
  assert.equal(pulse.original.timing.animationPlayState,'running');
  for(const [state,baseline] of Object.entries(before))test('operational live computed fidelity: '+state,()=>{
    assert.ok(after[state]);assert.deepEqual(after[state].viewport,baseline.viewport);assert.equal(after[state].nodes.length,baseline.nodes.length);
    baseline.nodes.forEach((n,i)=>{
      const a=after[state].nodes[i];for(const p of ['tag','classes','box','scroll'])assert.deepEqual(a[p],n[p],state+' '+i+' '+p);
      for(const [p,value] of Object.entries(n.style)){
        // A live pulse sampled at two wall-clock times has different instantaneous
        // opacity. Verify its unchanged canonical timeline, never pause it or
        // rewrite recorded measurements to manufacture a matching screenshot.
        if(p==='opacity'&&n.classes===pulse.original.classes&&n.style.animationName==='pulse'){
          assert.equal(a.style.animationName,n.style.animationName);
          assert.equal(a.style.animationDuration,n.style.animationDuration);
          for(const sample of [value,a.style[p]])assert.ok(Number(sample)>=0.5&&Number(sample)<=1);
        }else assert.equal(colorForms(a.style[p]),colorForms(value),state+' '+i+' '+p);
      }
    });
  });
}
