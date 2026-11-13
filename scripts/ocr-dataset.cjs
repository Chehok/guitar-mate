#!/usr/bin/env node
'use strict';
// External/private reviewed labels and images stay outside the checkout.
// NODE_PATH=... OCR_LANG_PATH=... node scripts/ocr-dataset.cjs labels-root image-root split output
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {recognize,context,encode}=require('./ocr-eval.cjs');

// Maximize exact ordered occurrences, then pair unmatched spans as substitutions.
// Labels have no token/row coordinates: this is image-level sequence alignment.
function evaluateSequence(actual,truth){
const dp=Array.from({length:truth.length+1},()=>new Uint16Array(actual.length+1));
for(let i=truth.length-1;i>=0;i--)for(let j=actual.length-1;j>=0;j--)dp[i][j]=truth[i]===actual[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1]);
const anchors=[];let i=0,j=0;
while(i<truth.length&&j<actual.length){
if(truth[i]===actual[j]){anchors.push([i++,j++]);}
else if(dp[i+1][j]>=dp[i][j+1])i++;else j++;
}
const wrong=[],missing=[],extra=[];let ti=0,ai=0;
for(const [t,a] of [...anchors,[truth.length,actual.length]]){
const paired=Math.min(t-ti,a-ai);
for(let k=0;k<paired;k++)wrong.push({expected:truth[ti+k],actual:actual[ai+k],expectedIndex:ti+k,actualIndex:ai+k});
for(let k=ti+paired;k<t;k++)missing.push({text:truth[k],index:k});
for(let k=ai+paired;k<a;k++)extra.push({text:actual[k],index:k});
ti=t+1;ai=a+1;
}
return {expected:truth.length,detected:actual.length,correct:anchors.length,wrong,missing,extra,
precision:actual.length?anchors.length/actual.length:0,recall:truth.length?anchors.length/truth.length:0};
}
function scoreReport(report,label){
// Literal labels: no key, enharmonic, case, parentheses or suffix rewriting.
return evaluateSequence(report.codes.map(c=>c.text),label.rows.flatMap(row=>{
const tokens=row.chords??row.tokens;
if(!Array.isArray(tokens)||tokens.some(c=>typeof c.text!=='string'))throw Error('Unsupported label row');
return tokens.map(c=>c.text);
}));
}
async function main(){
const [labelRoot,imageRoot,split,output]=process.argv.slice(2);
if(!output||!['development','evaluation','hold'].includes(split))throw Error('Usage: labels-root image-root development|evaluation|hold output');
const Tesseract=require('tesseract.js');
if(require('tesseract.js/package.json').version!=='5.1.1')throw Error('Use tesseract.js@5.1.1');
const splitFile=fs.readFileSync(path.join(labelRoot,'split.json'));
const appFile=process.env.OCR_APP_HTML||path.join(__dirname,'../score-key-transposer.html');
fs.mkdirSync(output,{recursive:true});
const identity={split,splitSHA256:crypto.createHash('sha256').update(splitFile).digest('hex'),appSHA256:crypto.createHash('sha256').update(fs.readFileSync(appFile)).digest('hex'),tesseract:'5.1.1',langSHA256:crypto.createHash('sha256').update(fs.readFileSync(path.join(process.env.OCR_LANG_PATH,'eng.traineddata'))).digest('hex')};
if(process.env.OCR_REGION_MODEL){
identity.regionModelSHA256=crypto.createHash('sha256').update(fs.readFileSync(process.env.OCR_REGION_MODEL)).digest('hex');
identity.regionDictionarySHA256=crypto.createHash('sha256').update(fs.readFileSync(process.env.OCR_REGION_DICTIONARY)).digest('hex');
identity.regionRuntime='onnxruntime-node@1.20.1';
identity.regionSecondary=process.env.OCR_REGION_SECONDARY==='1';
}
const runFile=path.join(output,'run.json');
if(fs.existsSync(runFile)){
const previous=JSON.parse(fs.readFileSync(runFile));
for(const [key,value] of Object.entries(identity))if(previous[key]!==value)throw Error('Output contains a different run: '+key);
}else fs.writeFileSync(runFile,JSON.stringify({...identity,started:new Date().toISOString()},null,2)+'\n');
const labels=fs.readdirSync(path.join(labelRoot,'labels',split)).filter(n=>n.endsWith('.json')).sort();
for(const name of labels)scoreReport({codes:[]},JSON.parse(fs.readFileSync(path.join(labelRoot,'labels',split,name),'utf8')));
const cache=fs.mkdtempSync(path.join(os.tmpdir(),'score53-ocr-'));let worker,regionSession;
try{
worker=await Tesseract.createWorker('eng',1,{cachePath:cache,langPath:process.env.OCR_LANG_PATH,gzip:false},context.scoreOCRConfig());
if(process.env.OCR_REGION_MODEL){
const ort=require('onnxruntime-node'),dictionary=context.scoreRecognizerDictionary(fs.readFileSync(process.env.OCR_REGION_DICTIONARY,'utf8'));
regionSession=await ort.InferenceSession.create(process.env.OCR_REGION_MODEL,{executionProviders:['cpu'],intraOpNumThreads:1});
worker.recognizeRegion=async image=>{
const input=context.scoreRecognizerInput(image),output=await regionSession.run({[regionSession.inputNames[0]]:new ort.Tensor('float32',new Float32Array(input.data),Array.from(input.dims))});
const data=context.decodeScoreRecognizer(output[regionSession.outputNames[0]],dictionary);
if(process.env.OCR_REGION_SECONDARY==='1'){
const png=await encode(image);data.secondary=[];
for(const psm of ['7','8']){
const params=context.scoreOCRParameters(psm);params.tessedit_char_whitelist+='SUDJ';await worker.setParameters(params);
const result=await worker.recognize(png);data.secondary.push({text:result.data.text||'',confidence:result.data.confidence||0,psm});
}
}
return {data};
};
}
for(const [index,name] of labels.entries()){
const label=JSON.parse(fs.readFileSync(path.join(labelRoot,'labels',split,name),'utf8'));
const image=path.join(imageRoot,label.source_path.endsWith('.heic')?'converted/'+path.basename(label.source_path,'.heic')+'.png':label.source_path);
const id=crypto.createHash('sha256').update(label.image_id).digest('hex').slice(0,12),target=path.join(output,id+'.json');
if(fs.existsSync(target)){console.log(`${split} ${index+1}/${labels.length} saved`);continue;}
const report=await recognize(worker,image,null,null);
report.label=name;report.imageID=label.image_id;
// The evaluation split's detailed errors remain on disk until tuning is frozen.
report.evaluation=scoreReport(report,label);
fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');
console.log(`${split} ${index+1}/${labels.length} ${report.seconds.toFixed(1)}s${split==='development'?' exact='+report.evaluation.correct+'/'+report.evaluation.expected:''}`);
}
}finally{if(worker)await worker.terminate();if(regionSession)await regionSession.release();fs.rmSync(cache,{recursive:true,force:true});}
}
module.exports={evaluateSequence,scoreReport};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
