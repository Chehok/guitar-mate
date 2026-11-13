'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('chord-identifier.html','utf8');
const app=html.match(/<script data-main-app[^>]*>([\s\S]*?)<\/script>/);

function eventTarget() {
  const listeners=new Map();
  return {
    addEventListener(type,fn) {
      if (!listeners.has(type)) listeners.set(type,[]);
      listeners.get(type).push(fn);
    },
    emit(type,event={}) {
      return Promise.all((listeners.get(type)||[]).map(fn=>fn({type,...event})));
    }
  };
}

function mockElement() {
  return {
    ...eventTarget(), textContent:'', children:[],
    setAttribute(){},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;},
    querySelector(){return null;}
  };
}

function loadIdentifier({suspended=false,fail=false}={}) {
  const oscillators=[];
  let finishResume;
  const param=()=>({value:1,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  const node=()=>({connect(){},disconnect(){}});
  class AudioContext {
    currentTime=1;
    state=suspended?'suspended':'running';
    destination=node();
    resume() {
      return new Promise(resolve=>{
        finishResume=()=>{this.state='running';resolve();};
      });
    }
    createGain() {
      return {...node(),gain:param()};
    }
    createBufferSource() {
      const source={
        ...node(),...eventTarget(),buffer:null,
        start(time){this.startAt=time;},
        stop(time){this.stopTimes.push(time);},
        stopTimes:[]
      };
      oscillators.push(source);
      return source;
    }
    createOscillator() {
      const oscillator={
        ...node(),...eventTarget(),
        frequency:{value:0,setValueAtTime(hz){this.value=hz;}},
        start(time){this.startAt=time;},
        stop(time){this.stopTimes.push(time);},
        stopTimes:[]
      };
      oscillators.push(oscillator);
      return oscillator;
    }
  }
  const ids=[...html.slice(0,app.index).matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  const elements=Object.fromEntries(ids.map(id=>[id,mockElement()]));
  const diagram=elements['identify-diagram'];
  diagram.querySelector=()=>({focus(){}});
  const document={
    ...eventTarget(), hidden:false, createElement:mockElement,
    getElementById:id=>elements[id],
    querySelector:()=>({dataset:{mode:'identify'}})
  };
  const window={...eventTarget(),matchMedia:()=>eventTarget(),AudioContext:fail?undefined:AudioContext};
  const sandbox={document,window,navigator:{},setTimeout(){}};
  vm.runInNewContext(require('./support/page-source.cjs').core+'\n'+app[1],sandbox);
  sandbox.pluckBuffer=(_ctx,frequency)=>({frequency}); // pitch tag instead of rendering the string
  return {
    play:elements['identify-play'],
    status:elements['identify-audio-status'],
    candidates:elements['identify-candidates'],
    start:elements['identify-start'],
    reset:()=>elements['identify-reset'].emit('click'),
    toggle:(string,fret)=>diagram.emit('click',{target:{closest:()=>({dataset:{string,fret}})}}),
    oscillators,
    finishResume:()=>finishResume()
  };
}

// One buffer source per string, started low to high across the strum.
function strummedMidi(sources) {
  return [...sources].sort((a,b)=>a.startAt-b.startAt).map(source=>Math.round(69+12*Math.log2(source.buffer.frequency/440)));
}

async function main() {
  assert.match(html,/id="identify-play"[^>]*>소리 듣기<\/button><button id="identify-reset"/);
  const page=loadIdentifier();
  assert.equal(page.play.disabled,false,'strings start open, so the open chord can be played right away');

  // Use the actual fret and play listeners. Open strings and muted strings affect the scheduled pitches.
  for (const [string,fret] of [[0,0],[2,2],[4,1]]) await page.toggle(string,fret);
  assert.equal(page.candidates.children[0].children[0].children[0].textContent,'Am7');
  await page.play.emit('click');
  const first=page.oscillators.slice();
  assert.deepEqual(strummedMidi(first),[45,52,55,60,64]);
  assert.match(page.status.textContent,/재생 중/);

  page.start.value=6;
  await page.start.emit('change');
  assert.match(page.status.textContent,/재생 중/,'scrolling the fretboard keeps the current preview');
  assert(first.every(oscillator=>oscillator.stopTimes.length===1));
  page.start.value=1;
  await page.start.emit('change');

  await page.toggle(1,0);
  assert(first.every(oscillator=>oscillator.stopTimes.length===2),'editing the fingering stops the previous chord');
  await page.reset();
  for (const [string,fret] of [[0,0],[1,0],[3,2],[4,3],[5,1]]) await page.toggle(string,fret);
  assert.equal(page.candidates.children[0].children[0].children[0].textContent,'Dm');
  await page.play.emit('click');
  const second=page.oscillators.slice(first.length);
  assert.deepEqual(strummedMidi(second),[50,57,62,65]);
  for (const oscillator of first) await oscillator.emit('ended');
  assert.match(page.status.textContent,/재생 중/,'an old preview cannot clear the new preview status');

  await page.reset();
  assert.equal(page.play.disabled,false,'reset goes back to open strings');
  assert.equal(page.status.textContent,'');
  assert(second.every(oscillator=>oscillator.stopTimes.length===2),'reset stops the active preview');

  const pending=loadIdentifier({suspended:true});
  await pending.toggle(0,1);
  await pending.toggle(1,1);
  for (const string of [2,3,4,5]) await pending.toggle(string,0); // strings start open; mute the rest
  const oldRequest=pending.play.emit('click');
  await pending.toggle(0,2);
  pending.finishResume();
  await oldRequest;
  assert.equal(pending.oscillators.length,0,'editing while audio resumes invalidates the old request');
  // Reproduce the recording: only the low E fret changes, with A held at the first fret.
  for (const [fret,midi] of [[1,41],[2,42],[3,43],[4,44],[5,45]]) {
    const previousCount=pending.oscillators.length;
    await pending.toggle(0,fret);
    await pending.play.emit('click');
    assert.deepEqual(strummedMidi(pending.oscillators.slice(previousCount)),[midi,46]);
  }
  for (const oscillator of pending.oscillators) await oscillator.emit('ended');
  assert.equal(pending.status.textContent,'재생 완료');

  const unavailable=loadIdentifier({fail:true});
  await unavailable.toggle(0,1);
  await unavailable.toggle(1,1);
  await unavailable.play.emit('click');
  assert.match(unavailable.status.textContent,/재생할 수 없습니다/);
  console.log('Identify playback: changed pitches, canceled stale previews, completion, and audio failure passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
