// Real client and React component control-flow tests, with offline fetch and hooks.
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module');
const root=require('node:path').resolve(__dirname,'../..');
const req=createRequire(root+'/mini/package.json'), esbuild=req('esbuild');
function storage(){const values=new Map();return new Proxy({getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},{ownKeys:()=>[...values.keys()],getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});}
function environment(){
 const listeners=new Map(),events=[],requests=[];
 const window={innerHeight:1000,addEventListener:(k,f)=>{if(!listeners.has(k))listeners.set(k,new Set());listeners.get(k).add(f);},removeEventListener:(k,f)=>listeners.get(k)?.delete(f),dispatchEvent:e=>{events.push(e.type);for(const f of [...(listeners.get(e.type)||[])])f(e);}};
 const proof={tokenRequiresDeviceProof:()=>false,createDpopProof:async()=>{throw Error('Unexpected proof operation');}};
 const globals={window,document:{documentElement:{style:{setProperty(){}}}},localStorage:storage(),sessionStorage:storage(),crypto:{randomUUID:()=> 'offline-device'},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},FormData,Response,URL,AbortController,console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,fetch:async(url,options)=>{requests.push({url,options});if(!globals.respond)throw Error('Network forbidden');return globals.respond(url,options);}};
 function load(relative,imports){const source=esbuild.transformSync(fs.readFileSync(root+'/'+relative,'utf8'),{loader:relative.endsWith('tsx')?'tsx':'ts',format:'cjs',jsx:'transform',define:{'import.meta.env':'{}'}}).code;const module={exports:{}};vm.runInNewContext(source,{...globals,module,exports:module.exports,require:imports},{filename:relative});return module.exports;}
 const client=load('mini/src/api/client.ts',name=>{assert.equal(name,'../security/deviceProof');return proof;});
 return {globals,client,proof,requests,events,load};
}
function hooks(){
 const values=[],effects=[];let cursor=0,dirty=true,tree,component,props;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const React={createElement:(type,props,...children)=>({type,props:{...props,children}})};
 React.useState=initial=>{const i=cursor++;if(!values[i])values[i]={value:typeof initial==='function'?initial():initial};return [values[i].value,next=>{const value=typeof next==='function'?next(values[i].value):next;if(!Object.is(value,values[i].value)){values[i].value=value;dirty=true;}}];};
 React.useRef=initial=>{const i=cursor++;return values[i]??(values[i]={current:initial});};
 React.useMemo=(fn,deps)=>{const i=cursor++;if(!values[i]||!same(values[i].deps,deps))values[i]={value:fn(),deps};return values[i].value;};
 React.useCallback=(fn,deps)=>React.useMemo(()=>fn,deps);
 React.useEffect=(fn,deps)=>{const i=cursor++;if(!values[i]||!same(values[i].deps,deps)){const old=values[i];values[i]={deps};effects.push(()=>{old?.cleanup?.();values[i].cleanup=fn();});}};
 return {React,mount(c,p){component=c;props=p;},async settle(){for(let i=0;i<30;i++){await Promise.resolve();if(dirty){dirty=false;cursor=0;tree=component(props);while(effects.length)effects.shift()();}}return tree;},get tree(){return tree;}};
}
function find(node,predicate){if(!node||typeof node!=='object')return;if(predicate(node))return node;for(const child of (node.props?.children||[]).flat(Infinity)){const r=find(child,predicate);if(r)return r;}}
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const device={id:1,device_id:'offline-device',device_type:'DESKTOP',access_mode:'FULL_MINI',is_active:true};
const auth={access_token:'offline-access',refresh_token:'offline-refresh',device_context:device,cashier:{id:1,name:'Offline',branch_id:2,branch_name:'Offline branch'}};
const settled=p=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('Promise failed to settle')),200))]);

test('wrong login settles with form error, ends loading, retries and authenticates even with stale session token',async()=>{
 const e=environment(),h=hooks();let loggedIn;
 e.globals.localStorage.setItem('mini_token','stale');
 e.proof.tokenRequiresDeviceProof=()=>true;
 // LoginScreen must still prepare the normal login proof; only the stale bearer is omitted.
 const componentClient={...e.client,prepareLoginDeviceProof:async()=>({challenge_id:'fixture',proof:'fixture'})};
 const Login=e.load('mini/components/LoginScreen.tsx',name=>name==='react'?h.React:name==='../src/api/client'?componentClient:name==='lucide-react'?{}:{default:()=>null}).default;
 h.mount(Login,{onLogin:data=>{loggedIn=data;}});await h.settle();
 find(h.tree,n=>n.type==='input'&&n.props.type==='text').props.onChange({target:{value:'offline.invalid'}});
 find(h.tree,n=>n.type==='input'&&n.props.type==='password').props.onChange({target:{value:'wrong'}});await h.settle();
 let rejectLogin;e.globals.respond=()=>new Promise(resolve=>{rejectLogin=()=>resolve(response(401,{error:'Invalid credentials'}));});
 const form=find(h.tree,n=>n.type==='form');const pending=form.props.onSubmit({preventDefault(){}});await h.settle();
 assert.equal(find(h.tree,n=>n.type==='button'&&n.props.type==='submit').props.disabled,true);
 rejectLogin();await settled(pending);await h.settle();
 assert.equal(find(h.tree,n=>n.type==='button'&&n.props.type==='submit').props.disabled,false);
 assert.ok(JSON.stringify(h.tree).includes('Invalid credentials'));
 assert.equal(e.requests.length,1);assert.ok(e.requests[0].url.endsWith('/auth/login'));
 assert.equal(e.requests[0].options.headers.Authorization,undefined);assert.equal(e.requests[0].options.headers.DPoP,undefined);
 assert.ok(JSON.parse(e.requests[0].options.body).device_proof);assert.ok(!e.events.includes('auth:logout'));
 e.globals.respond=async()=>response(200,auth);
 await settled(find(h.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}}));await h.settle();assert.equal(loggedIn.access_token,auth.access_token);
});

