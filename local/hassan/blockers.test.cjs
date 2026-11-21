// Offline real-component rendering and loader tests. No DOM server or database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {createRequire} = Module;
const {execFileSync} = require('node:child_process');
const root=require('node:path').resolve(__dirname,'../..');
const miniRequire=createRequire(path.join(root,'mini/package.json'));
const adminRequire=createRequire(path.join(root,'admin/package.json'));
const esbuild=miniRequire('esbuild');
for (const extension of ['.ts','.tsx']) require.extensions[extension]=(module,filename)=>{
  module._compile(esbuild.transformSync(fs.readFileSync(filename,'utf8'),{
    loader:extension==='.tsx'?'tsx':'ts',format:'cjs',jsx:'transform',
    define:{'import.meta.env.VITE_API_URL':JSON.stringify('http://127.0.0.1:5104')},
  }).code,filename);
};
require.extensions['.svg']=(module)=>{module.exports='offline-fixture.svg';};
const React=miniRequire('react');
const {renderToStaticMarkup}=miniRequire('react-dom/server');
const Receipt=require(path.join(root,'mini/components/Receipt.tsx')).default;
const utility=require(path.join(root,'mini/src/utils/whatsappUtil.ts'));
function checkpointModule(relative){
  const source=fs.readFileSync(path.join(root,'local/omar/baselines',relative),'utf8');
  const filename=path.join(root,path.dirname(relative),'checkpoint-fixture.tsx');
  const module=new Module(filename);
  module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));
  module._compile(esbuild.transformSync(source,{loader:'tsx',format:'cjs',jsx:'transform'}).code,filename);
  return module.exports;
}
const baselineUtility=checkpointModule('mini/src/utils/whatsappUtil.ts');
const BaselineReceipt=checkpointModule('mini/components/Receipt.tsx').default;
const groups=[{customerName:'Fixture',barber:'Fixture',services:[{name:'Service',price:60},{name:'Product',price:40,itemType:'PRODUCT_ITEM'}],subtotal:80}];
const props={invoiceId:'OFFLINE',branchName:'Fixture',groups,total:80,subtotal:100,discountAmount:20,onClose(){}};
const originalDate=Date;
class FixedDate extends originalDate {constructor(...args){super(...(args.length?args:['2026-10-27T09:00:00Z']));}static now(){return new originalDate('2026-10-27T09:00:00Z').getTime();}}
function render(component,values){
  const log=console.log,fetch=global.fetch;
  global.Date=FixedDate;console.log=()=>{};
  global.fetch=()=>{throw new Error('Network forbidden');};
  try{return renderToStaticMarkup(React.createElement(component,values));}
  finally{global.Date=originalDate;console.log=log;global.fetch=fetch;}
}

for(const [name,extra] of [
  ['paid',{subtotal:150,total:150,discountAmount:0}],
  ['discounted',{}],
  ['deposit',{depositApplied:30,payments:[{method:'CASH',amount:50,entered_amount:100}],changeAmount:50}],
  ['promo',{total:85,promo:{code:'OFFLINE',discount_amount:15},discountAmount:20}],
  ['fully discounted',{total:0,discountAmount:100}],
  ['authoritative zero',{subtotal:0,total:0,discountAmount:0}],
  ['split payments',{depositApplied:30,payments:[{method:'CASH',amount:20},{method:'VISA',amount:30}]}],
  ['grouped',{groups:[groups[0],{...groups[0],services:[{name:'Group 2',price:30}],subtotal:25}],subtotal:130,total:105,discountAmount:25}],
]) test('receipt preserves checkpoint rendering and WhatsApp money semantics: '+name,()=>{
  const values={...props,...extra};
  assert.equal(render(Receipt,values),render(BaselineReceipt,values));
  assert.equal(utility.buildInvoiceWhatsAppMessage(values),baselineUtility.buildInvoiceWhatsAppMessage(values));
});

test('missing-subtotal grouped path renders the same as existing authoritative utility fallback',()=>{
  const values={...props,subtotal:undefined,depositApplied:30};
  assert.equal(render(Receipt,values),render(Receipt,propsWithDeposit()));
  assert.equal(utility.buildInvoiceWhatsAppMessage(values),baselineUtility.buildInvoiceWhatsAppMessage(values));
  function propsWithDeposit(){return {...props,depositApplied:30};}
});

