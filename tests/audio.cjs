'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
// Each page carries only its own feature: the tuner (index) has the reference tone and mic handling,
// the chord pages have chord playback. The audio helpers are the same on all of them.
const pages={tuner:'index.html',chords:'chord-search.html',identify:'chord-identifier.html'};
const source=Object.fromEntries(Object.entries(pages).map(([k,f])=>[k,fs.readFileSync(f,'utf8')]));
// Shared audio helpers live in app-core.js; each page adds its own sounds.
const {core}=require('./support/page-source.cjs');
const audioCode=(page,start,end)=>{const s=source[page].match(/<script data-main-app[^>]*>([\s\S]*?)<\/script>/)[1];const a=s.indexOf(start),b=s.indexOf(end,a);assert(a>=0&&b>a,page);return core+'\n'+s.slice(a,b);};
const code=audioCode('tuner','function retirePlaybackContext(',"if(ready(['tuner']))$('mic-toggle')");
const chordCode=audioCode('chords','function scheduleChord(',"if(ready(['chords']))$('play')");
const html=[core,...Object.values(source)].join('\n');
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
    const param=()=>({value:1,events:[],setValueAtTime(v,t){this.events.push(['set',v,t]);},
      linearRampToValueAtTime(v,t){this.events.push(['linear',v,t]);},exponentialRampToValueAtTime(v,t){this.events.push(['exp',v,t]);}});
    const node=name=>({name,gain:param(),frequency:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),
      connected:[],stopTimes:[],connect(n){this.connected.push(n);},disconnect(){},start(t){this.startAt=t;},stop(t){this.stopTimes.push(t);},addEventListener(){}});
    const buffers=[];
    const ctx={currentTime:1,sampleRate:48000,destination:{name:'dest'},createGain:()=>node('gain'),createOscillator:()=>node('osc'),createBufferSource:()=>node('source'),
      createBuffer:(channels,length,rate)=>{const data=new Float32Array(length),buffer={length,sampleRate:rate,getChannelData:()=>data};buffers.push(buffer);return buffer;},
      createDynamicsCompressor:()=>node('comp')};
    const box={window:{},navigator:{},setTimeout,tuning:[40,45,50,55,59,64]};
    vm.runInNewContext(chordCode+';this.sc=scheduleChord;this.render=renderPluck;',box);
    // Acoustic chord: one plucked-string buffer per sounding string, a quick low-to-high down strum.
    const tones=box.sc(ctx,[-1,3,2,0,1,0],1);
    assert.equal(tones.length,5,'muted strings are silent');
    const starts=tones.map(tone=>tone.oscs[0].startAt);
    assert(starts.every((t,i)=>i===0||t>starts[i-1]),'low to high');assert(starts.at(-1)-starts[0]<.08,'a strum, not an arpeggio');
    const fader=tone=>tone.oscs[0].connected[0];
    const levels=tones.map(tone=>Math.max(...fader(tone).gain.events.map(event=>event[1])));
    assert(levels.reduce((a,b)=>a+b,0)<.9,'all strings together keep headroom (buffers peak at .9)');
    assert(tones.every(tone=>fader(tone).connected[0].connected.includes(ctx.destination)));
    // Each pitch is rendered once and reused.
    const rendered=buffers.length;box.sc(ctx,[-1,3,2,0,1,0],2);assert.equal(buffers.length,rendered,'string buffers are cached');
    const samples=buffers[0].getChannelData();assert(Math.max(...samples.slice(0,4800).map(Math.abs))>.85,'normalized pluck');
    assert(Math.max(...samples.slice(-4800).map(Math.abs))<Math.max(...samples.slice(0,4800).map(Math.abs))/4,'the string decays');
    // Stop: a 20 ms fade on its own gain stage; queued strings never start.
    ctx.currentTime=starts[0]+.01;
    const release=fader(tones[0]).connected[0];
    tones[0].voice.stop();
    assert.deepEqual(release.gain.events,[['set',1,ctx.currentTime],['linear',0,ctx.currentTime+.02]]);
    assert.equal(tones[0].oscs[0].stopTimes.at(-1),ctx.currentTime+.02);
    tones[4].voice.stop();
    assert.equal(tones[4].oscs[0].stopTimes.at(-1),ctx.currentTime,'queued strings never start');
  }
  // The pluck is in tune: measure the rendered string with the tuner's own pitch detector.
  {
    const {loadPage}=require('./support/page-source.cjs');
    const tuner=loadPage(vm.createContext({}),'index.html');
    for(const midi of [40,45,52,59,64,71]){
      const hz=440*2**((midi-69)/12),data=new Float32Array(48000);tuner.renderPluck(data,48000,hz,3);
      const got=tuner.detectPitch(data.slice(7200,7200+8192),48000),cents=1200*Math.log2(got/hz);
      assert(Math.abs(cents-1200*Math.round(cents/1200))<1.5,`midi ${midi} in tune (${cents.toFixed(1)} cents)`);
    }
  }
  // Tuner reference tone: clean partials through its own compressor bus.
  {
    const param=()=>({value:1,events:[],setValueAtTime(v,t){this.events.push(['set',v,t]);},
      linearRampToValueAtTime(v,t){this.events.push(['linear',v,t]);},exponentialRampToValueAtTime(v,t){this.events.push(['exp',v,t]);}});
    const node=name=>({name,gain:param(),frequency:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param(),
      connected:[],stopTimes:[],connect(n){this.connected.push(n);},disconnect(){},start(){},stop(t){this.stopTimes.push(t);},addEventListener(){}});
    const ctx={currentTime:1,destination:{name:'dest'},createGain:()=>node('gain'),createOscillator:()=>node('osc'),createDynamicsCompressor:()=>node('comp')};
    const box={window:{},navigator:{},setTimeout};
    vm.runInNewContext(code+';this.sr=scheduleReference;',box);
    box.sr(ctx,110,1);
    const bus=ctx.chordBus;
    assert.equal(bus.connected[0].name,'comp');assert(bus.connected[0].connected.includes(ctx.destination),'reference tones retain their compressor');
    box.sr(ctx,110,1);assert.equal(ctx.chordBus,bus,'one reference bus is reused');
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
  assert.match(core,/function confirmPlayback\(/,'shared helper');
  for(const [page,text] of Object.entries(source))assert.equal((text.match(/confirmPlayback\(/g)||[]).length,1,page+' verifies its playback');
  console.log('Audio preparation: resume, interrupted recovery, failure reporting and session type passed (mocked, no browser).');
})().catch(error=>{console.error(error);process.exitCode=1;});
