'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
for(const id of ['identify-audio-status','identify-candidates','identify-panel','identify-play']){
  assert.match(html,new RegExp(`id="${id}"`));
}
assert.match(html,/id="identify-play"[^>]*>소리 듣기<\/button><button id="identify-reset"/);
assert(!/className='identify-play'/.test(html),'no per-candidate play buttons');
assert.match(html,/async function playIdentifyFrets\(\)/);
assert.match(html,/scheduleChord\(ctx,identifyFrets/);
assert.match(html,/textContent='입력 운지 재생 중'/);
assert.match(html,/identifyPlaybackRequest\+\+;\$\('identify-audio-status'\).textContent='';/);
assert.match(html,/\$\('identify-play'\)\.disabled=!canPlay;/);
const core=script.slice(script.indexOf('const mod='),script.indexOf('let identifyFrets='));
const identifyBlock=script.slice(script.indexOf('function identifyChord(frets)'),script.indexOf('// Optional pure-function regression check'));
const synth=script.slice(script.indexOf('const chordLevel=.45'),script.indexOf('function scheduleReference'));
const ctx=vm.createContext({});
vm.runInContext(core+identifyBlock+synth,ctx);
const frets=[-1,0,2,0,1,0];
const candidates=ctx.identifyChord(frets);
assert.equal(candidates[0]?.label,'Am7');
assert(candidates[0].notes.length>=2);
function scheduleCount(f){return ctx.scheduleChord({currentTime:0,destination:{},createGain:()=>({gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){},connect(){}},connect(){}}),createOscillator:()=>({type:'',frequency:{setValueAtTime(){}},connect(){},start(){},stop(){},addEventListener(){}}),createDynamicsCompressor:()=>({threshold:{value:0},knee:{value:0},ratio:{value:0},attack:{value:0},release:{value:0},connect(){}}),chordBus:null},f,0).length;}
assert.equal(scheduleCount([-1,-1,-1,-1,-1,-1]),0,'all muted -> no voices');
assert.equal(scheduleCount(frets),5,'muted low E leaves five strummed strings');
console.log('Identify playback: single control, input-fret scheduling and empty-input guard passed.');
