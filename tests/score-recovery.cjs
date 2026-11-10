'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8'),c=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('// Score music functions:'),html.indexOf('// End score music functions.')),c);
const bbox=(x0,x1,y0=80,y1=90,page=0)=>({x0,x1,y0,y1,page,staff:100,staffLeft:20,gap:5,row:85,ink:'neutral'});
const code=(text,box,extra={})=>({text,bbox:box,confidence:99,support:3,styles:['gray','binary','flat'],engine:'paddle',...extra});
const regions=Array.from({length:10},(_,i)=>bbox(20+i*20,28+i*20));
assert.equal(c.filterScoreStaffCandidates([code('C',regions[0])],regions).length,0);
assert.equal(c.filterScoreStaffCandidates([code('C',regions[0],{agreement:true})],regions).length,1,'Independent agreement preserves a sparse row');
const far={...regions[0],y0:40,y1:50,row:45};
assert.equal(c.filterScoreStaffCandidates([code('C',far,{agreement:true})],[far,...regions]).length,0,'Agreement does not rescue distant headers');
const otherPage=regions.map(r=>({...r,page:400}));
assert.equal(c.filterScoreStaffCandidates([code('C',regions[0]),...otherPage.map(r=>code('G',r))],[...regions,...otherPage]).filter(r=>r.bbox.page===0).length,0,'Facing pages cannot supply each other row context');

const width=300,height=400,pixels=new Uint8ClampedArray(width*height*4).fill(255);
function line(y,x0,x1,ink){for(let x=x0;x<x1;x++){const p=(y*width+x)*4;pixels[p]=pixels[p+1]=pixels[p+2]=ink;}}
for(const [top,ink,right] of [[80,0,280],[180,230,280],[240,230,100],[300,0,280]])for(let n=0;n<5;n++)line(top+n*5,20,right,ink);
const source={width,height,data:pixels},known=c.scoreStaffBands(source);
assert.deepEqual(Array.from(known,s=>s.top),[80,300]);
const recovered=c.recoverScoreStaffBands(source,known);
assert.deepEqual(Array.from(recovered,s=>s.top),[80,180,300],'Faint staff needs agreement from at least two horizontal probes');
assert.equal(recovered.filter(s=>s.recovered).length,1,'A one-probe pattern is rejected');

const ink=new Uint8ClampedArray(width*200*4).fill(255);
for(const [x0,x1,y0,y1] of [[50,58,80,90],[61,65,77,81],[120,128,80,90]])for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const p=(y*width+x)*4;ink[p]=ink[p+1]=ink[p+2]=0;}
const projected=c.scoreRecoveryRegions({width,height:200,data:ink},[bbox(50,58),bbox(120,128)]);
assert(projected.some(b=>b.x0===50&&b.x1===65&&b.y0===77&&b.y1===90),'Overlapping row bands retain a small raised extension outside the old box');
assert(projected.every(b=>b.recovery));

const old=code('C',bbox(50,60));
const full=code('Cadd2',bbox(48,85),{agreement:true});
assert.deepEqual(Array.from(c.mergeScoreRecovery([old],[full]),x=>x.text),['Cadd2']);
assert.deepEqual(Array.from(c.mergeScoreRecovery([old],[{...full,text:'G'}]),x=>x.text),['C'],'Conflicting recovery cannot replace an accepted code');
assert.deepEqual(Array.from(c.mergeScoreRecovery([old],[{...full,agreement:false,confidence:80}]),x=>x.text),['C']);
assert.deepEqual(Array.from(c.mergeScoreRecovery([old],[{...full,agreement:false,confidence:100}]),x=>x.text),['C'],'Primary confidence alone cannot authorize a recovery');
assert.deepEqual(Array.from(c.mergeScoreRecovery([old],[code('G',bbox(150,160),{agreement:true})]),x=>x.text),['C','G']);
assert.deepEqual(Array.from(c.mergeScoreRecovery([code('CM7',bbox(50,60))],[code('Cm7',bbox(48,85),{agreement:true})]),x=>x.text),['CM7'],'Recovery must not fold minor/major notation');
assert.deepEqual(Array.from(c.mergeScoreOCR([code('C',bbox(40,50,80,90)),code('G',bbox(150,160,65,90),{orderBox:bbox(150,160,80,90)})]),x=>x.text),['C','G'],'A taller recovery crop keeps the earlier reading-order reference');
async function checkRecoveryFragments(){
const data=new Uint8ClampedArray(300*250*4).fill(255);
for(let n=0;n<5;n++)for(let x=20;x<280;x++){const p=((100+n*5)*300+x)*4;data[p]=data[p+1]=data[p+2]=0;}
for(const [x0,x1,y0,y1] of [[40,48,80,90],[55,63,80,90],[66,70,77,81]])for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const p=(y*300+x)*4;data[p]=data[p+1]=data[p+2]=0;}
let box,numeric=false;const stages={};
const worker={setParameters:async()=>{},recognizeRegion:async()=>{
const text=box.recovery?'/B':box.x0<50?'C':numeric?'7':'G';
return {data:{text,confidence:99,secondary:[{text,confidence:96},{text,confidence:96}]}};
}};
const run=()=>c.runScoreOCRPasses(worker,{width:300,height:250,data},()=>{throw Error('Region model should receive pixels');},(_i,_n,_name,b)=>{box=b;},()=>true,(name,value)=>{stages[name]=value;});
const codes=await run();
assert.deepEqual(Array.from(codes,x=>x.text),['C','G'],'A recovery-only slash fragment cannot change earlier accepted codes');
assert(stages.layout.regions.some(r=>r.recovery),'The recovery branch was exercised');
assert(stages.readings.fragments.every(r=>!r.bbox.recovery));
numeric=true;
assert.equal((await run()).length,0,'A joined fragment cannot reuse agreement for the shorter original string to rescue a sparse row');
}
checkRecoveryFragments().then(()=>console.log('Missing staff recovery, overlapping code bands, sparse-row evidence, page isolation and conservative merge passed.')).catch(error=>{console.error(error);process.exitCode=1;});
