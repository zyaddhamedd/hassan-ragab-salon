import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(workspace,'mini/package.json'));
const css=fs.readFileSync(new URL('./mini-theme.css',import.meta.url),'utf8');
const root=require('postcss').parse(css);
const source=['Sidebar.tsx','CashierScreen.tsx','InvoiceSection.tsx','CustomerInfoBadges.tsx']
  .map(p=>fs.readFileSync(path.join(workspace,'mini/components',p),'utf8')).join('\n');

function colorForms(s){
  return s.replace(/rgba?\(([^)]*)\)|color\(srgb ([^)]*)\)/g,(_,rgb,srgb)=>{
    const raw=rgb??srgb;
    const alpha=raw.includes('/')?raw.split('/')[1].trim():raw.split(',').length===4?raw.split(',')[3].trim():'1';
    return 'COLOR('+Number.parseFloat(alpha).toFixed(6)+')';
  });
}

test('strict fidelity forbids effect, border, outline, opacity, layout and typography overrides',()=>{
  const colors=new Set(['background-color','color','border-color','border-top-color','border-right-color','border-bottom-color','border-left-color','fill']);
  const variables=new Set(['--tw-shadow','--tw-shadow-color','--tw-ring-color','--tw-gradient-from','--tw-gradient-to','--omar-mini-red','--omar-mini-lookup-active']);
  root.walkRules(rule=>{
    let parent=rule.parent;while(parent&&!(parent.type==='atrule'&&parent.name==='media'&&parent.params==='screen'))parent=parent.parent;
    assert.ok(parent);
    rule.walkDecls(d=>{
      assert.ok(!d.important);
      assert.ok(colors.has(d.prop)||variables.has(d.prop)||d.prop==='background-image'||(rule.selector==='html[data-omar-mini-theme="foundation"]'&&d.prop.startsWith('--omar-mini-')),d.prop);
      assert.ok(!/\bnone\b/.test(d.value),'No effect resets');
    });
  });
  assert.ok(!/outline|backdrop-filter|box-shadow\s*:|filter\s*:|opacity\s*:/.test(css));
});

test('recolored arbitrary shadows and gradients retain original forms, dimensions, stops and alpha',()=>{
  let shadows=0,images=0;
  root.walkRules(rule=>{
    const token=rule.selector.match(/\[class~="([^"]+)"\]/)?.[1];
    if(!token)return;
    assert.ok(source.includes(token),'Unreviewed source paint class: '+token);
    rule.walkDecls(d=>{
      if(d.prop==='--tw-shadow'){
        const original=token.slice(token.indexOf('shadow-[')+8,-1).replaceAll('_',' ');
        assert.equal(colorForms(d.value).replaceAll(' ',''),colorForms(original).replaceAll(' ',''));shadows++;
      }
      if(d.prop==='background-image'){
        const original=token.slice(token.indexOf('bg-[')+4,-1).replaceAll('_',' ');
        assert.equal(colorForms(d.value).replaceAll(' ',''),colorForms(original).replaceAll(' ',''));images++;
      }
    });
  });
  assert.ok(shadows>=10);assert.equal(images,2);
});

test('original source color alpha and original state precedence are preserved',()=>{
  root.walkRules(rule=>{
    const token=rule.selector.match(/\[class~="([^"]+)"\]/)?.[1];
    if(!token)return;
    const suffix=token.match(/\/(\d+|\[[\d.]+\])$/)?.[1];
    const alpha=suffix?(suffix.startsWith('[')?Number(suffix.slice(1,-1))*100:Number(suffix)):null;
    rule.walkDecls(d=>{
      if(['--tw-shadow','background-image'].includes(d.prop))return;
      if(d.prop==='--tw-gradient-to'&&token.startsWith('from-')){
        assert.ok(d.value.includes(' 0%, transparent)'),'Original implicit transparent gradient endpoint');return;
      }
      if(alpha!==null)assert.ok(d.value.includes(' '+alpha+'%, transparent)'),token+' alpha changed');
      else assert.ok(!d.value.includes('color-mix('),token+' became translucent');
    });
    if(token.startsWith('hover:'))assert.ok(rule.selectors.every(s=>s.endsWith(':hover')));
    if(token.startsWith('focus-within:'))assert.ok(rule.selectors.every(s=>s.endsWith(':focus-within')));
  });
  const pos=[];root.walkRules(r=>{if(r.selector.includes('[data-omar-mini-pos]'))pos.push(r.toString());});
  const posCSS=pos.join('\n');
  assert.ok(posCSS.indexOf('[class~="focus-within:border-')<posCSS.indexOf('[class~="hover:border-'));
  assert.ok(posCSS.indexOf('[class~="group-focus-within:text-')<posCSS.indexOf('[class~="group-hover:text-'));
  assert.match(css,/--omar-mini-lookup-active: color-mix\(in srgb, var\(--omar-mini-text\) 8%, transparent\)/);
});

// Optional acceptance test of the live DOM snapshots, saved under ignored local
// evidence. RGB channels may change; alpha, effect forms and every other sampled
// computed property must match. No browser or application is imported here.
if(process.env.OMAR_FIDELITY_EVIDENCE){
  const directory=fs.realpathSync(process.env.OMAR_FIDELITY_EVIDENCE);
  assert.ok(directory.startsWith(workspace+'/.local/hassan/'));
  const original=JSON.parse(fs.readFileSync(path.join(directory,'original-computed.json'),'utf8'));
  const corrected=JSON.parse(fs.readFileSync(path.join(directory,'corrected-computed.json'),'utf8'));
  for(const [state,before] of Object.entries(original))test('live computed visual fidelity: '+state,()=>{
    const after=corrected[state];assert.ok(after);
    assert.deepEqual(after.viewport,before.viewport);
    assert.equal(after.nodes.length,before.nodes.length);
    before.nodes.forEach((node,i)=>{
      for(const field of ['tag','classes','box','scroll'])assert.deepEqual(after.nodes[i][field],node[field],state+' '+i+' '+field);
      for(const [property,value] of Object.entries(node.style))assert.equal(colorForms(after.nodes[i].style[property]),colorForms(value),state+' '+i+' '+property);
    });
  });
}
