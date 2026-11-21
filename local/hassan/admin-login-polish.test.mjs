import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {namespaceSource} from './frontend-config.mjs';
import {brandSource} from './branding.mjs';
import {finalUIThemeSource} from './admin-final-ui-theme.mjs';
import {loginHooks,loginRemovedBlocks,loginPolishSource,loginStylesheet,omarLoginPolish} from './admin-login-polish.mjs';
const workspace=process.cwd(),file='admin/components/LoginScreen.tsx',raw=fs.readFileSync(file,'utf8'),before=finalUIThemeSource(brandSource(namespaceSource(raw),file),file),after=loginPolishSource(before,file,workspace);
test('One official proportional logo; duplicate brand and terminal slogan removed',()=>{
 assert.equal((after.match(/<img data-omar-login-logo/g)||[]).length,1);
 assert.ok(after.includes('cashier-header-logo-white-tight.svg'));assert.ok(after.includes('mini-print-logo.svg'));
 assert.ok(!after.includes('<OmarWordmark'));assert.ok(!after.includes('<Logo '));assert.ok(!after.includes('EXECUTIVE TERMINAL'));
});
test('Login inputs, submit/loading/error markup, authentication and focus order unchanged',()=>{
 const form=s=>s.slice(s.indexOf('<form '),s.indexOf('</form>')+7);
 assert.equal(form(after),form(before));
 let expected=before;for(const pattern of loginRemovedBlocks)expected=expected.replace(pattern,'');
 let restored=after.replace(/^import omarLoginWhite[^\n]+\nimport omarLoginInk[^\n]+\n/,'');
 for(const[b,a]of loginHooks)restored=restored.replace(a,b);
 assert.equal(restored,expected);
 assert.ok(after.includes('disabled={loading}'));assert.ok(after.includes('onSubmit={handleLogin}'));
 assert.throws(()=>loginPolishSource(before+'\n',file,workspace),/drift/);
});
test('Viewport/safe-area sizing allows natural scrolling and preserves form geometry',()=>{
 const css=fs.readFileSync(loginStylesheet,'utf8');
 for(const token of ['min-height:100dvh','height:auto','overflow:visible','margin-block:auto','env(safe-area-inset-bottom)','(max-height:600px)','max-width:100%','object-fit:contain'])assert.ok(css.includes(token));
 assert.ok(!css.includes('overflow:hidden'));assert.ok(!css.includes('position:fixed'));
 for(const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){assert.ok(rule[1].includes('html[data-omar-admin-theme="foundation"] [data-omar-admin-final-area="login"]'));assert.ok(!/background:|color:|font-size:/.test(rule[2]));}

});
test('Plugin is Omar Admin only and cannot transform other screens',()=>{
 assert.equal(omarLoginPolish({workspace,app:'mini',mode:'omar'}),null);assert.equal(omarLoginPolish({workspace,app:'admin',mode:'development'}),null);
 assert.equal(loginPolishSource('unchanged','admin/components/PromoCodesPage.tsx',workspace),null);
});
