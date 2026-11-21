import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import adminConfig from './admin.vite.config.mjs';import {omarConfig,workspace} from './frontend-config.mjs';import {adminMobileOrigin} from './admin-mobile.mjs';
test('Mobile guard accepts exact Omar local/tunnel origins and rejects every other origin',async()=>{
 const config=await adminConfig({mode:'omar'}),plugin=config.plugins.find(p=>p?.name==='omar-local-isolation'),code=plugin.load('\0omar-origin');
 for(const origin of ['http://127.0.0.1:3100',adminMobileOrigin])assert.doesNotThrow(()=>vm.runInNewContext(code,{window:{location:{origin}}}));
 for(const origin of ['http://localhost:3100','https://evil.example',adminMobileOrigin+'.evil.example','http://127.0.0.1:5176'])assert.throws(()=>vm.runInNewContext(code,{window:{location:{origin}}}));
 assert.deepEqual(config.server.allowedHosts,[new URL(adminMobileOrigin).hostname]);assert.equal(config.server.host,'127.0.0.1');assert.equal(config.server.port,3100);
});
test('Admin uses same-origin API on phone and desktop; proxies stay on the dedicated backend',async()=>{
 const config=await adminConfig({mode:'omar'}),expression=config.define['import.meta.env.VITE_API_URL'];
 assert.equal(vm.runInNewContext(expression,{window:{location:{origin:adminMobileOrigin}}}),adminMobileOrigin);
 assert.equal(vm.runInNewContext(expression,{window:{location:{origin:'http://127.0.0.1:3100'}}}),'http://127.0.0.1:3100');
 for(const proxy of Object.values(config.server.proxy))assert.equal(proxy.target,'http://127.0.0.1:5104');
 assert.ok(config.server.fs.deny.includes('**/.local/**'));assert.ok(!config.server.fs.allow.includes(workspace));assert.equal(config.server.fs.strict,true);
 const plugin=config.plugins.find(p=>p?.name==='omar-local-isolation');assert.equal(plugin.transformIndexHtml.handler()[0].attrs.content,config.server.headers['Content-Security-Policy']);
 assert.deepEqual(config.server.hmr,{});
});
test('Mini and base local isolation contract remain untouched',async()=>{
 const mini=await omarConfig('mini',{mode:'omar'});assert.equal(mini.define['import.meta.env.VITE_API_URL'],'""');assert.equal(mini.server.port,5176);assert.equal(mini.server.allowedHosts,undefined);
 assert.throws(()=>vm.runInNewContext(mini.plugins[0].load('\0omar-origin'),{window:{location:{origin:adminMobileOrigin}}}));
});
