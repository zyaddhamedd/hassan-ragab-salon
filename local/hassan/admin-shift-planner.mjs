import path from 'node:path';
import {fileURLToPath} from 'node:url';
const component=fileURLToPath(new URL('./admin-shift-planner.tsx',import.meta.url));
export function plannerSource(source,file,workspace){
 if(file!=='admin/components/AdminAttendanceDashboard.tsx')return null;
 const anchor='export default AdminAttendanceDashboard;';
 if(source.split(anchor).length!==2||source.includes('OmarAttendanceWorkspace'))throw Error('Omar Attendance planner source drift');
 return `import OmarAttendanceWorkspace from ${JSON.stringify(component)};\nimport {getCurrentUser as omarPlannerManager} from ${JSON.stringify(path.join(workspace,'admin/api/auth.ts'))};\n`+source.replace(anchor,`export default function OmarAttendancePage(props: AdminAttendanceDashboardProps){return <OmarAttendanceWorkspace {...props} Attendance={AdminAttendanceDashboard} user={omarPlannerManager()} api={adminApi}/>;}`);
}
export function omarShiftPlanner({workspace,app,mode}){
 if(app!=='admin'||!['hassan', 'omar'].includes(mode))return null;
 return {name:'omar-admin-shift-planner',enforce:'pre',async resolveId(id,importer){if(importer?.split('?')[0]===component&&['react','react/jsx-runtime','react/jsx-dev-runtime'].includes(id))return this.resolve(id,path.join(workspace,'admin/components/AdminAttendanceDashboard.tsx'),{skipSelf:true});},transform(source,id){const code=plannerSource(source,path.relative(workspace,id.split('?')[0]).split(path.sep).join('/'),workspace);return code===null?null:{code,map:null};}};
}