test('expired authenticated session still refreshes once and retries with new token',async()=>{
 const e=environment();e.globals.localStorage.setItem('mini_token','expired');e.globals.localStorage.setItem('mini_refresh_token','refresh');
 e.globals.respond=async url=>url.endsWith('/auth/refresh')?response(200,auth):response(e.requests.length===1?401:200,{ok:true});
 assert.equal((await settled(e.client.apiClient.get('/auth/me'))).ok,true);
 assert.deepEqual(e.requests.map(r=>r.url.split('/').pop()),['me','refresh','me']);
 assert.equal(e.requests[2].options.headers.Authorization,'Bearer '+auth.access_token);assert.ok(!e.events.includes('auth:logout'));
});

test('expired session without usable refresh still clears tokens and notifies logout',async()=>{
 for(const refresh of [null,'rejected-refresh']){
  const e=environment();e.globals.localStorage.setItem('mini_token','expired');e.globals.localStorage.setItem('mini_cashier','{}');
  if(refresh)e.globals.localStorage.setItem('mini_refresh_token',refresh);
  e.globals.respond=async()=>response(401,{});
  void e.client.apiClient.get('/auth/me');for(let i=0;i<30;i++)await Promise.resolve();
  for(const key of ['mini_token','mini_refresh_token','mini_cashier'])assert.equal(e.globals.localStorage.getItem(key),null);
  assert.equal(e.events.filter(x=>x==='auth:logout').length,1);
  assert.equal(e.requests.length,refresh?2:1);
 }
});

test('real App logout is reentrancy-safe, clears session and preserves device identity/proof storage',async()=>{
 const e=environment(),h=hooks(),components=new Map();
 // All non-auth screen components are inert; no data requests or operational writes.
 e.client.apiClient.get=async()=>new Promise(()=>{});
 const App=e.load('mini/App.tsx',name=>{
  if(name==='react')return h.React;
  if(name==='./src/api/client')return e.client;
  if(name.includes('dateFormatter'))return {getTodayISO:()=> '2026-10-27',getCairoNow:()=>new Date('2026-10-27T10:00:00Z')};
  if(!components.has(name))components.set(name,function Screen(){});
  return {default:components.get(name)};
 }).default;
 h.mount(App,{});await h.settle();
 const login=find(h.tree,n=>typeof n.props?.onLogin==='function');assert.ok(login);
 login.props.onLogin(auth);await h.settle();
 const sidebar=find(h.tree,n=>typeof n.props?.onLogout==='function');assert.ok(sidebar);
 e.globals.sessionStorage.setItem('mini_booking_handoff:test','fixture');e.globals.sessionStorage.setItem('unrelated','keep');
 const originalDevice=e.globals.localStorage.getItem('mini_device_id'),eventsBefore=e.events.length;
 sidebar.props.onLogout();await h.settle();sidebar.props.onLogout();await h.settle();
 assert.ok(find(h.tree,n=>typeof n.props?.onLogin==='function'));assert.equal(h.tree.props.externalError,null);
 for(const key of ['mini_token','mini_refresh_token','mini_cashier','mini_device_context'])assert.equal(e.globals.localStorage.getItem(key),null);
 assert.equal(e.globals.sessionStorage.getItem('mini_booking_handoff:test'),null);assert.equal(e.globals.sessionStorage.getItem('unrelated'),'keep');assert.equal(e.globals.localStorage.getItem('mini_device_id'),originalDevice);
 assert.equal(e.events.slice(eventsBefore).filter(x=>x==='mini:device-context').length,2,'one notification per explicit logout, no nested reset');
 // External context loss must still trigger real logout, without recursive events.
 find(h.tree,n=>typeof n.props?.onLogin==='function').props.onLogin(auth);await h.settle();
 e.client.setStoredDeviceContext(null);await h.settle();assert.ok(find(h.tree,n=>typeof n.props?.onLogin==='function'));
 assert.equal(e.globals.localStorage.getItem('mini_token'),null);
});
