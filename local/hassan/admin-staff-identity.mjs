import path from 'node:path';
import {fileURLToPath} from 'node:url';
const component=fileURLToPath(new URL('./admin-staff-identity.tsx',import.meta.url));
export function staffUISource(source,file,workspace){
 if(file!=='admin/components/EmployeeDetailsPage.tsx')return null;
 const anchor='<div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 lg:p-8 w-full overscroll-contain" ref={contentScrollRef}>';
 if(source.split(anchor).length!==2||source.includes('<OmarStaffIdentity'))throw Error('Omar Staff UI source drift');
 return `import OmarStaffIdentity from ${JSON.stringify(component)};\nimport {getCurrentUser as omarStaffManager} from ${JSON.stringify(path.join(workspace,'admin/api/auth.ts'))};\n`+source.replace(anchor,anchor+'\n<OmarStaffIdentity key={employee.id} employeeId={employee.id} dark={isDarkMode} role={omarStaffManager()?.role} api={adminApi} />');
}
export function omarStaffIdentityUI({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return {name:'omar-admin-staff-identity',enforce:'pre',async resolveId(id,importer){if(importer?.split('?')[0]===component&&['react','react/jsx-runtime','react/jsx-dev-runtime'].includes(id))return this.resolve(id,path.join(workspace,'admin/components/EmployeeDetailsPage.tsx'),{skipSelf:true});},transform(source,id){const code=staffUISource(source,path.relative(workspace,id.split('?')[0]).split(path.sep).join('/'),workspace);return code===null?null:{code,map:null};}};
}