function hookHarness(){
  const hooks=[];let cursor=0,dirty=false,tree;const effects=[];const timers=new Map();let timerId=0;
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const shim={...adminRequire('react')};
  shim.useState=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={value:typeof initial==='function'?initial():initial};return [hooks[i].value,value=>{const next=typeof value==='function'?value(hooks[i].value):value;if(!Object.is(next,hooks[i].value)){hooks[i].value=next;dirty=true;}}];};
  shim.useRef=initial=>{const i=cursor++;if(!hooks[i])hooks[i]={current:initial};return hooks[i];};
  shim.useMemo=(fn,deps)=>{const i=cursor++;if(!hooks[i]||!same(hooks[i].deps,deps))hooks[i]={deps,value:fn()};return hooks[i].value;};
  shim.useEffect=(fn,deps)=>{const i=cursor++;const old=hooks[i];if(!old||!same(old.deps,deps)){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=fn();});}};
  const requests=[],pending=[];
  const fetchMock=(url,options)=>{requests.push({url,options});return new Promise((resolve,reject)=>pending.push({resolve,reject}));};
  const filename=path.join(root,'admin/components/supply/ReceiveSupplyModal.tsx');
  const originalLoad=Module._load;
  Module._load=function(request,parent,...rest){
    if(parent?.filename===filename&&request==='react')return shim;
    if(parent?.filename===filename&&request==='../../api/adminFetch')return {adminFetch:fetchMock};
    return originalLoad.call(this,request,parent,...rest);
  };
  let Component;
  try{delete require.cache[filename];Component=require(filename).default;}finally{Module._load=originalLoad;}
  const previousWindow=global.window;
  global.window={setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},addEventListener(){},removeEventListener(){}};
  const values={isOpen:true,onClose(){},onSuccess(){throw new Error('No stock submit permitted');}};
  async function settle(){for(let i=0;i<12;i++){await Promise.resolve();if(i===0||dirty){dirty=false;cursor=0;tree=Component(values);while(effects.length)effects.shift()();}}return tree;}
  return {settle,requests,pending,get tree(){return tree;},async runTimers(){const callbacks=[...timers.values()];timers.clear();for(const fn of callbacks)fn();await settle();},close(){for(const h of hooks)h.cleanup?.();global.window=previousWindow;}};
}
function find(element,predicate){if(!element||typeof element!=='object')return null;if(predicate(element))return element;for(const child of React.Children.toArray(element.props?.children)){const match=find(child,predicate);if(match)return match;}return null;}

test('supply initial failure renders; one explicit retry uses existing GET loader and cache',async()=>{
  const h=hookHarness();
  try{
    await h.settle();assert.equal(h.requests.length,1);
    h.pending.shift().reject(new Error('Offline failure'));await h.settle();
    await h.runTimers();assert.equal(h.requests.length,1,'failure must not cause a parallel automatic retry');
    const retry=find(h.tree,e=>e.type==='button'&&React.Children.toArray(e.props.children).some(c=>c?.props?.children==='إعادة المحاولة'));
    assert.ok(retry);retry.props.onClick();await h.settle();assert.equal(h.requests.length,2);
    h.pending.shift().resolve({ok:true,json:async()=>[{id:7,name:'Offline product',selling_price:10,cost_price:5,main_store_stock:0}]});await h.settle();await h.runTimers();
    assert.equal(h.requests.length,2,'success cache must avoid duplicate queries');
    assert.ok(find(h.tree,e=>Array.isArray(e.props?.products)&&e.props.products[0]?.id===7));
    for(const request of h.requests){assert.ok(request.url.includes('/api/admin/products/search?purpose=receive_supply&limit=20'));assert.equal(request.options.method,undefined);}
  }finally{h.close();}
});

test('settlement boundary has real React props/setState/reset behavior despite missing Admin typings',()=>{
  const {SettlementErrorBoundary}=require(path.join(root,'admin/components/settlement/SettlementErrorBoundary.tsx'));
  let resets=0;
  const boundary=new SettlementErrorBoundary({children:'offline child',onReset:()=>resets++});
  assert.ok(boundary instanceof adminRequire('react').Component);
  assert.equal(typeof boundary.setState,'function');
  assert.equal(boundary.render(),'offline child');
  boundary.state=SettlementErrorBoundary.getDerivedStateFromError(new Error('offline fixture'));
  assert.equal(boundary.state.hasError,true);assert.ok(boundary.render());
  boundary.setState=next=>{boundary.state={...boundary.state,...next};};
  boundary.handleReset();assert.equal(resets,1);assert.equal(boundary.state.hasError,false);
});

test('report formatting consumes documented numeric Object.entries values without runtime failure',()=>{
  const {formatCurrency,formatNumber}=require(path.join(root,'admin/components/reports/reportUtils.ts'));
  for(const value of Object.values({cash:120,visa:0,other:2.5})){
    assert.equal(typeof formatCurrency(value),'string');assert.equal(typeof formatNumber(value),'string');
  }
});
