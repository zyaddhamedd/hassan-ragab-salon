import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {couponArtifactSource,omarCouponArtifact} from './admin-coupon-artifact.mjs';
const root=process.cwd(),require=createRequire(path.join(root,'admin/package.json'));
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file){const source=fs.readFileSync(file,'utf8');const output=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});assert.equal(output.diagnostics.length,0);const module={exports:{}};vm.runInNewContext(output.outputText,{module,exports:module.exports,require:id=>id.endsWith('/utils/promoCodes')?load('admin/utils/promoCodes.ts'):require(id),Intl,Date,Error,Number,Set});return module.exports;}
const Card=load('local/omar/coupon-artifact.tsx').default,utils=load('admin/utils/promoCodes.ts');
const promo={id:12,code:'QA_25',discount_type:'PERCENTAGE',discount_value:'25',discount_scope:'SERVICES_ONLY',category_scope:'ALL_SERVICE_CATEGORIES',category_ids:[],branch_scope:'ALL_BRANCHES',branch_ids:[],is_active:true,starts_at:null,expires_at:null,usage_limit:null,archived_at:null};
const props={promo,now:Date.parse('2026-10-29'),canManage:true,disabled:false,pending:false,onEdit:()=>{},onToggle:()=>{},onArchive:()=>{},children:React.createElement('dl',null,'Original complete details')};
const render=changes=>renderToStaticMarkup(React.createElement(Card,{...props,...changes}));
function find(node,predicate,out=[]){if(!node||typeof node!=='object')return out;if(predicate(node))out.push(node);React.Children.forEach(node.props?.children,child=>find(child,predicate,out));return out;}
test('Omar-only Dark card switch retains original Light card, details and page logic',()=>{
 const file='admin/components/PromoCodesPage.tsx',source=fs.readFileSync(file,'utf8'),out=couponArtifactSource(source,file);
 const start=source.indexOf('<article key={promo.id}'),end=source.indexOf('</article>)}</div>}',start)+10,original=source.slice(start,end);
 assert.ok(out.includes(': '+original+'))}</div>}'));
 assert.ok(out.endsWith(source.slice(end)));
 assert.ok(out.includes(source.slice(0,start)));
 const dl=original.slice(original.indexOf('<dl '),original.indexOf('</dl>')+5);
 assert.equal(out.split(dl).length,3);
 for(const handler of ['onEdit={() => setModal({ promo })}','onToggle={() => mutate(promo, false)}','onArchive={() => mutate(promo, true)}','disabled={loading || pending !== null}','canManage={canManagePromo(user, promo)}'])assert.ok(out.includes(handler));
 assert.throws(()=>couponArtifactSource(source+'\n',file),/drift/);
 assert.equal(couponArtifactSource(source,'mini/App.tsx'),null);
 assert.equal(omarCouponArtifact({workspace:root,app:'mini',mode:'omar'}),null);
 assert.equal(omarCouponArtifact({workspace:root,app:'admin',mode:'production'}),null);
});
test('Real values, all scope variants and secondary children render without fictional content',()=>{
 for(const scope of ['SERVICES_ONLY','PRODUCTS_ONLY','SERVICES_AND_PRODUCTS']){
  const html=render({promo:{...promo,discount_scope:scope}});
  assert.ok(html.includes(utils.promoScopeLabel(scope)));assert.ok(html.includes('QA_25'));assert.ok(html.includes('Original complete details'));assert.ok(html.includes('25'));assert.ok(!html.includes('OMAR25'));
 }
 assert.ok(render({promo:{...promo,discount_type:'FIXED',discount_value:'120.50'}}).includes('120.5'));
 assert.ok(render({promo:{...promo,discount_type:'FIXED',discount_value:'9999999999.99'}}).includes('data-long="true"'));
 for(const state of [{is_active:false},{archived_at:'2026-01-01'},{expires_at:'2026-01-01'},{starts_at:'2027-01-01'}]){const p={...promo,...state};assert.ok(render({promo:p}).includes(utils.promoStatus(p,props.now)));}
});
test('Original callbacks, disabled guards and read-only permissions remain intact',()=>{
 const calls=[];const tree=Card({...props,onEdit:()=>calls.push('edit'),onToggle:()=>calls.push('toggle'),onArchive:()=>calls.push('archive')});
 const buttons=find(tree,n=>n.type==='button');assert.equal(buttons.length,3);buttons.forEach(b=>b.props.onClick());assert.deepEqual(calls,['edit','toggle','archive']);
 assert.equal(find(Card({...props,disabled:true}),n=>n.type==='button'&&n.props.disabled).length,3);
 assert.equal(find(Card({...props,canManage:false}),n=>n.type==='button').length,0);
 assert.ok(render({canManage:false,promo:{...promo,archived_at:'2026-01-01'}}).includes('مؤرشف — محفوظ في السجل'));
 assert.ok(render({pending:true}).includes('جارٍ حفظ التغيير…'));
 assert.ok(render({promo:{...promo,is_active:false}}).includes('تفعيل'));
});
test('Styles use unique artifact selectors and existing responsive composition, no global or print rules',()=>{
 const css=fs.readFileSync('local/omar/coupon-artifact.css','utf8');
 assert.ok(css.includes('@media screen'));assert.ok(css.includes('@container (max-width:350px)'));assert.ok(css.includes('prefers-reduced-motion'));assert.ok(!css.includes('@media print'));
 assert.ok(!/(?:^|})\s*(?:body|html|button|summary|dl|dt|dd|svg|\*)\s*[{:,]/m.test(css));
 assert.ok(!css.includes('http'));assert.ok(!css.includes('.oc-artifact summary svg{transform'));
});
