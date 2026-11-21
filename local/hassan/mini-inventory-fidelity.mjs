// Compares every captured computed property; ignores RGB channels, never alpha.
export const normalizeInventoryRGB=value=>value.replace(/rgba?\(([^)]*)\)|color\(srgb ([^)]*)\)/g,(_,rgb,srgb)=>{const raw=rgb??srgb,alpha=raw.includes('/')?raw.split('/')[1]:raw.split(',').length===4?raw.split(',')[3]:'1';return 'COLOR('+Number(alpha).toFixed(6)+')';});
export function compareInventorySnapshots(before,after){
 const mismatches=[],timingSamples=[];const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 if(!same(before.body,after.body))mismatches.push(['body',before.body,after.body]);
 if(!same(before.viewport,after.viewport))mismatches.push(['viewport']);if(before.nodes.length!==after.nodes.length)mismatches.push(['node count',before.nodes.length,after.nodes.length]);
 before.nodes.forEach((b,i)=>{const a=after.nodes[i];if(!a)return;for(const p of ['tag','classes','box','scroll'])if(!same(b[p],a[p]))mismatches.push([i,p,b[p],a[p]]);
 for(const [p,v]of Object.entries(b.style)){if(normalizeInventoryRGB(v)===normalizeInventoryRGB(a.style[p]??''))continue;
 // Record, rather than hide, live animation sampling. Canonical keyframe and
 // animation declarations are separately preserved by unmodified source.
 if(['opacity','transform','rotate'].includes(p)&&b.style['animation-name']&&b.style['animation-name']!=='none'&&b.style['animation-name']===a.style['animation-name'])timingSamples.push([i,p,v,a.style[p]]);
 else mismatches.push([i,p,v,a.style[p]]);
 }});return {nodes:before.nodes.length,mismatches,timingSamples};
}
