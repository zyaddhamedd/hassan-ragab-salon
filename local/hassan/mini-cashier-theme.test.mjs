import {assertCanonicalRuntimeUnchanged} from './canonical-runtime-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {cashierHooks, cashierThemeSource, omarCashierTheme} from './mini-cashier-theme.mjs';
import miniConfig from './mini.vite.config.mjs';
import adminConfig from './admin.vite.config.mjs';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(workspace,'mini/package.json'));
const postcss=require('postcss'), esbuild=require('esbuild'), React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const css=fs.readFileSync(new URL('./mini-theme.css',import.meta.url),'utf8');
const suffix=css.slice(css.indexOf('/* Phase 4B.2:'));

test('cashier overlay is enabled only by Omar Mini; default and Admin remain untouched',async()=>{
  for(const [app,mode] of [['admin','omar'],['mini','production'],['mini','development']])
    assert.equal(omarCashierTheme({workspace,app,mode}),null);
  const mini=await miniConfig({mode:'omar'}),admin=await adminConfig({mode:'omar'});
  const names=mini.plugins.flat().filter(Boolean).map(p=>p.name);
  assert.ok(names.indexOf('omar-mini-theme-foundation')<names.indexOf('omar-mini-cashier-theme'));
  assert.ok(names.indexOf('omar-mini-cashier-theme')<names.indexOf('vite:react-babel'));
  assert.ok(!admin.plugins.flat().filter(Boolean).some(p=>p.name==='omar-mini-cashier-theme'));
  assertCanonicalRuntimeUnchanged(workspace);
});

test('explicit hooks fail closed and reverse to byte-identical source; receipt is outside painted regions',()=>{
  for(const [relative,hooks] of Object.entries(cashierHooks)){
    const source=fs.readFileSync(path.join(workspace,relative),'utf8');
    const themed=cashierThemeSource(source,relative);
    let reversed=themed;
    for(const [before,after] of [...hooks].reverse())reversed=reversed.replace(after,before);
    assert.equal(reversed,source);
    assert.throws(()=>cashierThemeSource('source drift',relative),/hook drift/);
    assert.throws(()=>cashierThemeSource(themed,relative),/hook drift/);
    if(relative.endsWith('CashierScreen.tsx')){
      const receipt=s=>s.slice(s.indexOf('const ReceiptModal ='),s.indexOf('const CashierScreen:'));
      assert.equal(receipt(themed),receipt(source));
      assert.ok(themed.indexOf('</main>')<themed.indexOf('<ReceiptModal\n'));
      assert.equal((themed.match(/data-omar-mini-pos=/g)||[]).length,2);
    }
  }
  for(const p of ['mini/components/Receipt.tsx','mini/components/ReceiptPrintLayout.tsx','mini/App.tsx','mini/components/Sidebar.tsx','mini/components/LoginScreen.tsx','mini/src/security/deviceProof.ts'])assert.equal(cashierThemeSource('protected',p),null);
});

