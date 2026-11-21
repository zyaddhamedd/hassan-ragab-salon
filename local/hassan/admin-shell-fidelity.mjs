// Compare every recorded standard property, normalizing RGB channels only.
export function normalizeAdminRGB(value){return value.replace(/rgba?\(([^)]*)\)|color\(srgb ([^)]*)\)/g,(_,rgb,srgb)=>{const raw=rgb??srgb;let a=raw.includes('/')?raw.split('/')[1].trim():raw.split(',').length===4?raw.split(',')[3].trim():'1';a=a.endsWith('%')?Number.parseFloat(a)/100:Number(a);return 'COLOR('+a.toFixed(6)+')';});}
export function compareAdminShell(before,after,{light=false}={}){
 const differences=[];for(const p of ['viewport','document','scroll'])if(JSON.stringify(before[p])!==JSON.stringify(after[p]))differences.push({property:p,before:before[p],after:after[p]});
 if(before.nodes.length!==after.nodes.length)differences.push({property:'node-count',before:before.nodes.length,after:after.nodes.length});
 before.nodes.forEach((b,i)=>{const a=after.nodes[i];if(!a)return;for(const p of ['tag','cls','box','scroll'])if(JSON.stringify(b[p])!==JSON.stringify(a[p]))differences.push({i,property:p,before:b[p],after:a[p]});const style=Object.fromEntries(a.style);for(const[p,v]of b.style){const convert=light||b.protected?x=>x:normalizeAdminRGB;if(convert(v)!==convert(style[p]??''))differences.push({i,property:p,before:v,after:style[p]});}});return differences;
}
