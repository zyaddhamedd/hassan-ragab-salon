// Omar Admin active expense/treasury/report presentation; no document or data changes.
import fs from 'node:fs'; import path from 'node:path'; import { createHash } from 'node:crypto'; import { fileURLToPath } from 'node:url'; import { workforcePaint } from './admin-workforce-theme.mjs'; import { recordsPaint } from './admin-records-theme.mjs'; import { inventoryClasses } from './mini-inventory-theme.mjs'; import { namespaceSource } from './frontend-config.mjs'; import { brandSource } from './branding.mjs';
const workspace = path.resolve(import.meta.dirname, '../..');
export const ledgerStylesheet = fileURLToPath(new URL('./admin-ledger-theme.css', import.meta.url));
export const reportNames = ['OverviewReport', 'ServicesReport', 'ProductsReport', 'SalesReport', 'FinanceReport', 'BranchesReport', 'EmployeesReport', 'CustomersReport', 'OperationsReport', 'ReportPrimitives'];
export const ledgerFiles = ['ExpensesPage', 'AdminTreasuryPage', 'ReportsPage'].map(n => 'admin/components/' + n + '.tsx').concat(reportNames.map(n => 'admin/components/reports/' + n + '.tsx'));
const mark = 'data-omar-admin-ledger={isDarkMode ? "dark" : "light"}';
export const ledgerHooks = {
  'admin/components/ExpensesPage.tsx': [['<div className="admin-page-shell', '<div ' + mark + ' className="admin-page-shell', 3]],
  'admin/components/AdminTreasuryPage.tsx': [['<div className={`admin-page-shell', '<div ' + mark + ' className={`admin-page-shell', 1], ['<span className="font-mono font-bold text-red-300">{closingReport.cash_in', '<span data-omar-admin-ledger-payment="cash" className="font-mono font-bold text-red-300">{closingReport.cash_in', 1], ['<span className="font-mono font-bold text-red-300">{(closingReport.visa_collected', '<span data-omar-admin-ledger-payment="visa" className="font-mono font-bold text-red-300">{(closingReport.visa_collected', 1], ['<span className="font-mono font-bold text-red-300">{(closingReport.instapay_collected', '<span data-omar-admin-ledger-payment="instapay" className="font-mono font-bold text-red-300">{(closingReport.instapay_collected', 1]],
  'admin/components/ReportsPage.tsx': [['<main className={`admin-page-shell', '<main data-omar-admin-ledger-area="reports" ' + mark + ' className={`admin-page-shell', 1]],
};
export const ledgerDigest = s => createHash('sha256').update(s).digest('hex');
export const reviewedLedger =/* REVIEWED */ {
  "admin/components/ExpensesPage.tsx": "a2245f38e81833dbabd7a4bd0db07c7566cc80808ee5a51bdac2545852c76c87",
  "admin/components/AdminTreasuryPage.tsx": "610a2620e8f9540bf91e5c4b16b26d1b754f27a61c22ae7b88c9695e1b00ae47",
  "admin/components/ReportsPage.tsx": "730bf259d542a40801f5f2021f34be8d65cca79dc11d40dd5f3ee1f195d9fc36",
  "admin/components/reports/OverviewReport.tsx": "1043ef90503c0c3a8f9d40ea878be877f82623092073151b0b4524b6b2083dee",
  "admin/components/reports/ServicesReport.tsx": "22361ac444f90f3af278087d30167d1635dfb28772f8b47a1848c191c1f034d7",
  "admin/components/reports/ProductsReport.tsx": "64016d22347e9ebd52d79f57c04614f41b7a3c1a10fba4b95cd5a9c527d41d79",
  "admin/components/reports/SalesReport.tsx": "fea01278ef1f2509eb486931de6764c2acb75f2b7bdf7cd39cd5a36448e1f5f2",
  "admin/components/reports/FinanceReport.tsx": "e7e71e2d8087c02e26c75844987bf7bb43114ed2866780effbffad82cf809863",
  "admin/components/reports/BranchesReport.tsx": "d1e8c876ee3d2e2b16ec2c78de077dcff74c896f5f74d8fe20c996d3eaf74008",
  "admin/components/reports/EmployeesReport.tsx": "6fa54b7f1e02d61429dd872d56890d215bcf38f94e310596f2c822cf9393357a",
  "admin/components/reports/CustomersReport.tsx": "f75958db898f8ec5c7daf5128a7a349a7b0928e557e946a4a9c6d97262d5a9a3",
  "admin/components/reports/OperationsReport.tsx": "5454d56d4440b43b6edb1084b45d3af2a8b1b211450c5eb65277463b2ef3e511",
  "admin/components/reports/ReportPrimitives.tsx": "5561d917ff6fdf69de1f95ce7a902277b8394a6c8d69d02386464d21065c417a"
};
// Exact presentation-only replacements reviewed per report. Light literals remain unchanged.
export const ledgerPaintHooks =/* PAINT */ {
  "admin/components/reports/OverviewReport.tsx": [
    [
      "stroke=\"#E53935\"",
      "stroke={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      1
    ],
    [
      "fill=\"#E53935\"",
      "fill={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      1
    ],
    [
      "fill=\"#E6D690\"",
      "fill={isDarkMode ? \"#A8906A\" : \"#E6D690\"}",
      1
    ],
    [
      "color: '#E53935'",
      "color: isDarkMode ? '#EF3434' : '#E53935'",
      1
    ],
    [
      "color: '#E6D690'",
      "color: isDarkMode ? '#A8906A' : '#E6D690'",
      1
    ],
    [
      "fill: '#E53935'",
      "fill: isDarkMode ? '#EF3434' : '#E53935'",
      3
    ]
  ],
  "admin/components/reports/ServicesReport.tsx": [
    [
      "stroke=\"#E53935\"",
      "stroke={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      1
    ],
    [
      "fill=\"#E53935\"",
      "fill={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      1
    ],
    [
      "fill=\"#E5393522\"",
      "fill={isDarkMode ? \"#EF343422\" : \"#E5393522\"}",
      1
    ],
    [
      "background: isDarkMode ? '#181818' : '#fff'",
      "background: isDarkMode ? '#151518' : '#fff'",
      2
    ],
    [
      "const trendColor = isDarkMode ? '#E6D690' : '#B58A24'",
      "const trendColor = isDarkMode ? '#A8906A' : '#B58A24'",
      1
    ]
  ],
  "admin/components/reports/ProductsReport.tsx": [
    [
      "stroke=\"#E53935\"",
      "stroke={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      2
    ],
    [
      "fill=\"#E5393522\"",
      "fill={isDarkMode ? \"#EF343422\" : \"#E5393522\"}",
      1
    ],
    [
      "fill=\"#E6D690\"",
      "fill={isDarkMode ? \"#A8906A\" : \"#E6D690\"}",
      1
    ],
    [
      "stopColor=\"#E53935\"",
      "stopColor={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      2
    ],
    [
      "background: isDarkMode ? '#181818' : '#fff'",
      "background: isDarkMode ? '#151518' : '#fff'",
      2
    ]
  ],
  "admin/components/reports/SalesReport.tsx": [
    [
      "stroke=\"#E53935\"",
      "stroke={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      1
    ],
    [
      "fill=\"#E6D690\"",
      "fill={isDarkMode ? \"#A8906A\" : \"#E6D690\"}",
      1
    ],
    [
      "stopColor=\"#E53935\"",
      "stopColor={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      2
    ],
    [
      "background: isDarkMode ? '#181818' : '#fff'",
      "background: isDarkMode ? '#151518' : '#fff'",
      1
    ]
  ],
  "admin/components/reports/FinanceReport.tsx": [
    [
      "stroke=\"#E53935\"",
      "stroke={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      1
    ],
    [
      "stroke=\"#E6D690\"",
      "stroke={isDarkMode ? \"#F5A623\" : \"#E6D690\"}",
      2
    ],
    [
      "fill=\"#E6D69018\"",
      "fill={isDarkMode ? \"#F5A62318\" : \"#E6D69018\"}",
      1
    ],
    [
      "stopColor=\"#E53935\"",
      "stopColor={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      2
    ],
    [
      "background: isDarkMode ? '#181818' : '#fff'",
      "background: isDarkMode ? '#151518' : '#fff'",
      2
    ]
  ],
  "admin/components/reports/EmployeesReport.tsx": [
    [
      "stroke=\"#E53935\"",
      "stroke={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      1
    ],
    [
      "stopColor=\"#E53935\"",
      "stopColor={isDarkMode ? \"#EF3434\" : \"#E53935\"}",
      2
    ],
    [
      "background: isDarkMode ? '#151515' : '#fff'",
      "background: isDarkMode ? '#151518' : '#fff'",
      1
    ]
  ]
};
export function ledgerThemeSource(source, file) { if (!ledgerHooks[file] && !ledgerPaintHooks[file]) return null; const raw = fs.readFileSync(path.join(workspace, file), 'utf8'); if (ledgerDigest(raw) !== reviewedLedger[file] || ![raw, namespaceSource(raw), brandSource(namespaceSource(raw), file)].includes(source)) throw Error('Omar ledger source drift: ' + file); let code = source; for (const [b, a, n] of [...(ledgerHooks[file] || []), ...(ledgerPaintHooks[file] || [])]) { if (code.includes(a) || code.split(b).length !== n + 1) throw Error('Omar ledger hook drift: ' + file); code = code.replaceAll(b, a); } return code; }
export function ledgerPaint(cls) {
  // Do not invent paint for nonstandard numeric opacity modifiers absent from
  // the checkpoint CDN scale (e.g. Overview text-white/42, /48, /52).
  const numericAlpha = cls.match(/\/(\d+)$/); if (numericAlpha && Number(numericAlpha[1]) % 5 !== 0) return null;
  // Functional red stays red, unlike brand-filled controls handled below.
  if (cls.includes('#E53935') && !/^(focus|focus-visible|group-focus-within):/.test(cls)) return recordsPaint(cls.replaceAll('#E53935', '#FF6B6B'));
  if (cls.includes('[#111]')) return recordsPaint(cls.replaceAll('[#111]', '[#111111]'));
  if (cls.includes('[#151515]')) return recordsPaint(cls.replaceAll('[#151515]', '[#131313]'));
  if (cls.includes('#B58A24') || cls.includes('#C2A34D')) return recordsPaint(cls.replace(/#(?:B58A24|C2A34D)/g, '#E6D690'));
  return workforcePaint(cls);
}
export function buildLedgerCSS(root) {
  const scope = 'html[data-omar-admin-theme="foundation"] [data-omar-admin-ledger="dark"]'; const guard = ':not(:where([data-omar-admin-document-protected],[data-omar-admin-document-protected] *,[data-omar-admin-workforce-document],[data-omar-admin-workforce-document] *,.print-template,.print-template *,.print-only,.print-only *)):not(:has([data-omar-admin-document-protected],[data-omar-admin-workforce-document]))'; const lines = ['/* Omar Admin active Expenses/Treasury/Reports. Paint only; narrowly scoped readable-text alpha. */', '@media screen {']; const classes = new Set(); for (const f of ledgerFiles) { const s = fs.readFileSync(path.join(root, f), 'utf8'); if (ledgerDigest(s) !== reviewedLedger[f]) throw Error('Omar ledger paint drift: ' + f); inventoryClasses(s).forEach(c => classes.add(c)); }
  const order = { '': 0, 'focus-within': 1, hover: 2, focus: 3, 'focus-visible': 4, disabled: 5, active: 6, 'disabled:hover': 7, 'group-focus-within': 8, 'group-hover': 9 };
  for (const [cls, { variant, declarations }] of [...classes].map(c => [c, ledgerPaint(c)]).filter(([, p]) => p).sort((a, b) => order[a[1].variant] - order[b[1].variant] || a[0].localeCompare(b[0], 'en'))) { const attr = '[class~="' + cls + '"]', suffix = (variant && !variant.startsWith('group-') ? ':' + variant : '') + (cls.startsWith('placeholder') ? '::placeholder' : ''); const selectors = variant.startsWith('group-') ? [scope + ' .group:' + variant.slice(6) + ' ' + attr + guard] : [scope + attr + guard + suffix, scope + ' ' + attr + guard + suffix]; lines.push('  ' + selectors.join(',\n  ') + ' { ' + Object.entries(declarations).map(([p, v]) => p + ': ' + v + ';').join(' ') + ' }'); }
  // Brand buttons/preset tabs; data bars without text-white retain functional red.
  for (const c of ['bg-[#E53935]', 'bg-[#E6D690]']) lines.push('  ' + scope + ' [class~="' + c + '"][class~="text-white"]' + guard + ' { background-color: #A8906A; color: #0B0B0D; }');
  for (const [method, color] of [['cash', '#16C784'], ['visa', '#3291FF'], ['instapay', '#A78BFA']]) lines.push('  ' + scope + ' [data-omar-admin-ledger-payment="' + method + '"]' + guard + ' { color: ' + color + '; }');
  // ReportPrimitives.mutedText supplies enabled secondary copy at 45% white.
  // On the opaque slate panel this is below 4.5:1; 75% retains hierarchy and clears AA.
  const reports = scope + '[data-omar-admin-ledger-area="reports"]';
  lines.push('  ' + reports + ' [class~="text-white/45"]' + guard + ':not(:where(:disabled,:disabled *,[aria-disabled="true"],[aria-disabled="true"] *)) { color: rgba(255,255,255,0.75); }');
  // Only readable SVG axis text: preserve faint grids, reference lines and area-fill alpha.
  for (const fill of ['#ffffff55', '#ffffff65', '#ffffff66']) lines.push('  ' + reports + ' svg text[fill="' + fill + '"]' + guard + ' { fill: rgba(255,255,255,0.8); }');
  lines.push('}'); return lines.join('\n') + '\n';
}
export function omarLedgerTheme({ workspace, app, mode }) { if (app !== 'admin' || !['hassan', 'omar'].includes(mode)) return null; return { name: 'omar-admin-ledger-theme', enforce: 'pre', buildStart() { if (fs.readFileSync(ledgerStylesheet, 'utf8') !== buildLedgerCSS(workspace)) throw Error('Omar ledger stylesheet drift'); }, transform(source, id) { const f = path.relative(workspace, id.split('?')[0]).split(path.sep).join('/'); if (f === 'admin/index.tsx') return { code: source + '\nimport ' + JSON.stringify(ledgerStylesheet) + ';\n', map: null }; const code = ledgerThemeSource(source, f); return code === null ? null : { code, map: null }; } }; }
