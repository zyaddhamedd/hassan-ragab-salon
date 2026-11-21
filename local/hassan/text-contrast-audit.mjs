// Computed sRGB colors and alpha compositing. Gradient-stop bounds are conservative.
export function parseColor(value){
 if(value==='transparent')return[0,0,0,0];
 const raw=value.match(/^(rgba?|color)\((.*)\)$/);if(!raw)throw Error('Unsupported computed color: '+value);
 const srgb=raw[1]==='color',v=raw[2].replace(/^srgb /,'').split(/[\s,/]+/).filter(Boolean).map(Number);
 return[v[0]*(srgb?255:1),v[1]*(srgb?255:1),v[2]*(srgb?255:1),v[3]??1];
}
export const blend=(foreground,background)=>foreground.slice(0,3).map((v,i)=>v*foreground[3]+background[i]*(1-foreground[3]));
const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
export const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
export function auditText(text){
 let backgrounds=[[255,255,255]];
 for(const layer of [...text.chain].reverse()){
  const color=parseColor(layer.bg);backgrounds=backgrounds.map(bg=>blend(color,bg));
  if(layer.image!=='none'){
   const colors=layer.image.match(/rgba?\([^)]*\)|color\(srgb [^)]*\)/g);if(!colors)throw Error('Unsupported gradient: '+layer.image);
   backgrounds=backgrounds.flatMap(bg=>colors.map(c=>blend(parseColor(c),bg)));
  }
 }
 const foreground=parseColor(text.fg);foreground[3]*=text.chain.reduce((n,c)=>n*Number(c.opacity),1)*(text.pseudo?Number(text.pseudoOpacity):1);
 return {text:text.text,cls:text.cls,pseudo:text.pseudo,minRatio:Math.min(...backgrounds.map(bg=>contrast(blend(foreground,bg),bg))),backgrounds,foreground,ancestorOpacityException:text.chain.slice(1).some(c=>c.opacity!=='1')};
}
