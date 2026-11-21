import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {couponArtifactSource} from './admin-coupon-artifact.mjs';
import {promoHooks,promoStylesheet,promoThemeSource,omarPromoTheme} from './admin-promo-theme.mjs';
const workspace=process.cwd();
test('Dark theme follows artifact transform and adds only reversible presentation attributes',()=>{
 for(const[file,[before,after]]of Object.entries(promoHooks)){
  const raw=fs.readFileSync(file,'utf8'),input=file.endsWith('/PromoCodesPage.tsx')?couponArtifactSource(raw,file):raw;
  const output=promoThemeSource(input,file,workspace);
  assert.equal(output.replace(after,before),input);
  assert.throws(()=>promoThemeSource(input+'\n',file,workspace),/drift/);
 }
 const config=fs.readFileSync('local/omar/admin.vite.config.mjs','utf8');
 assert.ok(config.indexOf('splice(11,0,omarPromoTheme')>config.indexOf('splice(10,0,omarCouponArtifact'));
});
test('Only Omar Admin receives the overlay; unrelated pages and Light mode excluded',()=>{
 assert.equal(omarPromoTheme({workspace,app:'mini',mode:'omar'}),null);
 assert.equal(omarPromoTheme({workspace,app:'admin',mode:'development'}),null);
 assert.equal(promoThemeSource('unchanged','admin/components/InvoicesPage.tsx',workspace),null);
 const css=fs.readFileSync(promoStylesheet,'utf8');assert.ok(!css.includes('[data-omar-promo-theme="light"]'));
 for(const selector of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
  assert.ok(selector[1].includes('html[data-omar-admin-theme="foundation"] [data-omar-promo-theme="dark"]'));
  for(const declaration of selector[2].split(';').filter(d=>d.trim()))assert.ok(/^(?:background-color|border-color|color|accent-color):/.test(declaration.trim()),declaration);
  if(!selector[1].includes('.admin-page-shell'))assert.ok(selector[1].includes(':not(:where(.oc-artifact,.oc-artifact *))'));
 }
 assert.ok(css.startsWith('/*'));assert.ok(css.includes('@media screen'));assert.ok(!css.includes('@media print'));
});
test('Owner-approved V2 component, colors, actions, overlay and prototype remain byte-identical',()=>{
 assert.equal(createHash('sha256').update(fs.readFileSync('local/omar/coupon-artifact.tsx')).digest('hex'),'1a7c170ba51336a2c5267d4705566110dfc6a9eb394ec54d7c7716394565846c');
 assert.equal(createHash('sha256').update(fs.readFileSync('local/omar/coupon-artifact.css')).digest('hex'),'9544c0954efb258dcc78f9f9f0d5db321aee2417ea7f0374a78cd07f64bf79c8');
 assert.equal(createHash('sha256').update(fs.readFileSync('local/omar/admin-coupon-artifact.mjs')).digest('hex'),'eafc4fb74e1c1f29d6d088a207634a1a9401fc2fad11e057a3082d08b42c5db7');
 assert.equal(createHash('sha256').update(fs.readFileSync('local/omar/prototypes/reward-vault/index.html')).digest('hex'),'343d014e512c8ede1c4c219e846db89878f263dd26f268f4b2cad2855e84d6bf');
});
