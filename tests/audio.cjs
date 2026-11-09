'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const script=html.match(/<script data-main-app[^>]*>([\s\S]*?)<\/script>/)[1];
const code=script.slice(script.indexOf('let audioContext=null,playing=[]'),script.indexOf("if(ready(['chords']))$('play').addEventListener"));
function make(contexts,audioSession){
  const made=[];
  class Ctx{constructor(){const spec=contexts.shift()||{};this.state=spec.initial||'suspended';this.spec=spec;made.push(this);}
    resume(){if(this.spec.hang)return new Promise(()=>{});if(this.spec.resumeTo)this.state=this.spec.resumeTo;return Promise.resolve();}
    close(){this.state='closed';return Promise.resolve();}}
  const sandbox={window:{AudioContext:Ctx},navigator:{audioSession},setTimeout:(fn)=>global.setTimeout(fn,5)};
  vm.runInNewContext(code+';this.prepareAudio=prepareAudio;this.getCtx=()=>audioContext;this.audioFailure=audioFailure;',sandbox);
  return {sandbox,made};
}
(async()=>{
  // first tap: suspended context resumes and iOS audio session is marked as playback
  let session={type:'auto'};
  let t=make([{resumeTo:'running'}],session);
  assert.equal((await t.sandbox.prepareAudio()).state,'running');assert.equal(session.type,'playback');
  // already running: reused for repeat taps
  const first=t.sandbox.getCtx();await t.sandbox.prepareAudio();assert.equal(t.sandbox.getCtx(),first);assert.equal(t.made.length,1);
  // interrupted after backgrounding and never resuming: a fresh context is built
  t=make([{initial:'running'},{resumeTo:'running'},{resumeTo:'running'}],session);await t.sandbox.prepareAudio();
  t.made[0].state='interrupted';t.made[0].spec.hang=true;
  const again=await t.sandbox.prepareAudio();assert.equal(t.made.length,2);assert.equal(again.state,'running');assert.equal(t.made[0].state,'closed');
  // closed context is replaced
  t.sandbox.getCtx().state='closed';await t.sandbox.prepareAudio();assert.equal(t.made.length,3);
  // never running: rejects so the UI shows a failure, never success
  t=make([{hang:true},{hang:true}],session);
  await assert.rejects(t.sandbox.prepareAudio(),/audio-not-running/);
  // missing Web Audio and missing/throwing audioSession APIs
  const none={window:{},navigator:{},setTimeout};vm.runInNewContext(code+';this.prepareAudio=prepareAudio;',none);
  await assert.rejects(none.prepareAudio(),/unsupported/);
  t=make([{resumeTo:'running'}],undefined);await t.sandbox.prepareAudio();
  const bad={set type(v){throw Error('x');},get type(){return 'auto';}};t=make([{resumeTo:'running'}],bad);await t.sandbox.prepareAudio();
  {
    const calls=[];const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(v){calls.push(['ramp',v]);},exponentialRampToValueAtTime(){},cancelScheduledValues(){calls.push(['cancel']);},setTargetAtTime(v){calls.push(['target',v]);}});
    const node=name=>({name,gain:param(),frequency:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),connected:[],connect(n){this.connected.push(n);},disconnect(){},start(){},stop(){calls.push(['osc-stop']);},addEventListener(){}});
    const ctx={currentTime:1,destination:{name:'dest'},createGain:()=>node('gain'),createOscillator:()=>node('osc'),createDynamicsCompressor:()=>node('comp')};
    const box={window:{},navigator:{},setTimeout,tuning:[40,45,50,55,59,64]};
    vm.runInNewContext(code+';this.sc=scheduleChord;this.sr=scheduleReference;',box);
    const tones=box.sc(ctx,[-1,3,2,0,1,0],1);
    assert.equal(tones.length,5,'muted strings are skipped');
    assert.equal(ctx.chordBus.connected[0].name,'comp');assert(ctx.chordBus.connected[0].connected.includes(ctx.destination),'bus reaches the speakers through the compressor');
    const peaks=calls.filter(c=>c[0]==='ramp').map(c=>c[1]);assert(peaks.every(v=>Math.abs(v-.45/Math.sqrt(5))<1e-9),'per-string peak is normalised by string count');
    assert(.45/Math.sqrt(5)*5*(1+1/4+1/9+1/16)>1,'unlimited sum could exceed full scale, so the limiter matters');
    calls.length=0;tones[0].voice.stop();assert(calls.some(c=>c[0]==='target'&&c[1]===0)&&calls.some(c=>c[0]==='osc-stop'),'stop fades before stopping');
    const bus=ctx.chordBus;box.sr(ctx,110,1);assert.equal(ctx.chordBus,bus,'one bus is reused');
  }
  // Live microphone: never switch the session to 'playback' (that ends the capture track per W3C Audio Session).
  {
    session={type:'auto'};const live=make([{resumeTo:'running'},{resumeTo:'running'}],session);
    vm.runInContext('captureActive=()=>true;',live.sandbox);
    await live.sandbox.prepareAudio();assert.equal(session.type,'auto','mic on keeps auto');
    vm.runInContext('captureActive=()=>false;',live.sandbox);
    await live.sandbox.prepareAudio();assert.equal(session.type,'playback','mic off uses playback');
    // Capture start/stop retires the output context so the next tap builds a fresh one.
    const before=live.sandbox.getCtx();vm.runInContext('retirePlaybackContext()',live.sandbox);
    assert.equal(before.state,'closed');assert.equal(live.sandbox.getCtx(),null);
    await live.sandbox.prepareAudio();assert.notEqual(live.sandbox.getCtx(),before);assert.equal(live.made.length,2);
    // A context that stops right after scheduling reports failure; a current running one does not.
    let failed=0;const ctx=live.sandbox.getCtx();
    vm.runInContext('confirmPlayback',live.sandbox)(ctx,()=>true,()=>failed++);
    await new Promise(r=>setTimeout(r,450));assert.equal(failed,0);
    vm.runInContext('confirmPlayback',live.sandbox)(ctx,()=>true,()=>failed++);ctx.state='interrupted';
    await new Promise(r=>setTimeout(r,450));assert.equal(failed,1);
    vm.runInContext('confirmPlayback',live.sandbox)(ctx,()=>false,()=>failed++);
    await new Promise(r=>setTimeout(r,450));assert.equal(failed,1,'superseded playback is not reported');
  }
  // source wiring
  assert.equal((html.match(/await prepareAudio\(\)/g)||[]).length,3,'chord, identify and tuner buttons share the helper');
  assert.match(html,/setAudioSession\('auto'\);context=new Audio\(\)/,'mic start restores the automatic session');
  assert(!/\.play\(\)\s*;?\s*\}\s*\)\s*;?\s*\/\/ autoplay/.test(html));
  assert.match(html,/referenceWeights=\[1,\.6,\.45,\.35,\.25,\.15\]/,'reference overtones');
  assert.match(html,/captureActive=\(\)=>!!micStream;/);
  assert.match(html,/stopPlayback\(\);retirePlaybackContext\(\);setAudioSession\('auto'\)/,'mic start rebuilds output');
  assert.match(html,/if\(wasCapturing\)retirePlaybackContext\(\);/,'mic stop rebuilds output');
  assert.equal((html.match(/confirmPlayback\(/g)||[]).length,4,'chord, identify, reference verify playback');
  console.log('Audio preparation: resume, interrupted recovery, failure reporting and session type passed (mocked, no browser).');
})().catch(error=>{console.error(error);process.exitCode=1;});
