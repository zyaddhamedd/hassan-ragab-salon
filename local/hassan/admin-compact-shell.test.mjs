import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {brandSource} from './branding.mjs';
import {adminThemeSource} from './admin-theme.mjs';
import {compactShellSource,omarCompactShell,compactStylesheet} from './admin-compact-shell.mjs';
const workspace=process.cwd();
const input=file=>adminThemeSource(brandSource(fs.readFileSync(file,'utf8'),file),file);
test('compact shell activates exclusively in Omar Admin',()=>{
 assert.equal(omarCompactShell({workspace,app:'mini',mode:'omar'}),null);
 assert.equal(omarCompactShell({workspace,app:'admin',mode:'development'}),null);
 assert.equal(compactShellSource('untouched','admin/components/PromoCodesPage.tsx'),null);
});
test('Header removes the entire subtitle row; controls and handlers survive unchanged',()=>{
 const file='admin/components/Header.tsx',before=input(file),after=compactShellSource(before,file);
 assert.ok(!after.includes('data-omar-admin-header-subtitle'));
 assert.ok(!after.includes('mt-0.5 sm:mt-1 opacity-100 overflow-hidden'));
 assert.ok(after.includes('{pageTitle}'));
 assert.ok(after.includes('<MapPin data-omar-branch-pin size={14}'));
 assert.ok(after.includes("height: 'var(--app-header-height)'"));
 const strip=s=>s.replace(/<div className="flex items-center gap-1 sm:gap-2 mt-0\.5 sm:mt-1 opacity-100 overflow-hidden">[\s\S]*?<\/p>\s*<div[^\n]+<\/div>\s*<\/div>/,'').replace(/ data-omar-header-(?:frame|profile|title|branch)/g,'').replace(' data-omar-branch-pin','').replace(' aria-label="اختيار الفرع"','');
 assert.equal(strip(after),strip(before));
 assert.throws(()=>compactShellSource(before.replace('opacity-100 overflow-hidden','opacity-90 overflow-hidden'),file),/drift/);
});
test('Sidebar substitution changes only logo content and retains all interaction code',()=>{
 const file='admin/components/SideNav.tsx',before=input(file),after=compactShellSource(before,file);
 assert.ok(!after.includes('نظام القيادة التنفيذي'));
 const withoutCaption=before.replace(/<div className="admin-side-nav-label min-w-0">\s*<h2[^\n]+>نظام القيادة التنفيذي<\/h2>\s*<div[^\n]+\/>\s*<\/div>/,'');
 assert.equal(after.replace("import OmarAdminSidebarLogo from 'virtual:omar-admin-sidebar-logo';\n",'').replace('<OmarAdminSidebarLogo isDarkMode={isDarkMode} />','<Logo size="sm" />'),withoutCaption);
 const plugin=omarCompactShell({workspace,app:'admin',mode:'omar'});
 const logo=plugin.load(plugin.resolveId('virtual:omar-admin-sidebar-logo'));
 assert.ok(logo.includes('cashier-header-logo-white-tight.svg'));
 assert.ok(logo.includes('mini-print-logo.svg'));
});
test('CSS scopes all geometry to screen-only Omar Admin and desktop height',()=>{
 const css=fs.readFileSync(compactStylesheet,'utf8');
 assert.match(css,/@media screen and \(min-width: 1024px\) \{\s*html\[data-omar-admin-theme="foundation"\] \{ --app-header-height: 64px; \}/);
 assert.match(css,/grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
 assert.match(css,/width: 50px !important; height: 48px/);
 assert.match(css,/width: 140px !important; height: 84px/);
 assert.match(css,/object-fit: contain/);
 assert.ok(!/background(?!-color)|font-|z-index|transform:|@media print/.test(css));
 assert.match(css,/select \{ position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0/);
 assert.match(css,/width: 40px; min-width: 40px; max-width: 40px/);
 for(const line of css.split('\n').filter(s=>s.includes(' {')&&!s.trim().startsWith('@')))assert.ok(line.includes('html[data-omar-admin-theme="foundation"]'));
 const canonical=fs.readFileSync('admin/index.css','utf8');
 assert.match(canonical,/width:\s*72px/);assert.match(canonical,/width:\s*256px/);assert.match(canonical,/180ms/);
 assert.ok(canonical.includes('var(--app-header-height)'));
});
