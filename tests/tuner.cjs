'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {core,mainScript,loadPage}=require('./support/page-source.cjs');
const script=mainScript('index.html');
new vm.Script(core);new vm.Script(script); // Parse the entire app, including microphone/event wiring.
const context=loadPage(vm.createContext({}),'index.html');
const detect=context.detectPitch;
let seed=7,cases=0,maxError=0;
const noise=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32-.5;};
const cents=(actual,expected)=>1200*Math.log2(actual/expected);
// Test the actual detector at each string, detuned and calibrated, including
// dominant second harmonics, weak microphone levels and a plucked decay.
for(const rate of [44100,48000,96000])for(const a of [430,440,450])for(const midi of [40,45,50,55,59,64])for(const offset of [-45,-5,0,5,45]){
  const frequency=a*2**((midi-69)/12+offset/1200);
  for(const [harmonics,amplitude,noiseLevel,decay] of [
    [[1],.25,.002,0],[[.3,1,.45,.2],.1,.002,0],
    [[.1,1,.02],.04,.0002,0],[[1],.0005,.0001,0],
    [[.3,1,.45,.2],.001,.0001,4]
  ]){
    const samples=Float32Array.from({length:rate>48000?16384:8192},(_,i)=>
      .08+amplitude*Math.exp(-decay*i/rate)*harmonics.reduce((sum,level,h)=>sum+level*Math.sin(2*Math.PI*frequency*(h+1)*i/rate+.37),0)+noise()*noiseLevel);
    const actual=detect(samples,rate),error=actual===null?Infinity:Math.abs(cents(actual,frequency));
    assert(error<=3,`${rate} Hz, MIDI ${midi}, A4=${a}, offset=${offset}, harmonics=${harmonics}, amplitude=${amplitude}: ${actual} Hz, ${error} cents`);
    maxError=Math.max(maxError,error);cases++;
  }
}
for(const rate of [44100,48000,96000])for(const frequency of [70,70.2,75,440,660,880,997,1000]){
  const signal=Float32Array.from({length:rate>48000?16384:8192},(_,i)=>.1*Math.sin(2*Math.PI*frequency*i/rate));
  const actual=detect(signal,rate);
  assert(actual!==null&&Math.abs(cents(actual,frequency))<=3,`Range or false subharmonic at ${frequency}: ${actual}`);cases++;
}
for(const rate of [44100,48000,96000]){
  const length=rate>48000?16384:8192;
  for(const signal of [new Float32Array(length),new Float32Array(length).fill(.1),Float32Array.from({length},()=>noise()*.5),Float32Array.from({length},()=>noise()*.0005)])assert.equal(detect(signal,rate),null,'Silence, DC or noise detected as pitch');
}
// Basses: B0 (31 Hz) to G2 with the bass range, including a strong 2nd harmonic and a plucked decay.
{
  const bass=vm.runInContext('BASS_RANGE',context);
  for(const rate of [44100,48000,96000])for(const midi of [23,28,33,38,43])for(const offset of [-40,-5,0,5,40]){
    const frequency=440*2**((midi-69)/12+offset/1200);
    for(const [harmonics,amplitude,noiseLevel,decay] of [[[1],.2,.002,0],[[.4,1,.5,.3],.08,.001,0],[[.2,1,.6,.4,.2],.002,.0001,3]]){
      const samples=Float32Array.from({length:rate>48000?16384:8192},(_,i)=>
        amplitude*Math.exp(-decay*i/rate)*harmonics.reduce((sum,level,h)=>sum+level*Math.sin(2*Math.PI*frequency*(h+1)*i/rate+.37),0)+noise()*noiseLevel);
      const actual=detect(samples,rate,bass),error=actual===null?Infinity:Math.abs(cents(actual,frequency));
      assert(error<=3,`bass ${rate} Hz, MIDI ${midi}, offset=${offset}, harmonics=${harmonics}: ${actual} Hz, ${error} cents`);
      maxError=Math.max(maxError,error);cases++;
    }
  }
  // Each instrument: strings found by pitch, one post and string per peg on the headstock.
  for(const [name,count] of [['guitar',6],['bass4',4],['bass5',5]]){
    vm.runInContext(`instrument='${name}';tunerNotes=INSTRUMENTS.${name}.notes;stringNames=INSTRUMENTS.${name}.names;`,context);
    for(let index=0;index<count;index++)assert.equal(vm.runInContext(`nearestString(stringFrequency(${index}),440)`,context),index,`${name} string ${index}`);
    const parts=name==='guitar'?vm.runInContext(`headstockParts(INSTRUMENTS.${name})`,context):vm.runInContext(`bassHeadArt(INSTRUMENTS.${name}).markup`,context);
    assert.equal((parts.match(/<circle /g)||[]).length,count,`${name}: one post per string`);
    assert.equal((parts.match(/<path d="M[\d.]+ [\d.]+(H44)?L/g)||[]).length,count,`${name}: one string per post`);
    const layout=JSON.parse(vm.runInContext(`JSON.stringify(pegLayout(INSTRUMENTS.${name}))`,context));
    assert.deepEqual(layout.map(p=>p[0]).sort(),[...Array(count).keys()],`${name}: every string has one peg`);
    assert.equal(new Set(layout.map(p=>p[1]+'/'+p[2])).size,count,`${name}: no two pegs share a spot`);
  }
  vm.runInContext("instrument='guitar';tunerNotes=INSTRUMENTS.guitar.notes;stringNames=INSTRUMENTS.guitar.names;",context);
  assert.equal(vm.runInContext('stringFrequency(0)',context).toFixed(2),'41.20'.replace('41.20',(440*2**((40-69)/12)).toFixed(2)));
}
// Existing chord checks run without a DOM or a browser.
for(let index=0;index<6;index++)assert.equal(vm.runInContext(`nearestString(stringFrequency(${index}),440)`,context),index);
console.log(`${cases} pitch cases passed; maximum error ${maxError.toFixed(3)} cents. String checks passed.`);
