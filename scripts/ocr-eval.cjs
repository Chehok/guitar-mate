#!/usr/bin/env node
'use strict';
// npm install --prefix /tmp/ocrt tesseract.js@5.1.1
// NODE_PATH=/tmp/ocrt/node_modules OCR_LANG_PATH=/tmp/ocrt node scripts/ocr-eval.cjs --all /tmp/ocr-round
// Or: node scripts/ocr-eval.cjs image.png [expected.json] [report-prefix]
// Python 3 + Pillow provide image I/O only. All OCR/preprocessing uses the app's JS.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {execFile}=require('node:child_process');
const root=path.join(__dirname,'..'),html=fs.readFileSync(process.env.OCR_APP_HTML||path.join(root,'index.html'),'utf8'),context=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('// Score music functions:'),html.indexOf('// End score music functions.')),context);
function python(code,args=[],input){return new Promise((resolve,reject)=>{
const child=execFile('python3',['-c',code,...args],{encoding:'buffer',maxBuffer:240*1024*1024},(error,stdout)=>error?reject(error):resolve(stdout));
child.stdin.on('error',reject);child.stdin.end(input);
});}
const encode=image=>python('from PIL import Image\nimport sys\nim=Image.frombytes("RGBA",(int(sys.argv[1]),int(sys.argv[2])),sys.stdin.buffer.read())\nim.save(sys.stdout.buffer,format="PNG")',[String(image.width),String(image.height)],Buffer.from(image.data));
function evaluate(result,expected){
const missing=[],wrong=[],matched=[],remaining=new Set(result),lines=[];
if(expected.lines){
const groups=expected.lines.map(()=>[]);
for(const c of result){
const b=c.bbox,cy=(b.y0+b.y1)/2,cx=(b.x0+b.x1)/2;
const closest=expected.lines.map((l,i)=>({l,i,d:Math.abs(cy-l.y)})).filter(({l})=>cx>=(l.x0??0)&&cx<=(l.x1??expected.width)).sort((a,b)=>a.d-b.d)[0];
if(closest&&closest.d<expected.height*.045)groups[closest.i].push(c);
}
for(const [row,line] of expected.lines.entries()){
const found=groups[row].sort((a,b)=>a.bbox.x0-b.bbox.x0),truth=line.chords;
// LCS counts occurrences in order; repeated names never turn into a set comparison.
const dp=Array.from({length:truth.length+1},()=>new Uint16Array(found.length+1));
for(let i=truth.length-1;i>=0;i--)for(let j=found.length-1;j>=0;j--)dp[i][j]=truth[i]===found[j].text?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
let i=0,j=0;const hits=new Set();
while(i<truth.length&&j<found.length){if(truth[i]===found[j].text){matched.push({text:truth[i],row:row+1,bbox:found[j].bbox});remaining.delete(found[j]);hits.add(i);i++;j++;}else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;}
for(let k=0;k<truth.length;k++)if(!hits.has(k))missing.push({text:truth[k],row:row+1,index:k+1});
lines.push({row:row+1,expected:truth,actual:found.map(c=>c.text)});
}
}else{
const area=b=>(b.x1-b.x0)*(b.y1-b.y0);
for(const truth of expected.chords){
const overlap=found=>Math.max(0,Math.min(found.bbox.x1,truth.bbox.x1)-Math.max(found.bbox.x0,truth.bbox.x0))*Math.max(0,Math.min(found.bbox.y1,truth.bbox.y1)-Math.max(found.bbox.y0,truth.bbox.y0))/Math.max(1,Math.min(area(found.bbox),area(truth.bbox)));
const found=[...remaining].filter(c=>overlap(c)>.45).sort((a,b)=>overlap(b)-overlap(a))[0];
if(!found){missing.push(truth);continue;}remaining.delete(found);
if(found.text===truth.text)matched.push(truth);else wrong.push({...truth,actual:found.text});
}
}
const total=expected.count??expected.chords.length,correct=matched.length;
return {expected:total,correct,precision:result.length?correct/result.length:0,recall:correct/total,missing,wrong,extra:[...remaining],matched,lines};
}
async function recognize(worker,filename,expected,output){
const started=Date.now(),attempts=[],stages={};
const raw=await python('from PIL import Image\nimport sys,struct\nim=Image.open(sys.argv[1]).convert("RGBA")\nsys.stdout.buffer.write(struct.pack(">II",*im.size)+im.tobytes())',[filename]);
const original={width:raw.readUInt32BE(0),height:raw.readUInt32BE(4),data:raw.subarray(8)};
if(expected&&(expected.width!==original.width||expected.height!==original.height))throw Error('Fixture dimensions differ from original.');
const size=context.scoreImageSize(original.width,original.height),source=context.resizeScorePixels(original,size.width,size.height),processed=context.scoreImageSize(source.width,source.height,true);
let pass=0,variant,psm,regionBox;
const adapter={setParameters:p=>{psm=p.tessedit_pageseg_mode;return worker.setParameters(p);},recognize:async input=>{
const {data}=await worker.recognize(input);
attempts.push({pass:++pass,variant,psm,bbox:regionBox,text:data.text,confidence:data.confidence,...(process.env.OCR_DEBUG?{words:(data.words||[]).map(({text,confidence,bbox})=>({text,confidence,bbox}))}:{})});
if(process.env.OCR_VERBOSE)console.log(`${path.basename(filename)} ${pass} ${variant} PSM${psm}: ${data.text.replace(/\n/g,' ')}`);
return {data};}};
if(worker.recognizeRegion)adapter.recognizeRegion=async image=>{
const {data}=await worker.recognizeRegion(image);
attempts.push({pass:++pass,variant,engine:'paddle',psm:null,bbox:regionBox,text:data.text,confidence:data.confidence,secondary:data.secondary});
return {data};
};
const codes=await context.runScoreOCRPasses(adapter,source,encode,(_index,_total,name,bbox)=>{variant=name;regionBox=bbox||null;},()=>true,process.env.OCR_DIAGNOSTICS?(name,value)=>{stages[name]=JSON.parse(JSON.stringify(value));}:null);
const result=codes.map(c=>({...c,bbox:{x0:c.bbox.x0*original.width/source.width,y0:c.bbox.y0*original.height/source.height,x1:c.bbox.x1*original.width/source.width,y1:c.bbox.y1*original.height/source.height}}));
const evaluation=expected?evaluate(result,expected):null;
const report={image:filename,width:original.width,height:original.height,source:{width:source.width,height:source.height},count:result.length,seconds:(Date.now()-started)/1000,codes:result,evaluation,attempts,...(process.env.OCR_DIAGNOSTICS?{stages}:{})};
if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.json',JSON.stringify(report,null,2)+'\n');
// Row fixtures have no invented per-chord boxes; mark actual OCR only.
await python('from PIL import Image,ImageDraw\nimport sys,json\nim=Image.open(sys.argv[1]).convert("RGB");d=ImageDraw.Draw(im)\nfor c in json.load(sys.stdin):\n b=c["bbox"];d.rectangle((b["x0"]-2,b["y0"]-2,b["x1"]+2,b["y1"]+2),outline="green",width=2);d.text((b["x0"],b["y0"]-15),c["text"],fill="green")\nim.save(sys.argv[2])',[filename,output+'.png'],JSON.stringify(result));}
return report;
}
function table(reports){
const rows=['| 악보 | 정답 | 인식 | 일치 | Precision | Recall | 초 |','| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
for(const r of reports){const e=r.evaluation;rows.push(`| ${path.basename(r.image)} | ${e?.expected??'-'} | ${r.count} | ${e?.correct??'-'} | ${e?(e.precision*100).toFixed(1)+'%':'-'} | ${e?(e.recall*100).toFixed(1)+'%':'-'} | ${r.seconds.toFixed(1)} |`);}
return rows.join('\n');
}
async function main(){
const Tesseract=require('tesseract.js');
if(require('tesseract.js/package.json').version!=='5.1.1')throw Error('Install tesseract.js@5.1.1 under /tmp.');
const all=process.argv[2]==='--all',output=all?path.resolve(process.argv[3]||'/tmp/gc-ocr-round'):process.argv[4]?path.resolve(process.argv[4]):null;
const jobs=all?fs.readdirSync(path.join(root,'tests/fixtures/scores')).filter(n=>n.endsWith('.json')).sort().map(n=>{const fixture=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/scores',n),'utf8'));return {image:path.join(root,fixture.image),fixture,id:path.basename(n,'.json')};}):[{image:path.resolve(process.argv[2]||path.join(root,'.ref/sample-score.png')),fixture:process.argv[3]?JSON.parse(fs.readFileSync(process.argv[3],'utf8')):null,id:'single'}];
if(all)jobs.push({image:path.join(root,'.ref/full-score.png'),fixture:JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/full-score-chords.json'),'utf8')),id:'full-score'});
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'gc-tuner-ocr-eval-')),reports=[];let worker;
try{
const langPath=process.env.OCR_LANG_PATH||(fs.existsSync('/tmp/ocrt/eng.traineddata')?'/tmp/ocrt':null);
worker=await Tesseract.createWorker('eng',1,{cachePath:cache,...(langPath?{langPath:path.resolve(langPath),gzip:false}:{langPath:'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int'})},context.scoreOCRConfig());
for(const job of jobs){const r=await recognize(worker,job.image,job.fixture,output?(all?path.join(output,job.id):output):null);reports.push(r);console.log(table([r]));
if(r.evaluation){for(const label of ['missing','wrong','extra'])if(r.evaluation[label].length)console.log(`${job.id} ${label}: `+r.evaluation[label].map(c=>`${c.row?'L'+c.row+':':''}${c.text}${c.actual?' <- '+c.actual:''}`).join(', '));if(r.evaluation.correct!==r.evaluation.expected||r.evaluation.correct!==r.count)process.exitCode=1;}
else console.log(r.codes.map(c=>c.text).join(' '));
}
if(all){const summary=table(reports);console.log('\n'+summary);fs.writeFileSync(path.join(output,'summary.md'),summary+'\n');fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(reports.map(({attempts,codes,...r})=>r),null,2)+'\n');}
}finally{if(worker)await worker.terminate();fs.rmSync(cache,{recursive:true,force:true});}
}
module.exports={evaluate,table,recognize,context,encode};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
