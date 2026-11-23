// Omar Admin Services/Clients/Invoices presentation only. No document transforms.
import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto'; import { fileURLToPath } from 'node:url';
import { namespaceSource } from './frontend-config.mjs'; import { brandSource } from './branding.mjs';
import { inventoryClasses } from './mini-inventory-theme.mjs'; import { operationalPaint } from './mini-operational-theme.mjs';
export const recordsStylesheet = fileURLToPath(new URL('./admin-records-theme.css', import.meta.url));
export const recordsFiles = ['ServicesPage', 'ServiceCard', 'ServicesTable', 'ServiceModal', 'CategoryManagementModal', 'ClientsPage', 'ClientTable', 'ClientDetailsModal', 'InvoicesPage', 'InvoiceTable', 'InvoiceDetailsModal', 'InvoiceActivityTimeline'].map(n => 'admin/components/' + n + '.tsx');
const mark = 'data-omar-admin-records={isDarkMode ? "dark" : "light"}';
export const recordsHooks = {
  'admin/components/ServiceCard.tsx': [['<button onClick={() => { onDelete(service.id);', '<button data-omar-admin-records-danger="solid" onClick={() => { onDelete(service.id);', 1]],
  'admin/components/ServicesTable.tsx': [['onClick={() => onDelete(service.id)}', 'data-omar-admin-records-danger="hover" onClick={() => onDelete(service.id)}', 1]],
  'admin/components/ServicesPage.tsx': [['<div className="admin-page-shell', '<div ' + mark + ' className="admin-page-shell', 1]],
  'admin/components/ClientsPage.tsx': [['<div className="admin-page-shell', '<div ' + mark + ' className="admin-page-shell', 3]],
  'admin/components/InvoicesPage.tsx': [['<div className="admin-page-shell', '<div ' + mark + ' className="admin-page-shell', 3], ['id="invoice-workspace-portal"', mark + ' id="invoice-workspace-portal"', 1], ['<div className="fixed bottom-8 left-8 z-[160]', '<div ' + mark + ' className="fixed bottom-8 left-8 z-[160]', 1]],
  'admin/components/ServiceModal.tsx': [['<div className="admin-overlay-shell', '<div ' + mark + ' className="admin-overlay-shell', 1]],
  'admin/components/CategoryManagementModal.tsx': [['<div className="fixed inset-0 bg-black/60 z-50 flex">', '<div ' + mark + ' className="fixed inset-0 bg-black/60 z-50 flex">', 1], ['<button onClick={() => handleDelete(cat.id)}', '<button data-omar-admin-records-danger="solid" onClick={() => handleDelete(cat.id)}', 1]],
  'admin/components/ClientDetailsModal.tsx': [['<div className="admin-overlay-shell', '<div ' + mark + ' className="admin-overlay-shell', 2]],
  'admin/components/InvoiceDetailsModal.tsx': [['<div\n      className={`relative w-full h-full flex flex-col overflow-hidden', '<div ' + mark + '\n      className={`relative w-full h-full flex flex-col overflow-hidden', 1], ['<div className="w-full flex justify-center">', '<div data-omar-admin-document-protected className="w-full flex justify-center">', 1]],
  // Protect export UI as well as exported documents; no paint inventory from these files.
  'admin/components/clients/ClientsExportModal.tsx': [['<div className="admin-overlay-shell admin-overlay-shell--scroll z-[140]', '<div data-omar-admin-document-protected className="admin-overlay-shell admin-overlay-shell--scroll z-[140]', 1]],
  'admin/components/invoices/InvoiceExportModal.tsx': [['<div className="fixed inset-0 z-[150] bg-black/65', '<div data-omar-admin-document-protected className="fixed inset-0 z-[150] bg-black/65', 1]],
};
export const recordsDigest = s => createHash('sha256').update(s).digest('hex');
export const reviewedRecords =/* REVIEWED */ {
  "admin/components/ServicesPage.tsx": "cfae423e6d34fa7f6f741f037b2a585e13e8265397390d6e69078c0123419e13",
  "admin/components/ServiceCard.tsx": "bece14aa44e42d4300ba12f630736a8db819e3271a60208b6d13f248c184eff3",
  "admin/components/ServicesTable.tsx": "c084ff0a7bb8c674fece9af14dece2ec9c14bc2057b362dd37120ffec325eb00",
  "admin/components/ServiceModal.tsx": "9cb70535a9123d6146b6a81c915774a804d33a5966159aa2e861577a4588c5e3",
  "admin/components/CategoryManagementModal.tsx": "b4c4911e35ee362dd6682c1896734f51d5c0197fa58689f98e54162ccca0f2f1",
  "admin/components/ClientsPage.tsx": "06d56c84672c560bf88ba47c415e52750e1daa90b20a247aab22339e4a72ceb1",
  "admin/components/ClientTable.tsx": "d25930825fd79504f040ce3cf3ab8198790bc3ef3dc9e4c8e428d136ce8fd387",
  "admin/components/ClientDetailsModal.tsx": "8d69507f29aabe8aa72891343f88e2a7f32b2ca7ce9578de7d44b44778f15cb3",
  "admin/components/InvoicesPage.tsx": "b4f23f93002a7921850e7bd4447d8e5af76239e4d1284ee0e029e07a264e6e16",
  "admin/components/InvoiceTable.tsx": "5c755cde3c0c3ed66a1403f2a31fc79b6423fdba2a43d08b44d6a1b0f01533ca",
  "admin/components/InvoiceDetailsModal.tsx": "242d864832a49e55edd775e9422e7885d98a49671d331d30a329596eb0040e11",
  "admin/components/InvoiceActivityTimeline.tsx": "43dc90421a5e09e1b81943143e189308d5b656fa24cdf465e49e7d7e2b0a6e2d",
  "admin/components/clients/ClientsExportModal.tsx": "20e8c6968726ed1a2db56c88d89858bf9aa358d8840c107788a6c5b123493f1f",
  "admin/components/invoices/InvoiceExportModal.tsx": "4151a54cd99aeb1e8eac1b972a0783182d76fdaed089da0fedf1cb62786ff077"
};
export function recordsThemeSource(source, file) {
  const hooks = recordsHooks[file]; if (!hooks) return null;
  const raw = fs.readFileSync(path.join(path.resolve(import.meta.dirname, '../..'), file), 'utf8'); if (recordsDigest(raw) !== reviewedRecords[file] || ![raw, namespaceSource(raw), brandSource(namespaceSource(raw), file)].includes(source)) throw Error('Omar records source drift: ' + file);
  let code = source; for (const [b, a, count] of hooks) { if (code.includes(a) || code.split(b).length !== count + 1) throw Error('Omar records hook drift: ' + file); code = code.replaceAll(b, a); } return code;
}
const colors = { page: '#0B0B0D', input: '#121215', surface: '#151518', card: '#1A1A1F', selected: '#24242C', border: '#2B2B33', text: '#FFFFFF', secondary: '#F6F6F7', muted: '#B8C5CC', accent: '#A8906A', hover: '#BFA882', red: '#EF3434', green: '#16C784', blue: '#3291FF', amber: '#F5A623', purple: '#A78BFA', sky: '#38BDF8', cyan: '#22D3EE' };
export function recordsColor(base, kind) {
  const b = base.toLowerCase();
  const dark = { '#0b0b0b': 'page', '#0e0e0e': 'surface', '#0f0f0f': 'surface', '#111111': 'surface', '#121212': 'input', '#131313': 'card', '#141414': 'surface', '#161616': 'card', '#181818': 'card', '#1a1a1a': 'card', '#1e1e1e': 'selected', '#101917': 'surface', '#1a1111': 'surface' };
  if (dark[b]) return colors[dark[b]];
  if (b === '#e53935' || b === '#e6d690') return colors.accent;
  if (b === '#ff3b30') return colors.hover; if (b === '#ff6b6b') return colors.red;
  if (b === '#f5f5f5') return colors.text;
  if (b === '#9e9e9e' || b === '#6e6e6e') return colors.secondary;
  if (b === 'white') return kind.startsWith('border') ? colors.border : colors.text;
  // Real black backdrops, image washes and shadows retain their original RGB/alpha.
  if (b === 'black' || b === 'transparent' || b === 'current') return null;
  if (/^(gray|slate|zinc|neutral)-\d+$/.test(b)) return ['text', 'placeholder'].includes(kind) ? colors.secondary : colors.selected;
  const semantic = b.match(/^(red|rose|emerald|green|blue|sky|cyan|amber|yellow|orange|purple|violet)-(\d+)$/); if (!semantic) return null;
  const [, h, n] = semantic; const c = { red: 'red', rose: 'red', emerald: 'green', green: 'green', blue: 'blue', sky: 'sky', cyan: 'cyan', amber: 'amber', yellow: 'amber', orange: 'amber', purple: 'purple', violet: 'purple' }[h];
  // Retain distinct stops in existing gradients; do not turn multi-stop forms flat.
  if (['from', 'via', 'to'].includes(kind)) { const shades = { red: { 300: '#FF7171', 400: '#FF5050', 600: '#DC2424', 900: '#991B1B' }, green: { 300: '#54E7B2', 400: '#2DDB9B', 600: '#0C9F68' }, amber: { 300: '#FFC457', 400: '#FFB938', 600: '#D98B12' } }; return shades[c]?.[n] || colors[c]; }
  return colors[c];
}
export function recordsPaint(cls) {
  // Match checkpoint Tailwind output: unsupported alpha utilities must not create new paints.
  if (/\/(6|8|12|14)$/.test(cls) || /^(?:hover:)?bg-white\/\[0\.0(?:05|15|25)\]$/.test(cls)) return null;
  const m = cls.match(/^(?:(disabled:hover|group-focus-within|group-hover|focus-within|focus-visible|hover|focus|disabled|active):)?(placeholder:text|placeholder|border-[lrtbxy]|drop-shadow|bg|text|border|from|via|to|shadow|ring|fill)-(.+)$/); if (!m) return null;
  const [, state = '', raw, value] = m, kind = raw === 'placeholder:text' ? 'placeholder' : raw;
  const effect = operationalPaint(cls); if (effect?.originalEffect) { const rgb = effect.originalEffect.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g, (all, r, g, b, a) => { const c = { '229,57,53': '168,144,106', '239,68,68': '239,52,52', '16,185,129': '22,199,132', '230,214,144': '168,144,106' }[[r, g, b].join(',')]; return c ? 'rgba(' + c + ',' + a + ')' : all; }); if (rgb === effect.originalEffect) return null; return { variant: state, declarations: { [Object.keys(effect.declarations)[0]]: rgb }, originalEffect: effect.originalEffect }; }
  const parsed = value.match(/^(\[[^\]]+\]|[^/]+)(?:\/(\d+|\[[\d.]+\]))?$/); if (!parsed) return null; let [, base, alpha] = parsed; base = base.replace(/^\[|\]$/g, ''); let c = recordsColor(base, kind); if (!c) return null; if (alpha !== undefined) c = `color-mix(in srgb, ${c} ${alpha.startsWith('[') ? Number(alpha.slice(1, -1)) * 100 : Number(alpha)}%, transparent)`;
  const position = n => ' var(--tw-gradient-' + n + '-position)';
  if (kind === 'from') return { variant: state, declarations: { '--tw-gradient-from': c + position('from'), '--tw-gradient-to': `color-mix(in srgb, ${recordsColor(base, kind)} 0%, transparent)` + position('to') } };
  if (kind === 'via') return { variant: state, declarations: { '--tw-gradient-stops': 'var(--tw-gradient-from), ' + c + position('via') + ', var(--tw-gradient-to)' } };
  if (kind === 'to') return { variant: state, declarations: { '--tw-gradient-to': c + position('to') } };
  const prop = { bg: 'background-color', text: 'color', placeholder: 'color', border: 'border-color', 'border-t': 'border-top-color', 'border-b': 'border-bottom-color', 'border-l': 'border-left-color', 'border-r': 'border-right-color', shadow: '--tw-shadow-color', ring: '--tw-ring-color', fill: 'fill' }[kind]; return prop ? { variant: state, declarations: { [prop]: c } } : null;
}
export function buildRecordsCSS(workspace) {
  const scope = 'html[data-omar-admin-theme="foundation"] [data-omar-admin-records="dark"]';
  const guard = ':not(:where([data-omar-admin-document-protected],[data-omar-admin-document-protected] *,.print-template,.print-template *,.print-only,.print-only *)):not(:has([data-omar-admin-document-protected]))';
  const lines = ['/* Omar Admin Services/Clients/Invoices paint only. Original alpha, shapes and state semantics. */', '@media screen {']; const classes = new Set();
  for (const f of recordsFiles) { const s = fs.readFileSync(path.join(workspace, f), 'utf8'); if (recordsDigest(s) !== reviewedRecords[f]) throw Error('Omar records paint drift: ' + f); inventoryClasses(s).forEach(c => classes.add(c)); }
  const order = { '': 0, 'focus-within': 1, hover: 2, focus: 3, 'focus-visible': 4, disabled: 5, active: 6, 'disabled:hover': 7, 'group-focus-within': 8, 'group-hover': 9 };
  for (const [cls, { variant, declarations }] of [...classes].map(c => [c, recordsPaint(c)]).filter(([, p]) => p).sort((a, b) => order[a[1].variant] - order[b[1].variant] || a[0].localeCompare(b[0], 'en'))) { const attr = '[class~="' + cls + '"]'; const suffix = (variant && !variant.startsWith('group-') ? ':' + variant : '') + (cls.startsWith('placeholder') ? '::placeholder' : ''); const selectors = variant.startsWith('group-') ? [scope + ' .group:' + variant.slice(6) + ' ' + attr + guard] : [scope + attr + guard + suffix, scope + ' ' + attr + guard + suffix]; lines.push('  ' + selectors.join(',\n  ') + ' { ' + Object.entries(declarations).map(([p, v]) => p + ': ' + v + ';').join(' ') + ' }'); }
  // Preserve destructive meaning where canonical source reuses its brand hex.
  lines.push('  ' + scope + ' [data-omar-admin-records-danger="solid"]' + guard + ' { color: #EF3434; }');
  lines.push('  ' + scope + ' [data-omar-admin-records-danger="solid"][class~="hover:bg-[#E53935]/10"]' + guard + ':hover { background-color: color-mix(in srgb, #EF3434 10%, transparent); }');
  lines.push('  ' + scope + ' [data-omar-admin-records-danger="hover"]' + guard + ':hover { color: #EF3434; border-color: color-mix(in srgb, #EF3434 40%, transparent); }');
  // RGB-only contrast correction for existing opaque champagne-filled controls.
  for (const c of ['bg-[#E53935]', 'bg-[#E6D690]']) lines.push('  ' + scope + ' [class~="' + c + '"][class~="text-white"]' + guard + ' { color: #0B0B0D; }');
  lines.push('}'); return lines.join('\n') + '\n';
}
export function omarRecordsTheme({ workspace, app, mode }) { if (app !== 'admin' || !['hassan', 'omar'].includes(mode)) return null; return { name: 'omar-admin-records-theme', enforce: 'pre', buildStart() { for (const f of Object.keys(recordsHooks)) { if (recordsDigest(fs.readFileSync(path.join(workspace, f), 'utf8')) !== reviewedRecords[f]) throw Error('Omar records protected/source drift: ' + f); } if (fs.readFileSync(recordsStylesheet, 'utf8') !== buildRecordsCSS(workspace)) throw Error('Omar records stylesheet drift'); }, transform(source, id) { const f = path.relative(workspace, id.split('?')[0]).split(path.sep).join('/'); if (f === 'admin/index.tsx') return { code: source + '\nimport ' + JSON.stringify(recordsStylesheet) + ';\n', map: null }; const code = recordsThemeSource(source, f); return code === null ? null : { code, map: null }; } }; }
