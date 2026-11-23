// Omar-only, attribute-only screen hooks and deterministic color stylesheet.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const operationalStylesheet=fileURLToPath(new URL('./mini-operational-theme.css',import.meta.url));
export const operationalScreens={
  waiting:'mini/components/WaitingScreen.tsx',
  customers:'mini/components/CustomersScreen.tsx',
  barbers:'mini/components/BarbersScreen.tsx',
  appointments:'mini/components/AppointmentsScreen.tsx',
  attendance:'mini/components/AttendanceScreen.tsx',
  expenses:'mini/components/ExpensesScreen.tsx',
  treasury:'mini/pages/MiniTreasuryPage.tsx',
};
export const operationalHooks=Object.fromEntries(Object.entries(operationalScreens).map(([screen,file])=>[
  file, screen==='waiting'
    ? [['<div className="flex flex-col h-full bg-[#121212]','<div data-omar-mini-screen="waiting" className="flex flex-col h-full bg-[#121212]',1]]
    : screen==='attendance'
      ? [['<div\n      className="mini-screen','<div data-omar-mini-screen="attendance"\n      className="mini-screen',1]]
      : [['<div className="mini-screen','<div data-omar-mini-screen="'+screen+'" className="mini-screen',screen==='treasury'?4:1]],
]));
// Decorative assistant identity is an accent; deduction/cancel/delete stays red.
operationalHooks[operationalScreens.barbers].push(
  ['<div className="p-3 bg-[#E53935]/10 rounded-2xl">','<div data-omar-mini-color-role="accent" className="p-3 bg-[#E53935]/10 rounded-2xl">',1],
  ['className="rounded-[2rem] p-6 border border-white/5 bg-[#1E1E1E]/60','data-omar-mini-color-role="accent" className="rounded-[2rem] p-6 border border-white/5 bg-[#1E1E1E]/60',1],
);
operationalHooks[operationalScreens.attendance].push(
  ['<div className={`w-20 h-20 rounded-full','<div data-omar-mini-attendance-avatar="neutral" className={`w-20 h-20 rounded-full',1],
);

// Reviewed source paint inventory. Unknown/new classes require deliberate review.
export const reviewedOperationalPaint = /* REVIEWED_PAINT */ {
  "mini/components/WaitingScreen.tsx": "2d2903b47c46fe7642ba6d26d4244bcf0f60a560db2f1e57ccd17c801728f817",
  "mini/components/CustomersScreen.tsx": "c2a9ac67c2a2c8d22fa9dcc6805dfd7dad23ee75e7fa1ee5fc9c3ce25f808de8",
  "mini/components/BarbersScreen.tsx": "48e138600282e39f96db7476b7fce75294b5178c8f1e9e8eda85e76ceb69c726",
  "mini/components/AppointmentsScreen.tsx": "df982a84638d4c9351570e0955a058923af121950cb706ab9ace57bdaa8c9724",
  "mini/components/AttendanceScreen.tsx": "12525f0f1a574d2ffe56b66e3a92e693ce9eaf0b14a060ac5f2de7333b6c05bb",
  "mini/components/ExpensesScreen.tsx": "0930f5cb33002ed7a4dc4b0937140c1845d94ba6b77d771123df16bcc14e65ca",
  "mini/pages/MiniTreasuryPage.tsx": "717e71ac5ac274f28b3e6d81bbf17bb173a4165395aea158d518f489a9d041c3"
};
const paintPattern=/(?<![\w:-])(?:(?:[\w-]+):)*(?:bg|text|border(?:-[lrtbxy])?|from|via|to|shadow|drop-shadow|ring|fill|placeholder:text)-(?:\[[^\]\s]+\]|white|black|transparent|current|(?:amber|yellow|emerald|green|red|rose|blue|gray|slate|violet|purple)-\d+)(?:\/(?:\d+|\[[\d.]+\]))?/g;
export const paintClasses=source=>[...new Set(source.match(paintPattern)||[])].sort();
export const paintDigest=source=>createHash('sha256').update(JSON.stringify(paintClasses(source))).digest('hex');

export function operationalThemeSource(source,relative){
  const hooks=operationalHooks[relative];if(!hooks)return null;
  if(paintDigest(source)!==reviewedOperationalPaint[relative])throw Error('Omar operational paint inventory drift: '+relative);
  let code=source;
  for(const [before,after,count] of hooks){
    if(code.includes(after)||code.split(before).length!==count+1)throw Error('Omar operational theme hook drift: '+relative);
    code=code.replaceAll(before,after);
  }
  return code;
}

