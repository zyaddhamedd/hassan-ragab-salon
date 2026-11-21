import path from 'node:path';import{fileURLToPath}from'node:url';
export const textContrastStylesheet=fileURLToPath(new URL('./mini-text-contrast.css',import.meta.url));
export function omarTextContrast({workspace,app,mode}){
 if(app!=='mini'||!['hassan', 'omar'].includes(mode))return null;
 return {name:'omar-mini-text-contrast',enforce:'pre',async configureServer(server){const{qualityFixtureMiddleware}=await import('./mini-quality-visual-fixture.mjs');qualityFixtureMiddleware(server);},transform(source,id){
 if(path.relative(workspace,id.split('?')[0]).split(path.sep).join('/')==='mini/index.tsx')return{code:source+'\nimport '+JSON.stringify(textContrastStylesheet)+';\n',map:null};
 }};
}
