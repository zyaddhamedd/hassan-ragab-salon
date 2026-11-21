import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {cashierThemeSource} from './mini-cashier-theme.mjs';
const require=createRequire(new URL('../../mini/package.json',import.meta.url));
const esbuild=require('esbuild'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=new URL('../..',import.meta.url).pathname;
function moduleAt(path,extra={}){const module={exports:{}};vm.runInNewContext(esbuild.transformSync(fs.readFileSync(root+'/'+path,'utf8'),{loader:path.endsWith('tsx')?'tsx':'ts',format:'cjs',jsx:'transform'}).code,{module,exports:module.exports,require,console,Number,JSON,Object,Array,Set,Promise,...extra});return module.exports;}
const prefs=moduleAt('mini/src/studio/preferences.ts');
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),data};};
const normalize=value=>JSON.parse(JSON.stringify(value));
test('preferences: missing, corrupt, wrong version and unsupported presets fall back safely',()=>{
 const s=storage(),key=prefs.preferenceKey(1,'device-a');
 assert.deepEqual(normalize(prefs.readPreferences(s,key).preferences),normalize(prefs.emptyPreferences()));
 s.setItem(key,'{broken');assert.ok(prefs.readPreferences(s,key).warning);
 s.setItem(key,JSON.stringify({version:2,serviceAppearance:{1:{preset:'gold'}}}));assert.ok(prefs.readPreferences(s,key).warning);
 const result=prefs.validatePreferences({version:1,categoryOrder:[0,2,2,-1,'3'],serviceOrderByCategory:{2:[4,4,5]},serviceAppearance:{4:{preset:'unknown',popular:true,price:100},5:{popular:false}}});
 assert.deepEqual(normalize(result.categoryOrder),[0,2]);assert.deepEqual(normalize(result.serviceOrderByCategory),{2:[4,5]});assert.deepEqual(normalize(result.serviceAppearance[4]),{popular:true});assert.ok(!JSON.stringify(result).includes('price'));
});
test('preferences: full save/read, device and branch isolation, missing/new records',()=>{
 const s=storage(),a=prefs.preferenceKey(1,'a'),b=prefs.preferenceKey(2,'a'),c=prefs.preferenceKey(1,'b');assert.equal(new Set([a,b,c]).size,3);assert.match(a,/^omar:cashier-studio:omar-fahim-standalone:v1:/);
 const draft=prefs.changeAppearance(prefs.emptyPreferences(),91,{popular:true});prefs.writePreferences(s,a,draft);
 assert.deepEqual(normalize(prefs.readPreferences(s,a).preferences),normalize(draft));assert.equal(prefs.appearanceFor(prefs.readPreferences(s,b).preferences,91).popular,false);assert.equal(prefs.appearanceFor(draft,999).popular,false);
 // Metadata for a temporarily missing ID cannot create a catalog record.
 const catalog=[{id:10,name:'new'}];assert.deepEqual(catalog.map(service=>[service.id,prefs.appearanceFor(draft,service.id).popular]),[[10,false]]);
 assert.equal(prefs.readPreferences(s,c).preferences.serviceAppearance[91],undefined);
});
test('preferences: cancel/reset are drafts; removing a badge clears only appearance',()=>{
 const s=storage(),key=prefs.preferenceKey(1,'a');const saved=prefs.changeAppearance(prefs.emptyPreferences(),91,{popular:true});prefs.writePreferences(s,key,saved);const original=s.getItem(key);
 const draft=prefs.changeAppearance(saved,91,{popular:false});assert.equal(saved.serviceAppearance[91].popular,true);assert.equal(s.getItem(key),original);
 const reset=prefs.emptyPreferences();assert.equal(s.getItem(key),original);prefs.writePreferences(s,key,reset);assert.equal(Object.keys(prefs.readPreferences(s,key).preferences.serviceAppearance).length,0);assert.equal(draft.serviceAppearance[91],undefined);
});
test('preferences: storage errors and false write acknowledgement throw',()=>{
 assert.throws(()=>prefs.writePreferences({setItem(){throw Error('quota')},getItem(){return null}},'a',prefs.emptyPreferences()),/quota/);
 assert.throws(()=>prefs.writePreferences({setItem(){},getItem(){return null}},'a',prefs.emptyPreferences()),/verification/);
 assert.ok(prefs.readPreferences({getItem(){throw Error('denied')}},'a').warning);
});
const safety=moduleAt('mini/src/studio/safety.ts',{HTMLElement:class HTMLElement{}});
test('synchronous boundary blocks entry before React renders; nested work, rejection and recovery',async()=>{
 const boundary=safety.createStudioBoundary();let release;const operation=boundary.run(async()=>{await boundary.run(()=>new Promise(resolve=>{release=resolve}));});assert.equal(boundary.pending,2);assert.equal(boundary.enter(),false);release();await operation;assert.equal(boundary.pending,0);assert.equal(boundary.enter(),true);let mutations=0;await boundary.run(async()=>{mutations++});assert.equal(mutations,0);boundary.leave();await assert.rejects(boundary.run(async()=>{throw Error('failed')}));assert.equal(boundary.pending,0);assert.equal(boundary.enter(),true);
});
test('shortcut ignores ordinary/repeated/composing/typing keys',()=>{
 const elementClass=class HTMLElement{constructor(input=false,editable=false){this.input=input;this.isContentEditable=editable}matches(){return this.input}};
 const {isStudioShortcut}=moduleAt('mini/src/studio/safety.ts',{HTMLElement:elementClass});const base={key:'F2',shiftKey:true,ctrlKey:true,metaKey:false,altKey:false,composedPath:()=>[]};assert.equal(isStudioShortcut(base),true);for(const change of [{repeat:true},{isComposing:true},{key:'E'},{shiftKey:false},{defaultPrevented:true},{composedPath:()=>[new elementClass(true)]},{composedPath:()=>[new elementClass(false,true)]}])assert.equal(isStudioShortcut({...base,...change}),false);
});
const source=fs.readFileSync(root+'/mini/components/CashierScreen.tsx','utf8');
function card(source,props){const start=source.indexOf('const MemoizedServiceCard ='),end=source.indexOf('const ServiceCell =');const module={exports:{}};vm.runInNewContext(esbuild.transformSync('import React from "react";import {CheckCircle2,Plus}from"lucide-react";'+source.slice(start,end)+'\nexports.Card=MemoizedServiceCard;',{loader:'tsx',format:'cjs',jsx:'transform'}).code,{module,exports:module.exports,require,console:{log(){}}});return renderToStaticMarkup(React.createElement(module.exports.Card,props));}
const baseProps={service:{id:91,name:'خدمة عربية طويلة للعناية بالشعر واللحية والتصفيف الكامل',price:250},isInInvoice:false,isPending:false,onClick(){}};
test('Default card markup matches original exactly in idle/selected/pending states',()=>{
 const original=execFileSync('git',['show','HEAD:mini/components/CashierScreen.tsx'],{cwd:root,encoding:'utf8'});
 for(const state of [{},{isInInvoice:true},{isPending:true}])assert.equal(card(source,{...baseProps,...state}),card(original,{...baseProps,...state}));
});
test('POPULAR is the only appearance; independent from order, removable in every card state',()=>{
 for(const popular of [false,true])for(const state of [{},{isInInvoice:true},{isPending:true}]){
 const markup=card(source,{...baseProps,...state,appearance:{popular}});assert.equal(markup.includes('>POPULAR</span>'),popular);assert.ok(!markup.includes('data-omar-studio-preset'));assert.ok(markup.includes(baseProps.service.name));assert.ok(markup.includes('250'));
 }
 assert.ok(!source.includes('StudioEditor'));
 assert.doesNotThrow(()=>cashierThemeSource(source,'mini/components/CashierScreen.tsx'));
});
test('stable ID ordering reconciles new/missing/moved records and retains source objects',()=>{
 const items=[{id:3},{id:2},{id:1}];assert.deepEqual(normalize(prefs.orderedItems(items,[1,1,99,3]).map(x=>x.id)),[1,3,2]);assert.equal(prefs.orderedItems(items,[1])[0],items[2]);assert.deepEqual(normalize(prefs.moveId([1,2,3],1,2)),[2,3,1]);assert.deepEqual(normalize(prefs.defaultServices([{id:1},{id:3},{id:2}]).map(x=>x.id)),[3,2,1]);
 const old=prefs.validatePreferences({version:1,serviceAppearance:{1:{preset:'gold',popular:true},2:{preset:'signature',popular:false}}});assert.deepEqual(normalize(old.serviceAppearance),{1:{popular:true}});
});
test('financial algorithm bodies are preserved verbatim inside tracking wrappers',()=>{
 const ts=require('typescript');const original=execFileSync('git',['show','HEAD:mini/components/CashierScreen.tsx'],{cwd:root,encoding:'utf8'});
 const names=['ensureDraft','handleServiceClick','handleProductClick','handleRemoveItem','handleApplyPromo','handleAddCustomer','handleConfirm','handleNewInvoice'];
 function bodies(text){const sf=ts.createSourceFile('screen.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),result={};function visit(n){if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&names.includes(n.name.text)){let fn=n.initializer;if(ts.isCallExpression(fn))fn=fn.arguments[0];result[n.name.text]=text.slice(fn.body.getStart(sf)+1,fn.body.end-1).trim()}ts.forEachChild(n,visit)}visit(sf);return result;}
 const before=bodies(original),after=bodies(source);for(const name of names){assert.ok(after[name].startsWith('return studioBoundary.run(async () => {'));const inner=after[name].slice('return studioBoundary.run(async () => {'.length,after[name].lastIndexOf('});')).trim();assert.equal(inner,before[name],name);}
});
