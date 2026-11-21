import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {contract, workspace, storageKeys, namespaceSource, omarConfig, assertContract} from './frontend-config.mjs';
import {collectIsolationInventory, assertIsolationInventory, assertIsolationSource, isolationSignature} from './isolation-source-guard.mjs';

test('literal transforms are deterministic and idempotent across all source files', () => {
  const inventory=collectIsolationInventory(workspace);
  for(const file of Object.keys(inventory)) {
    const source=fs.readFileSync(path.join(workspace,file),'utf8');
    const transformed=namespaceSource(source);
    assert.equal(namespaceSource(source),transformed);
    assert.equal(namespaceSource(transformed),transformed);
  }
});

test('unknown/new storage keys, changed patterns, URLs and removed files fail closed', () => {
  const reviewed=JSON.parse(fs.readFileSync(path.join(workspace,'local/hassan/frontend-source-inventory.json'),'utf8'));
  const file='mini/src/api/client.ts';
  const source=fs.readFileSync(path.join(workspace,file),'utf8');
  assert.doesNotThrow(()=>assertIsolationSource(source,file,reviewed));
  for(const changed of [source+"\nlocalStorage.getItem('unknown_token');",source.replace('mini_token','changed_token'),source+"\nfetch('https://unexpected.example');"]){
    assert.throws(()=>assertIsolationSource(changed,file,reviewed));
  }
  assert.throws(()=>assertIsolationSource("sessionStorage.setItem('new_key','x');",'mini/new.ts',reviewed));
  const removed={...reviewed};delete removed[file];
  assert.throws(()=>assertIsolationInventory(removed,reviewed));
  const introduced={...reviewed,'mini/new.ts':isolationSignature("localStorage.getItem('new');")};
  assert.throws(()=>assertIsolationInventory(introduced,reviewed));
});

test('unexpected backend, origin or storage contract fails closed', () => {
  assert.doesNotThrow(()=>assertContract(contract));
  for(const replacement of [
    {...contract,backend:'http://127.0.0.1:5004'},
    {...contract,admin:{...contract.admin,origin:'https://other.example'}},
    {...contract,mini:{...contract.mini,apiUrl:'https://other.example'}},
    {...contract,storagePrefix:''},
  ]) assert.throws(()=>assertContract(replacement));
});

test('fixed API targets, ports, proxies and empty env isolation ignore inherited targets', async () => {
  const old = process.env.VITE_API_URL;
  process.env.VITE_API_URL = 'https://forbidden.example';
  try {
    for (const app of ['admin','mini']) {
      const config = await omarConfig(app, {mode:'omar'});
      assert.equal(config.define['import.meta.env.VITE_API_URL'], JSON.stringify(contract[app].apiUrl));
      assert.equal(config.server.host, '127.0.0.1');
      assert.equal(config.server.port, contract[app].port);
      assert.equal(config.server.strictPort, true);
      assert.equal(config.envDir, workspace+'/.local/hassan/frontend-env');
      assert.equal(config.envPrefix, 'OMAR_PUBLIC_');
      for (const prefix of ['^/api/(?:admin|mini)(?:/|$)','/uploads']) {
        assert.equal(config.server.proxy[prefix].target, 'http://127.0.0.1:5204');
        assert.equal(config.preview.proxy[prefix].target, 'http://127.0.0.1:5204');
      }
      const policy=config.server.headers['Content-Security-Policy'];
      assert.equal(policy, config.preview.headers['Content-Security-Policy']);
      assert.ok(policy.includes("connect-src 'self' http://127.0.0.1:5204 ws://127.0.0.1:"+contract[app].port));
      assert.ok(!policy.includes('forbidden.example'));
    }
  } finally { if(old===undefined) delete process.env.VITE_API_URL;else process.env.VITE_API_URL=old; }
});

test('Vite source modules are not mistaken for backend API routes', async () => {
  for(const app of ['admin','mini']) {
    const config=await omarConfig(app,{mode:'omar'});
    const matches=(prefix,path)=>prefix.startsWith('^') ? new RegExp(prefix).test(path) : path.startsWith(prefix);
    for(const path of fs.readdirSync(workspace+'/admin/api').filter(name=>name.endsWith('.ts')).map(name=>'/api/'+name)) {
      assert.equal(Object.keys(config.server.proxy).some(prefix=>matches(prefix,path)),false);
    }
    for(const path of ['/api/admin/auth/login','/api/mini/auth/me','/uploads/example.png']) {
      assert.equal(Object.keys(config.server.proxy).some(prefix=>matches(prefix,path)),true);
    }
  }
});

test('wrong mode cannot invoke the legacy environment behavior', async () => {
  await assert.rejects(omarConfig('admin',{mode:'production'}));
  await assert.rejects(omarConfig('mini',{mode:'development'}));
  await assert.rejects(omarConfig('other',{mode:'omar'}));
});

test('all browser credentials, device IDs and session keys receive Hassan namespace', () => {
  for (const key of storageKeys) {
    for(const quote of ["'",'"','`']) assert.equal(namespaceSource(quote+key+quote),quote+'hr:'+key+quote);
  }
  assert.equal(namespaceSource('`mini_booking_handoff:${branchId}`'),'`hr:mini_booking_handoff:${branchId}`');
});

test('device proof implementation changes only its private IndexedDB namespace', async () => {
  const source=fs.readFileSync(path.join(workspace,'mini/src/security/deviceProof.ts'),'utf8');
  assert.equal(namespaceSource(source), source.replace("'mini-device-proof'","'hr:mini-device-proof'"));
});

test('origin guard fails before mounting on another client origin', async () => {
  for(const app of ['admin','mini']) {
    const config=await omarConfig(app,{mode:'omar'});
    const plugin=config.plugins[0];
    const code=plugin.load(plugin.resolveId('virtual:hassan-origin'));
    vm.runInNewContext(code,{window:{location:{origin:contract[app].origin}}});
    assert.throws(()=>vm.runInNewContext(code,{window:{location:'http://localhost:3000'}}));
  }
});

test('shared receipts receive local QR destination even when imported by Admin', async () => {
  const config=await omarConfig('admin',{mode:'omar'});
  const plugin=config.plugins[0];
  const file=path.join(workspace,'mini/components/Receipt.tsx');
  const source=fs.readFileSync(file,'utf8');
  const transformed=plugin.transform(source,file).code;
  assert.ok(!transformed.includes('https://example.invalid/omar-qr-unconfigured'));
  assert.ok(transformed.includes(contract.mini.origin));
  assert.equal(transformed,namespaceSource(source));
});

test('built bundles contain only Hassan effective targets and namespaced authentication', () => {
  for (const app of ['admin','mini']) {
    const directory=path.join(workspace,'.local/hassan/frontend-build',app);
    const assets=path.join(directory,'assets');
    const js=fs.readdirSync(assets).filter(p=>p.endsWith('.js')).map(p=>fs.readFileSync(path.join(assets,p),'utf8')).join('\n');
    for(const forbidden of ['localhost:5001','127.0.0.1:5004','linktr.ee/secretmens.club0','secretmen-crm.com','railway.app']) assert.ok(!js.includes(forbidden),app+': '+forbidden);
    assert.ok(js.includes(app==='admin'?'hr:admin_token':'hr:mini_token'));
    assert.ok(js.includes(contract[app].origin));
    if(app==='mini') assert.ok(js.includes('hr:mini-device-proof'));
    const html=fs.readFileSync(path.join(directory,'index.html'),'utf8');
    assert.ok(html.includes('Content-Security-Policy'));
  }
});
