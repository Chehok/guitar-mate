'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('index.html','utf8');
assert.match(html,/>코드 검색</);
assert.match(html,/>코드 검색</);
assert.match(html,/id="identify-tab"[^>]*>코드 판별<\/a><a id="tuner-tab"/);
assert.match(html,/>악보 키 변환</);
assert.match(html,/>악보 키 변환</);
const modes=['chords','tuner','identify','score'];
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
// Native initial fragment navigation must never target a mode's panel.
for(const mode of modes){
  assert(!ids.has(mode),`#${mode} would scroll past the header`);
  assert(ids.has(`${mode}-panel`));
  assert.match(html,new RegExp(`id="${mode}-tab"[^>]*href="#${mode}"[^>]*aria-controls="${mode}-panel"`));
  assert.match(html,new RegExp(`id="${mode}-panel"[^>]*aria-labelledby="${mode}-tab"`));
}
const script=html.slice(html.indexOf('// Mode hashes are routes'),html.indexOf("window.addEventListener('hashchange',activateMode)"));
for(const hash of ['', '#chords', '#tuner', '#identify', '#score', '#unknown', '#chord-input']){
  const handlers={},location={hash},elements=new Map();
  for(const mode of modes){
    elements.set(`${mode}-panel`,{hidden:false});
    elements.set(`${mode}-tab`,{setAttribute(name,value){this[name]=value;}});
  }
  let scrollY=169,scrollX=8,stoppedMic=0,stoppedAudio=0;
  const history={scrollRestoration:'auto',replaceState(_state,_title,url){location.hash=url;}};
  const context={history,location,$:id=>{
    assert(elements.has(id),`Missing element ${id}`);return elements.get(id);
  },openScoreTab(){},stopMicrophone(){stoppedMic++;},stopPlayback(){stoppedAudio++;},window:{
    addEventListener(name,handler){handlers[name]=handler;},
    scrollTo(options){assert.equal(options.behavior,'instant');scrollY=options.top;scrollX=options.left;}
  }};
  vm.runInNewContext(script+'\nactivateMode();',context);
  assert.equal(history.scrollRestoration,'manual');
  const selected=modes.includes(hash.slice(1))?hash.slice(1):'chords';
  assert.equal(location.hash,'#'+selected);
  for(const mode of modes){
    assert.equal(elements.get(`${mode}-panel`).hidden,mode!==selected);
    assert.equal(elements.get(`${mode}-tab`)['aria-selected'],String(mode===selected));
    assert.equal(elements.get(`${mode}-tab`).tabIndex,mode===selected?0:-1);
  }
  assert.equal(stoppedMic,selected==='tuner'?0:1);
  assert.equal(stoppedAudio,1);
  handlers.load();assert.equal(scrollY,0);assert.equal(scrollX,0);
  scrollY=169;handlers.pageshow();assert.equal(scrollY,0);
  // Ordinary mode changes must not force the viewport back to the top.
  scrollY=250;location.hash='#identify';context.activateMode();assert.equal(scrollY,250);
}
console.log('Mode routes, panel accessibility, initial scroll and restored-page handling passed (no browser).');
// All four tabs participate in keyboard wrapping and Home/End navigation.
const keyScript=html.slice(html.indexOf("window.addEventListener('hashchange',activateMode)"),html.indexOf("document.addEventListener('visibilitychange'"));
const tabs=new Map();let focused,selected;
for(const mode of modes)tabs.set(mode+'-tab',{handlers:{},addEventListener(name,handler){this.handlers[name]=handler;},focus(){focused=mode;},click(){selected=mode;}});
vm.runInNewContext(keyScript,{window:{addEventListener(){}},activateMode(){},$:id=>tabs.get(id)});
for(const [from,key,to] of [['chords','ArrowLeft','score'],['score','ArrowRight','chords'],['identify','ArrowRight','tuner'],['tuner','End','score'],['score','Home','chords']]){
  tabs.get(from+'-tab').handlers.keydown({key,preventDefault(){}});
  assert.equal(focused,to);assert.equal(selected,to);
}