test('cashier CSS is screen-only, region-scoped, color-only and preserves effects/hidden behavior',()=>{
  const root=postcss.parse(suffix);
  const allowed=new Set(['background-color','background-image','color','border-color','border-top-color','border-right-color','border-bottom-color','border-left-color','fill','--tw-shadow','--tw-shadow-color','--tw-ring-color','--tw-gradient-from','--tw-gradient-to','--omar-mini-red','--omar-mini-lookup-active']);
  root.walkRules(r=>{
    let parent=r.parent;while(parent&&!(parent.type==='atrule'&&parent.name==='media'&&parent.params==='screen'))parent=parent.parent;
    assert.ok(parent);
    for(const s of r.selectors){
      assert.ok(/^html\[data-omar-mini-theme="foundation"\] \[data-omar-mini-shell\] \[data-omar-mini-(pos|sidebar-root)/.test(s));
      assert.ok(!/receipt|print|Sidebar|body|#root/.test(s));
    }
    r.walkDecls(d=>{assert.ok(allowed.has(d.prop),d.prop);assert.ok(!d.important);});
  });
  assert.ok(!/\bblur\(/.test(suffix));
  assert.ok(!/@media\s+print/.test(suffix));
});

function loadInvoice(themed){
  const relative='mini/components/InvoiceSection.tsx';
  const original=fs.readFileSync(path.join(workspace,relative),'utf8');
  const source=themed?cashierThemeSource(original,relative):original;
  const module={exports:{}};
  vm.runInNewContext(esbuild.transformSync(source,{loader:'tsx',format:'cjs',jsx:'transform'}).code,{
    module,exports:module.exports,console:{log(){}},
    require:name=>{assert.ok(['react','lucide-react'].includes(name),'Unexpected runtime dependency: '+name);return require(name);},
    fetch(){throw Error('Network forbidden in offline fixture');},
  });
  return module.exports.default;
}
const Original=loadInvoice(false),Themed=loadInvoice(true);
const noop=()=>{};
const base={currentInvoice:null,subtotal:0,discountAmount:0,finalTotal:0,payments:[],isDiscountOpen:false,isLoading:false,paymentPhase:'IDLE',canRetryPaymentVerification:false,canConfirm:false,isCustomerValid:false,isGroupMode:false,appliedDiscount:null,handleRemoveItem:noop,handleNewInvoice:noop,handleConfirm:noop,setPayments:noop,setIsDiscountOpen:noop,setAppliedDiscount:noop};
const draft={id:900001,invoice_number:'FIXTURE ONLY',items:[{id:900002,service_name:'قص شعر رجالي',item_type:'SERVICE_ITEM',barber_name:'Fixture Barber',total:250,price:250,quantity:1}]};
const cases={
  empty:base,
  draft:{...base,currentInvoice:draft,subtotal:250,finalTotal:250,canConfirm:true,isCustomerValid:true},
  discount:{...base,currentInvoice:draft,subtotal:250,discountAmount:25,finalTotal:225,appliedDiscount:{type:'percentage',value:10}},
  promo:{...base,currentInvoice:draft,subtotal:250,discountAmount:25,finalTotal:225,appliedPromo:{code:'FIXTURE',promo_discount:25,discount_type:'PERCENTAGE',configured_value:10}},
  deposit:{...base,currentInvoice:draft,subtotal:250,finalTotal:150,invoiceNet:250,depositApplied:100,depositRemaining:20,depositNotice:'Fixture warning',depositBookings:[{appointment_id:1,date:'2026-01-01',time:'10:00',available_amount:100},{appointment_id:2,date:'2026-01-01',time:'11:00',available_amount:120}]},
  verifying:{...base,currentInvoice:draft,paymentPhase:'VERIFYING',canRetryPaymentVerification:false},
};
test('real invoice fixtures preserve markup, totals, tender controls, locking and deposit/promo contracts',()=>{
  for(const [name,props] of Object.entries(cases)){
    const original=renderToStaticMarkup(React.createElement(Original,props));
    const themed=renderToStaticMarkup(React.createElement(Themed,props));
    assert.equal(themed.replace(/ data-omar-mini-[\w-]+="[^"]*"/g,''),original,name);
    assert.equal((themed.match(/type="number"/g)||[]).length,3);
    if(name==='draft'){assert.match(themed,/Fixture Barber/);assert.match(themed,/قص شعر رجالي/);}
    if(name==='deposit'){assert.match(themed,/الحجز صاحب العربون/);assert.match(themed,/عربون مدفوع سابقًا/);}
    if(name==='verifying')assert.match(themed,/disabled=""/);
  }
});

test('selected service and product state hooks reuse existing state, not new state or measurements',()=>{
  const source=fs.readFileSync(path.join(workspace,'mini/components/CashierScreen.tsx'),'utf8');
  const themed=cashierThemeSource(source,'mini/components/CashierScreen.tsx');
  assert.match(themed,/data-omar-mini-service=\{isInInvoice \? "selected" : isPending \? "pending" : "idle"\}/);
  assert.match(themed,/data-omar-mini-product=\{inCart \? "selected" : "idle"\}/);
  // Virtualized cells, row/column sizing and lazy draft creation are untouched.
  for(const [start,end] of [['const ServiceCell =','const CustomerSection'],['const ensureDraft =','// Logic for enabling assistant']]){
    const a=source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
    assert.ok(a.length>100);assert.ok(themed.includes(a));
  }
});

// Optional static visual fixtures: no application entry point, hydration, auth,
// API client, network scripts or event handlers. They never write business data.
// Supply a directory already inside this worktree's ignored .local/omar tree.
if(process.env.OMAR_THEME_FIXTURE_DIR){
  const directory=fs.realpathSync(process.env.OMAR_THEME_FIXTURE_DIR);
  assert.ok(directory.startsWith(workspace+'/.local/hassan/'));
  const baseStyles=fs.readFileSync(path.join(directory,'base-styles.css'),'utf8');
  const original=fs.readFileSync(path.join(workspace,'mini/components/CashierScreen.tsx'),'utf8');
  function serviceMarkup(themed){
    const source=themed?cashierThemeSource(original,'mini/components/CashierScreen.tsx'):original;
    const card=source.slice(source.indexOf('const MemoizedServiceCard ='),source.indexOf('const ServiceCell ='));
    const module={exports:{}};
    vm.runInNewContext(esbuild.transformSync('import React from "react"; import {CheckCircle2,Plus} from "lucide-react";\n'+card+'\nexports.Card=MemoizedServiceCard;',{loader:'tsx',format:'cjs',jsx:'transform'}).code,{
      module,exports:module.exports,console:{log(){}},require:n=>{assert.ok(['react','lucide-react'].includes(n));return require(n);},
    });
    return [true,false].map((selected,i)=>renderToStaticMarkup(React.createElement(module.exports.Card,{service:{id:i+1,name:i?'تدريج فيد':'قص شعر رجالي',price:i?300:250},isInInvoice:selected,isPending:false,onClick:noop}))).join('');
  }
  for(const [name,props] of Object.entries(cases))for(const themed of [false,true]){
    const invoice=renderToStaticMarkup(React.createElement(themed?Themed:Original,props));
    const styles=themed?css:css.slice(0,css.indexOf('/* Phase 4B.2:'));
    // Fixture-only frame; real service-card and invoice markup above is unchanged.
    const body='<div data-omar-mini-shell="foundation" style="height:100vh"><div class="flex h-full min-h-0 overflow-hidden font-[\'Cairo\'] bg-[#0D0D0D] text-[#F5F5F5]" dir="rtl"><main data-omar-mini-pos="cashier" class="relative flex min-h-0 min-w-0 flex-1 flex-col border-l border-white/5 bg-[#0D0D0D]"><div class="grid grid-cols-2 gap-6 p-6" style="height:260px">'+serviceMarkup(themed)+'</div></main>'+invoice+'</div></div>';
    const html='<!doctype html><html lang="ar" dir="rtl" data-omar-mini-theme="foundation"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'"><title>OFFLINE FIXTURE — '+name+'</title><style>'+baseStyles+'</style><style>'+styles+'</style></head><body>'+body+'</body></html>';
    fs.writeFileSync(path.join(directory,(themed?'after-':'before-')+name+'.html'),html,{mode:0o600});
  }
}
