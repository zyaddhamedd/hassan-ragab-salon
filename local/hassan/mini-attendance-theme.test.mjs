import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {operationalPaint,paintClasses,operationalScreens,operationalThemeSource,attendanceContrast,attendanceActionColors} from './mini-operational-theme.mjs';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(workspace,'mini/package.json'));
const root=require('postcss').parse(fs.readFileSync(new URL('./mini-operational-theme.css',import.meta.url),'utf8'));
const source=fs.readFileSync(path.join(workspace,operationalScreens.attendance),'utf8');
const forms=s=>s.replace(/rgba?\(([^)]*)\)|color\(srgb ([^)]*)\)/g,(_,rgb,srgb)=>{
  const raw=rgb??srgb,a=raw.includes('/')?raw.split('/')[1]:raw.split(',').length===4?raw.split(',')[3]:'1';
  return 'COLOR('+Number(a).toFixed(6)+')';
}).replace(/#[\da-f]{3,8}\b/gi,'COLOR(1.000000)');

test('attendance card gradient stops are identical neutral tokens for PRESENT and ABSENT',()=>{
  for(const [a,b] of [['from-[#08120E]','from-[#1A0D0D]'],['to-[#050807]','to-[#0F0808]']])
    assert.deepEqual(operationalPaint(a,'attendance'),operationalPaint(b,'attendance'));
  assert.match(operationalPaint('from-[#08120E]','attendance').declarations['--tw-gradient-from'],/#2B3C45/);
  assert.match(operationalPaint('to-[#050807]','attendance').declarations['--tw-gradient-to'],/mini-page/);
  for(const c of ['bg-[#0A1A12]','bg-[#1A0A0A]'])assert.equal(operationalPaint(c,'attendance').declarations['background-color'],attendanceContrast.card);
});

test('attendance buttons use stronger semantic gradient colors; original alpha/effect forms stay exact',()=>{
  const green=operationalPaint('from-emerald-500','attendance').declarations['--tw-gradient-from'];
  const red=operationalPaint('from-red-600','attendance').declarations['--tw-gradient-from'];
  assert.match(green,/#15803D/);
  assert.match(red,/#C81E1E/);
  for(const c of paintClasses(source)){
    const paint=operationalPaint(c,'attendance');if(!paint)continue;
    const suffix=c.match(/\/(\d+|\[[\d.]+\])$/)?.[1];
    for(const [p,value] of Object.entries(paint.declarations)){
      if(paint.originalEffect){assert.equal(forms(value).replaceAll(' ',''),forms(paint.originalEffect).replaceAll(' ',''));continue;}
      if(p==='--tw-gradient-to'&&c.startsWith('from-')){assert.ok(value.includes(' 0%, transparent)'));continue;}
      if(suffix){const alpha=suffix.startsWith('[')?Number(suffix.slice(1,-1))*100:Number(suffix);assert.ok(value.includes(' '+alpha+'%, transparent)'),c);}
    }
  }
  assert.equal(operationalPaint('text-[#BDBDBD]','attendance').declarations.color,'#FFFFFF');
});

test('avatar hook changes only an attribute; uploaded image selection and attendance logic remain byte-identical',()=>{
  const themed=operationalThemeSource(source,operationalScreens.attendance);
  assert.equal(themed.replace(' data-omar-mini-screen="attendance"','').replace(' data-omar-mini-attendance-avatar="neutral"',''),source);
  assert.ok(themed.includes('<img src={avatarSrc} alt={emp.name} className="w-full h-full object-cover rounded-full" />'));
  assert.ok(themed.includes('onClick={onToggle}'));
  const rule=root.nodes.find(n=>n.type==='atrule').nodes.find(n=>n.type==='rule'&&n.selector.includes('[data-omar-mini-attendance-avatar="neutral"]'));
  assert.deepEqual(rule.nodes.map(d=>d.prop),['color','border-color']);
  assert.match(rule.toString(),/#B8C5CB 40%, transparent/);
});

test('all six other operational screen rules are byte-identical to the approved Phase 4B.3 output',()=>{
  const rules=[];root.walkRules(r=>{if(!r.selector.includes('data-omar-mini-screen="attendance"'))rules.push(r.toString());});
  assert.equal(createHash('sha256').update(rules.join('\n')).digest('hex'),'fb16f84dc4ad38f3b03a1a02b80459b38fc812c3b04eb60a9a0efeb61b61ac9d');
});

test('stronger action and status RGB choices retain normal-text contrast without changing alpha',()=>{
  const hex=s=>s.replace('#','').match(/../g).map(x=>parseInt(x,16));
  const blend=(a,p,b)=>a.map((x,i)=>x*p+b[i]*(1-p));
  const luminance=c=>c.map(x=>{const v=x/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[0.2126,0.7152,0.0722][i],0);
  const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+0.05)/(Math.min(luminance(a),luminance(b))+0.05);
  const paletteCSS=fs.readFileSync(new URL('./mini-theme.css',import.meta.url),'utf8');
  const shared=name=>hex(paletteCSS.match(new RegExp('--omar-mini-'+name+': (#[0-9A-F]+);'))[1]);
  const card=hex(attendanceContrast.card),text=shared('text');
  for(const [name,badgeMix] of [['present',0.8],['absent',0.7]]){
    const semantic=hex(attendanceContrast[name]);
    assert.ok(contrast(text,hex(attendanceActionColors[name].from))>=4.5,name+' action top');
    assert.ok(contrast(text,hex(attendanceActionColors[name].to))>=4.5,name+' action bottom');
    assert.ok(contrast(blend(semantic,badgeMix,text),blend(shared('page'),0.03,card))>=4.5,name+' status label');
  }
  // Existing 30% role opacity cannot meet normal-text contrast through RGB alone.
  assert.ok(contrast(blend([255,255,255],0.3,card),card)<4.5);
});

if(process.env.OMAR_ATTENDANCE_EVIDENCE){
  const directory=fs.realpathSync(process.env.OMAR_ATTENDANCE_EVIDENCE);assert.ok(directory.startsWith(workspace+'/.local/hassan/'));
  const before=JSON.parse(fs.readFileSync(path.join(directory,'before-computed.json'),'utf8'));
  const after=JSON.parse(fs.readFileSync(path.join(directory,'after-computed.json'),'utf8'));
  if(fs.existsSync(path.join(directory,'contrast-audit.json')))test('live critical text meets contrast thresholds; fixed-alpha failures are explicitly retained',()=>{
    const audit=JSON.parse(fs.readFileSync(path.join(directory,'contrast-audit.json'),'utf8'));
    const colors=JSON.parse(fs.readFileSync(path.join(directory,'rendered-colors.json'),'utf8'));
    for(const card of audit.after.cards){
      assert.ok(card.nameMinimum>=4.5);assert.ok(card.buttonMinimum>=4.5);assert.ok(card.badgeMinimum>=4.5);
      assert.equal(card.roleOpacity,'0.3');assert.ok(card.roleMinimum<4.5,'Document existing opacity limitation');
    }
    assert.ok(audit.after.countsMinimum>=4.5);
    assert.ok(audit.after.placeholderMinimum<4.5,'Document existing placeholder limitation');
    assert.deepEqual(colors.after.placeholder,colors.before.placeholder);
    assert.equal(colors.after.placeholder.color,'rgba(255, 255, 255, 0.2)');
    assert.ok(audit.after.cards[0].cardPageMaximum>audit.before.cards[0].cardPageMaximum);
  });
  for(const [state,b] of Object.entries(before))test('attendance live non-RGB fidelity: '+state,()=>{
    const a=after[state];assert.deepEqual(a.viewport,b.viewport);assert.equal(a.nodes.length,b.nodes.length);
    b.nodes.forEach((n,i)=>{
      for(const p of ['tag','classes','box','scroll'])assert.deepEqual(a.nodes[i][p],n[p],state+' '+i+' '+p);
      for(const [p,v] of Object.entries(n.style))assert.equal(forms(a.nodes[i].style[p]),forms(v),state+' '+i+' '+p);
    });
  });
}
