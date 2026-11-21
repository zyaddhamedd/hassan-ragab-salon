import{compareAdminShell}from'./admin-shell-fidelity.mjs';
const timelines=['animation-name','animation-duration','animation-delay','animation-timing-function','animation-iteration-count','animation-direction','animation-fill-mode','animation-play-state','transform-origin'];
const known=new Set(['auraMove','energyFlow','pulseStatus','ping','pulse','spin']);
export function compareDashboardSnapshots(before,after,{light=false}={}){
 const raw=compareAdminShell(before,after,{light}),temporal=[],staticDifferences=[];
 for(const d of raw){const b=before.nodes[d.i],a=after.nodes[d.i],bs=Object.fromEntries(b?.style||[]),as=Object.fromEntries(a?.style||[]);
 const sameTimeline=timelines.every(p=>bs[p]===as[p]);const animated=known.has(bs['animation-name'])&&sameTimeline;
 if(['box','transform','opacity'].includes(d.property)&&animated){temporal.push({...d,reason:'Different time on unchanged '+bs['animation-name']+' timeline'});continue;}
 if(d.property==='scroll'&&b&&a&&JSON.stringify(b.scroll.slice(2))===JSON.stringify(a.scroll.slice(2))&&b.box===a.box&&before.nodes.some(n=>known.has(Object.fromEntries(n.style)['animation-name']))){temporal.push({...d,reason:'Clipped decorative-animation overflow extent; scroll position and layout box unchanged'});continue;}
 // Preserve these raw path samples. Original Recharts animation props and static
 // complete-state paths/data are separately checked, never rewritten for QA.
 if(d.property==='d'&&b?.cls.includes('recharts-area')&&JSON.stringify(before.texts)===JSON.stringify(after.texts)){temporal.push({...d,reason:'Recharts JS path interpolation; see separate complete-state path/data assertions'});continue;}
 staticDifferences.push(d);
 }
 return{rawDifferences:raw,temporalDifferences:temporal,staticDifferences};
}
