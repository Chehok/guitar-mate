'use strict';
// Optional browser smoke test. Install playwright-core externally, serve this repo,
// and set OCR_RUNTIME to a directory with tesseract.js@5.1.1 and eng.traineddata.gz.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
async function main(){
const runtime=process.env.OCR_RUNTIME;
if(!runtime)throw Error('Set OCR_RUNTIME to the external OCR runtime');
if(!process.env.OCR_REGION_MODEL||!process.env.OCR_REGION_DICTIONARY)throw Error('Set the external region model and dictionary paths');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
for(const width of [360,390,768]){
const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',acceptDownloads:true});
const page=await context.newPage(),errors=[],requests=[];let blockRegionModel=false;
page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',async route=>{
const request=route.request(),url=request.url();requests.push({url,method:request.method()});
if(url.startsWith('http://127.0.0.1:8765/'))return route.continue();
const packages=[['tesseract.js@5.1.1/',path.join(runtime,'node_modules/tesseract.js')],['tesseract.js-core@5.1.1/',path.join(runtime,'node_modules/tesseract.js-core')],['onnxruntime-web@1.20.1/',path.join(runtime,'node_modules/onnxruntime-web')]];
for(const [prefix,dir] of packages)if(url.startsWith('https://cdn.jsdelivr.net/npm/'+prefix)){
const file=path.join(dir,url.split(prefix)[1]);return route.fulfill({path:file,contentType:/\.m?js$/.test(file)?'application/javascript':'application/wasm',headers:{'Access-Control-Allow-Origin':'*'}});
}
const modelBase='https://huggingface.co/monkt/paddleocr-onnx/resolve/7b02d0a30a07ba2b92ad1ff5a8941ae2c633de65/languages/english/';
if(url===modelBase+'rec.onnx')return blockRegionModel?route.abort():route.fulfill({path:process.env.OCR_REGION_MODEL,contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'}});
if(url===modelBase+'dict.txt')return blockRegionModel?route.abort():route.fulfill({path:process.env.OCR_REGION_DICTIONARY,contentType:'text/plain; charset=utf-8',headers:{'Access-Control-Allow-Origin':'*'}});
if(url==='https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz')return route.fulfill({path:path.join(runtime,'eng.traineddata.gz'),contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'}});
return route.abort();
});
await page.goto(process.env.SCORE_URL||'http://127.0.0.1:8765/');
assert.equal(await page.locator('#tuner-tab').getAttribute('aria-current'),'page');
for(const tab of ['chords-tab','identify-tab','score-tab']){
await page.locator('#'+tab).click();
assert.equal(await page.locator('#'+tab).getAttribute('aria-current'),'page');
assert(await page.locator('#'+tab.replace('-tab','-panel')).isVisible());
assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'Page overflow at '+width);
}
const images=await page.evaluate(()=>{
const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;
const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,400);ctx.fillStyle='#000';ctx.font='24px serif';
for(const y of [80,240]){
for(const [index,text] of ['C','G/B','Dm7','Cadd2'].entries())ctx.fillText(text,40+index*140,y);
for(let n=0;n<5;n++)ctx.fillRect(20,y+30+n*8,560,1);
}
return {png:canvas.toDataURL('image/png').split(',')[1],jpeg:canvas.toDataURL('image/jpeg').split(',')[1]};
});
// A real browser decode/upload, with offline manual editing and export.
await context.setOffline(true);
for(const type of ['jpeg','png']){
await page.locator('#score-file').setInputFiles({name:'synthetic.'+type,mimeType:'image/'+type,buffer:Buffer.from(images[type],'base64')});
await page.waitForFunction(()=>!document.querySelector('#score-file').disabled);
assert.match(await page.locator('#score-status').textContent(),/오프라인/);
assert.equal(await page.locator('#score-canvas').evaluate(c=>c.width),600);
}
await page.locator('#score-add').click();
await page.locator('#score-position-add').click();
await page.locator('#score-edit-text').fill('C(SUS4)/E');
await page.locator('#score-edit-form button[type=submit]').click();
assert.match(await page.locator('#score-count').textContent(),/1개/);
await page.locator('#score-capo-plus').click();
await page.locator('input[name=score-overlay][value=above]').check();
await page.locator('#score-original').check();
const downloaded=page.waitForEvent('download');await page.locator('#score-download').click();
const download=await downloaded,stream=await download.createReadStream(),chunks=[];
for await(const chunk of stream)chunks.push(chunk);
const png=Buffer.concat(chunks);assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),600);assert.equal(png.readUInt32BE(20),400);
await page.locator('#score-file').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('invalid image')});
await page.waitForFunction(()=>!document.querySelector('#score-file').disabled);
assert.match(await page.locator('#score-status').textContent(),/열 수 없어요/);
assert.match(await page.locator('#score-count').textContent(),/1개/);
assert(await page.evaluate(()=>document.body.scrollWidth<=innerWidth),'Upload overflow at '+width);
// Run both real local engines; no OCR is stubbed.
if(width===390){
await context.setOffline(false);
await page.locator('#score-file').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(images.png,'base64')});
await page.waitForFunction(()=>!document.querySelector('#score-file').disabled,{},{timeout:180000});
const count=await page.evaluate(()=>scoreState.codes.length);
assert(count>=4,'Real browser OCR should recognize multiple generated chords');
assert(await page.evaluate(()=>scoreState.codes.some(code=>code.engine==='paddle'||code.engine==='tesseract-consensus')),'The region model must actually run');
console.log('Real browser Paddle/Tesseract synthetic chord detections:',count);
if(process.env.OCR_SAMPLE_IMAGE){
await page.locator('#score-file').setInputFiles(process.env.OCR_SAMPLE_IMAGE);
await page.waitForFunction(()=>!document.querySelector('#score-file').disabled,{},{timeout:300000});
const codes=await page.evaluate(()=>scoreState.codes);
assert(codes.some(code=>code.engine==='paddle'),'Private development sample must run the new engine');
if(process.env.OCR_SAMPLE_REPORT)fs.writeFileSync(process.env.OCR_SAMPLE_REPORT,JSON.stringify({codes},null,2)+'\n');
console.log('Private development image, real browser chord detections:',codes.length);
}
blockRegionModel=true;
await page.locator('#score-file').setInputFiles({name:'fallback.png',mimeType:'image/png',buffer:Buffer.from(images.png,'base64')});
await page.waitForFunction(()=>!document.querySelector('#score-file').disabled,{},{timeout:180000});
assert(await page.evaluate(()=>scoreState.codes.length>=4&&scoreState.codes.every(code=>!code.engine)),'Unavailable region model must fall back to Tesseract');
console.log('Blocked region model: real legacy fallback passed.');
}
assert.deepEqual(errors,[]);assert(requests.every(r=>r.method==='GET'),'Images must not be posted');
console.log('Mobile '+width+'px: tabs, JPG/PNG upload, offline edit, capo/transpose, overlay, export, decode failure passed.');
await context.close();
}
}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
