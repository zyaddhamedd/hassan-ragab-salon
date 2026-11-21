import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const component=fileURLToPath(new URL('./coupon-artifact.tsx',import.meta.url));
const stylesheet=fileURLToPath(new URL('./coupon-artifact.css',import.meta.url));
const reviewed='57c362f03081e7f600c1c7e612e58dd648741fc900c74b7d16f4881f2528cc55';
export function couponArtifactSource(source,file){
 if(file!=='admin/components/PromoCodesPage.tsx')return null;
 if(createHash('sha256').update(source).digest('hex')!==reviewed)throw Error('Omar coupon source drift');
 const start=source.indexOf('<article key={promo.id}'),end=source.indexOf('</article>)}</div>}',start)+10;
 if(start<0||end<10)throw Error('Omar coupon card boundary drift');
 const original=source.slice(start,end),detailStart=original.indexOf('<dl '),detailEnd=original.indexOf('</dl>')+5;
 if(detailStart<0||detailEnd<5)throw Error('Omar coupon details drift');
 const replacement=`(isDarkMode ? <OmarCouponArtifact key={promo.id} promo={promo} now={now} canManage={canManagePromo(user, promo)} disabled={loading || pending !== null} pending={pending === promo.id} onEdit={() => setModal({ promo })} onToggle={() => mutate(promo, false)} onArchive={() => mutate(promo, true)}>${original.slice(detailStart,detailEnd)}</OmarCouponArtifact> : ${original})`;
 return 'import OmarCouponArtifact from '+JSON.stringify(component)+';\n'+source.slice(0,start)+replacement+source.slice(end);
}
export function omarCouponArtifact({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return{name:'omar-admin-coupon-artifact',enforce:'pre',async resolveId(id,importer){if(importer?.split('?')[0]===component && ['react','react/jsx-runtime','react/jsx-dev-runtime'].includes(id))return this.resolve(id,path.join(workspace,'admin/components/PromoCodesPage.tsx'),{skipSelf:true});},transform(source,id){const file=path.relative(workspace,id.split('?')[0]).split(path.sep).join('/');if(file==='admin/index.tsx')return{code:source+'\nimport '+JSON.stringify(stylesheet)+';\n',map:null};const code=couponArtifactSource(source,file);return code===null?null:{code,map:null};}};
}
