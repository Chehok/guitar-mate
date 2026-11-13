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
// Existing chord checks run without a DOM or a browser.
for(let index=0;index<6;index++)assert.equal(vm.runInContext(`nearestString(stringFrequency(${index}),440)`,context),index);
console.log(`${cases} pitch cases passed; maximum error ${maxError.toFixed(3)} cents. String checks passed.`);