const palette={
  '#121212':'page','#1a1a1a':'card','#1e1e1e':'surface','#1c1c1c':'surface',
  '#252525':'card','#2a2a2a':'card','#333':'selected','#383838':'selected',
  '#e6d690':'accent','#ffed9e':'hover','#d4c47d':'pressed','#e53935':'operational-red, var(--omar-mini-error)',
  '#f5f5f5':'text','#bdbdbd':'text-secondary','#666':'text-muted',
  white:'text',black:'page',
};
const token=name=>'var(--omar-mini-'+name+')';
const mix=(a,pct,b)=>`color-mix(in srgb, ${a} ${pct}%, ${b})`;
const families={red:'error',rose:'error',emerald:'success',green:'success',amber:'warning',yellow:'warning',blue:'info'};
export function paintColor(raw,alpha,kind){
  const value=raw.toLowerCase();let color;
  if(kind==='text'&&['#121212','black'].includes(value))color=token('on-accent');
  else if(palette[value])color=token(palette[value]);
  else if(/^gray-\d+$/.test(value))color=token(Number(value.split('-')[1])<=400?'text-secondary':'text-muted');
  else if(/^(red|rose|emerald|green|amber|yellow|blue)-\d+$/.test(value)){
    const [family,shadeString]=value.split('-'),shade=Number(shadeString),base=token(families[family]);
    color=shade<400?mix(base,75,token('text')):shade===400?base:mix(base,Math.max(20,100-(shade-400)*0.15),token('page'));
  }else{
    const dark={ '#08120e':['success',8],'#050807':['success',3],'#0a1a12':['success',12],
      '#1a0d0d':['error',12],'#0f0808':['error',5],'#1a0a0a':['error',12] }[value];
    if(dark)color=mix(token(dark[0]),dark[1],token('page'));
  }
  if(!color)return null; // Financial violet/Instapay remains deliberately distinct.
  if(alpha!==undefined){const pct=alpha.startsWith('[')?Number(alpha.slice(1,-1))*100:Number(alpha);color=mix(color,pct,'transparent');}
  return color;
}
function recolorEffects(value,screen){
  const rgb={ '230,214,144':'168,144,106','229,57,53':'223,146,144',
    '16,185,129':'121,182,155','239,68,68':'223,146,144','255,255,255':'243,244,242' };
  if(screen==='attendance'){
    // Preserve every effect dimension and alpha; remove the broad semantic tint
    // by changing only its RGB channels to the existing neutral card token.
    rgb['16,185,129']=rgb['239,68,68']='26,26,31';
  }
  return value.replace(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g,(all,r,g,b,a)=>
    rgb[[r,g,b].join(',')]?'rgba('+rgb[[r,g,b].join(',')]+','+a+')':all)
    .replace(/#e6d690\b/gi,'#A8906A').replace(/#10b981\b/gi,screen==='attendance'?'#1A1A1F':'#22C55E').replace(/#ef4444\b/gi,screen==='attendance'?'#1A1A1F':'#EF4444');
}
// Local to Attendance: never change the shared approved cashier palette.
export const attendanceContrast={card:'#1A1A1F',present:'#22C55E',absent:'#EF4444',secondary:'#B3B3BD'};
export const attendanceActionColors={present:{from:'#15803D',to:'#166534'},absent:{from:'#DC2626',to:'#991B1B'}};
function attendanceColor(base,alpha,kind){
  const value=base.toLowerCase();let color;
  if(['#08120e','#1a0d0d'].includes(value))color=attendanceContrast.card;
  else if(['#050807','#0f0808'].includes(value))color=token('page');
  else if(['#0a1a12','#1a0a0a'].includes(value))color=attendanceContrast.card;
  else if(value==='#1e1e1e'&&kind==='bg')color=token('input');
  else if(value==='#bdbdbd'&&kind==='text')color=token('secondary');
  else if(value==='#e6d690'&&kind==='text'&&alpha==='50')color=token('secondary');
  else if(value==='white'&&kind==='bg'&&alpha==='[0.03]')color=token('page');
  else if(/^(red|emerald)-(500|600|700|800|900)$/.test(value)){
    const absent=value.startsWith('red-'),semantic=absent?attendanceContrast.absent:attendanceContrast.present;
    // Keep light action text above 4.5:1 at the brightest gradient endpoint.
    if(kind==='from')color=attendanceActionColors[absent?'absent':'present'].from;
    else if(kind==='to')color=attendanceActionColors[absent?'absent':'present'].to;
    else if(kind==='text')color=mix(semantic,absent?70:80,token('text'));
    else if(kind==='shadow')color=token('card');
    else color=mix(semantic,65,token('selected'));
  }
  if(!color)return paintColor(base,alpha,kind);
  if(alpha!==undefined){const pct=alpha.startsWith('[')?Number(alpha.slice(1,-1))*100:Number(alpha);color=mix(color,pct,'transparent');}
  return color;
}
export function operationalPaint(tokenClass,screen){
  let rest=tokenClass,variant='';
  for(const v of ['group-focus-within','group-hover','focus-within','hover','focus','disabled']){
    if(rest.startsWith(v+':')){variant=v;rest=rest.slice(v.length+1);break;}
  }
  let kind,value;
  if(rest.startsWith('placeholder:text-')){kind='placeholder';value=rest.slice(17);}
  else{const m=rest.match(/^(drop-shadow|border-[lrtbxy]|bg|text|border|from|via|to|shadow|ring|fill)-(.+)$/);if(!m)return null;[,kind,value]=m;}
  if(value.startsWith('[')&&value.endsWith(']')&&['bg','shadow','drop-shadow'].includes(kind)){
    const original=value.slice(1,-1).replaceAll('_',' '),colored=recolorEffects(original,screen);
    if(original!==colored){
      if(kind==='shadow')return {variant,declarations:{'--tw-shadow':colored},originalEffect:original};
      if(kind==='drop-shadow')return {variant,declarations:{'--tw-drop-shadow':'drop-shadow('+colored+')'},originalEffect:'drop-shadow('+original+')'};
      if(original.includes('gradient('))return {variant,declarations:{'background-image':colored},originalEffect:original};
    }
  }
  const match=value.match(/^(\[[^\]]+\]|[^/]+)(?:\/(\d+|\[[\d.]+\]))?$/);if(!match)return null;
  let [,base,alpha]=match;if(base.startsWith('['))base=base.slice(1,-1);
  const resolveColor=screen==='attendance'?attendanceColor:paintColor;
  const color=resolveColor(base,alpha,['text','placeholder'].includes(kind)?'text':kind);if(!color)return null;
  if(kind==='from')return {variant,declarations:{'--tw-gradient-from':color+' var(--tw-gradient-from-position)','--tw-gradient-to':resolveColor(base,'0',kind)+' var(--tw-gradient-to-position)'}};
  if(kind==='to')return {variant,declarations:{'--tw-gradient-to':color+' var(--tw-gradient-to-position)'}};
  const prop={bg:'background-color',text:'color',placeholder:'color',border:'border-color','border-t':'border-top-color','border-r':'border-right-color','border-b':'border-bottom-color','border-l':'border-left-color',shadow:'--tw-shadow-color',ring:'--tw-ring-color',fill:'fill'}[kind];
  return prop?{variant,declarations:{[prop]:color}}:null;
}

