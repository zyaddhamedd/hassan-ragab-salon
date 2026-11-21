// Reuses the isolated Cashier fixture; compares snapshots in the SAME browser.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {buildFixture}=require('./cashier-studio.browser.cjs');
const out=process.env.OMAR_DND_PERF_DIR || '/private/tmp/omar-dnd-polish';
async function main(){
 const label=process.env.OMAR_DND_PERF_LABEL || 'before';const directory=path.join(out,label);fs.mkdirSync(directory,{recursive:true});
 await buildFixture(directory,{inlineSourcePath:process.env.OMAR_DND_SOURCE,cssSourcePath:process.env.OMAR_DND_CSS,instrument:true});
 const server=http.createServer((req,res)=>{const pathname=req.url.split('?')[0];if(pathname==='/favicon.ico'){res.writeHead(204).end();return}const file=path.join(directory,pathname==='/'?'index.html':path.basename(pathname));if(!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');let browser;
 try{
 browser=await chromium.launch({channel:'chrome',headless:true});const runs=[];
 for(let run=0;run<3;run++){
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
 await page.addInitScript(()=>{
 const probe=window.__dndProbe={active:false,renders:0,rects:0,rectMs:0,events:[],frames:[],longTasks:[],anchor:null};
 const rect=Element.prototype.getBoundingClientRect;Element.prototype.getBoundingClientRect=function(){if(!probe.active)return rect.call(this);const start=performance.now();const result=rect.call(this);probe.rects++;probe.rectMs+=performance.now()-start;return result};
 const setImage=DataTransfer.prototype.setDragImage;DataTransfer.prototype.setDragImage=function(element,x,y){const r=rect.call(element);probe.anchor={x,y,pointerX:probe.startX-r.left,pointerY:probe.startY-r.top};return setImage.call(this,element,x,y)};
 document.addEventListener('dragstart',event=>{probe.active=true;probe.startX=event.clientX;probe.startY=event.clientY;probe.started=performance.now();probe.lastFrame=performance.now();requestAnimationFrame(function frame(time){if(!probe.active)return;probe.frames.push(time-probe.lastFrame);probe.lastFrame=time;requestAnimationFrame(frame)})},true);
 document.addEventListener('drop',()=>{probe.pointerRenders=probe.renders},true);
 document.addEventListener('dragover',()=>{if(probe.active)probe.events.push(performance.now())},true);
 if(window.PerformanceObserver)new PerformanceObserver(list=>{if(probe.active)probe.longTasks.push(...list.getEntries().filter(e=>e.startTime>=probe.started).map(e=>e.duration))}).observe({type:'longtask',buffered:false});
 });
 const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);await page.getByText('خدمات الشعر',{exact:true}).click();await page.evaluate(()=>{window.fixture.catalog.categories[0].services=Array.from({length:500},(_,i)=>({id:1000+i,name:'خدمة تجريبية '+i,price:100,has_assistant:false}));const ch=new BroadcastChannel('salon_data_sync');ch.postMessage({type:'REFETCH_DATA'});ch.close()});await page.getByRole('button').filter({hasText:'خدمة تجريبية 499'}).waitFor();
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 const normalStart=await metrics();await page.locator('[role="grid"]').evaluate(el=>{el.scrollTop=960});await page.waitForTimeout(80);await page.locator('[role="grid"]').evaluate(el=>{el.scrollTop=0});await page.waitForTimeout(80);const normalEnd=await metrics();
 const open=Date.now();await page.keyboard.press('Control+Shift+F2');await page.locator('[data-inline-handle="1499"]').waitFor();const editMs=Date.now()-open;
 const start=await metrics();const box=await page.locator('[data-inline-handle="1499"]').boundingBox(),target=await page.locator('[data-inline-item="1489"]').boundingBox();
 await page.mouse.move(box.x+10,box.y+10);await page.mouse.down();await page.mouse.move(box.x-20,box.y+35,{steps:5});
 for(let step=1;step<=45;step++){await page.mouse.move(box.x+(target.x+target.width/2-box.x)*step/45,box.y+(Math.min(target.y+80,900)-box.y)*step/45);await page.waitForTimeout(12)}
 await page.waitForTimeout(300);await page.mouse.up();await page.waitForTimeout(200);const end=await metrics();
 const sample=await page.evaluate(()=>{const p=window.__dndProbe;p.active=false;const sorted=p.frames.slice().sort((a,b)=>a-b);return {renders:p.renders,pointerRenders:p.pointerRenders,rects:p.rects,rectMs:p.rectMs,dragoverEvents:p.events.length,eventGapP95:p.events.slice(1).map((t,i)=>t-p.events[i]).sort((a,b)=>a-b)[Math.floor(Math.max(0,p.events.length-2)*.95)],frameP95:sorted[Math.floor(sorted.length*.95)],maxFrame:Math.max(...sorted),longTasks:p.longTasks,anchor:p.anchor}});
 sample.scriptMs=(end.ScriptDuration-start.ScriptDuration)*1000;sample.layoutMs=(end.LayoutDuration-start.LayoutDuration)*1000;sample.styleMs=(end.RecalcStyleDuration-start.RecalcStyleDuration)*1000;sample.editMs=editMs;sample.normalScriptMs=(normalEnd.ScriptDuration-normalStart.ScriptDuration)*1000;sample.normalLayoutMs=(normalEnd.LayoutDuration-normalStart.LayoutDuration)*1000;sample.mutations=await page.evaluate(()=>window.fixture.mutations.length);assert.equal(sample.mutations,0);
 if(run===0)await page.screenshot({path:path.join(directory,'after-drag.png')});runs.push(sample);console.log(label,run,JSON.stringify(sample));await context.close();
 }
 fs.writeFileSync(path.join(directory,'metrics.json'),JSON.stringify({label,browser:browser.version(),viewport:{width:1440,height:1000},services:500,runs},null,2));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