export function buildOperationalCSS(workspace){
  const lines=['/* Omar operational screens: RGB-only original paint semantics. Generated from reviewed source classes. */','@media screen {'];
  const order={'':0,'focus-within':1,hover:2,focus:3,disabled:4,'group-focus-within':5,'group-hover':6};
  const excluded=':not(:where(.print-template,.print-template *,.deposit-print,.deposit-print *,.receipt-print,.receipt-print *,.no-print,.no-print *,.omar-logo-slot,.omar-logo-slot *))';
  for(const [screen,file] of Object.entries(operationalScreens)){
    const source=fs.readFileSync(path.join(workspace,file),'utf8');
    if(paintDigest(source)!==reviewedOperationalPaint[file])throw Error('Omar operational paint inventory drift: '+file);
    const scope='html[data-omar-mini-theme="foundation"] [data-omar-mini-shell] [data-omar-mini-screen="'+screen+'"]';
    const rules=paintClasses(source).map(c=>[c,operationalPaint(c,screen)]).filter(([,p])=>p).sort((a,b)=>order[a[1].variant]-order[b[1].variant]||a[0].localeCompare(b[0],'en'));
    for(const [className,{variant,declarations}] of rules){
      const attr='[class~="'+className+'"]';let selectors;
      if(variant.startsWith('group-'))selectors=[scope+' .group:'+variant.slice(6)+' '+attr+excluded];
      else{
        const suffix=(variant?':'+variant:'')+(className.startsWith('placeholder:')?'::placeholder':'');
        selectors=[scope+' '+attr+excluded+suffix];
        // Do not recolor root foreground: protected receipt descendants retain
        // their canonical inherited foreground, even on screen.
        if(!('color' in declarations)&&!('fill' in declarations))selectors.unshift(scope+attr+suffix);
      }
      lines.push('  '+selectors.join(',\n  ')+' { '+Object.entries(declarations).map(([p,v])=>p+': '+v+';').join(' ')+' }');
    }
  }
  lines.push('  html[data-omar-mini-theme="foundation"] [data-omar-mini-shell] [data-omar-mini-screen="barbers"] [data-omar-mini-color-role="accent"] { --omar-mini-operational-red: var(--omar-mini-accent); }',
    '  html[data-omar-mini-theme="foundation"] [data-omar-mini-shell] [data-omar-mini-screen="attendance"] [data-omar-mini-attendance-avatar="neutral"] { color: var(--omar-mini-accent); border-color: color-mix(in srgb, '+attendanceContrast.secondary+' 40%, transparent); }','}');
  return lines.join('\n')+'\n';
}

export function omarOperationalTheme({workspace,app,mode}){
  if(app!=='mini'||!['hassan', 'omar'].includes(mode))return null;
  return {name:'omar-mini-operational-theme',enforce:'pre',
    buildStart(){if(fs.readFileSync(operationalStylesheet,'utf8')!==buildOperationalCSS(workspace))throw Error('Omar operational stylesheet drift; regenerate after review');},
    transform(source,id){
      const relative=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');
      if(relative==='mini/index.tsx')return {code:source+'\nimport '+JSON.stringify(operationalStylesheet)+';\n',map:null};
      const code=operationalThemeSource(source,relative);return code===null?null:{code,map:null};
    },
  };
}
