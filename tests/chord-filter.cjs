'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('chord-search.html','utf8');
const {loadPage}=require('./support/page-source.cjs');
const ctx=loadPage(vm.createContext({}),'chord-search.html');
const {parse,makeVoicings}=ctx;
const run=code=>JSON.parse(JSON.stringify(vm.runInContext(code,ctx)));
// Chord data self-checks (voicings here; identification on the chord identifier page)
vm.runInContext('checkChordVoicings();',ctx);
vm.runInContext('checkChordIdentification();',loadPage(vm.createContext({}),'chord-identifier.html'));
const roots=run('filterRoots'),kinds=run('filterKinds');
assert.deepEqual(roots.slice(0,7),['C','D','E','F','G','A','B']);
assert(roots.includes('C#')&&roots.includes('F#'));
assert.equal(new Set(kinds.map(k=>k.label)).size,kinds.length);
const res=(r,k,b='none')=>JSON.parse(JSON.stringify(ctx.chordFilterResults(r,k,b)));
for(const [r,k,expect] of [['C','M','C'],['C','m','Cm'],['C','M7','Cmaj7'],['C','m7','Cm7'],['C#','m','C#m'],['F#','m7','F#m7'],['C#','m11','C#m11'],['C','sus2','Csus2'],['C','sus4','Csus4'],['C','dim','Cdim'],['C','7','C7'],['D#','aug','D#aug']]){
  assert.deepEqual(res(r,k),[expect],`${r}+${k}`);
  const chord=parse(expect);assert.equal(chord.root,r);assert(makeVoicings(chord).length>0,`${expect} has voicings`);
}
// M vs M7, m vs m7, natural vs sharp never cross-match
const all=res('all','all');
assert.equal(all.length,roots.length*kinds.length);
assert.equal(new Set(all).size,all.length);
assert.deepEqual(res('C','all').map(n=>n[0]+(n[1]==='#'?'#':'')).filter(n=>n!=='C'),[]);
assert(!res('C','all').some(n=>n.startsWith('C#')));
assert(!res('all','m').includes('Cm7')&&!res('all','M').includes('Cmaj7'));
assert.deepEqual(res('C','all'),kinds.map(k=>'C'+k.suffix),'stable kind order');
assert.deepEqual(res('all','m').slice(0,3),['Cm','Dm','Em'],'stable root order');
assert.deepEqual(res('H','m'),[]);assert.deepEqual(res('C','nope'),[]);
// every offered chord is really supported with a real voicing; tones agree with the name
for(const name of ['C#m11','F#m7','Cm7','Cmaj7']){
  const c=parse(name);for(const v of makeVoicings(c))assert(v.frets.some(f=>f>=0));
}
assert.deepEqual([...parse('Cm7').degrees],[1,3,5,7]);assert.notEqual(JSON.stringify(parse('Cm7').tones),JSON.stringify(parse('Cmaj7').tones));
for(const [r,k,b,expect] of [['C','M','G','C/G'],['C#','m7','G#','C#m7/G#'],['C','M','F#','C/F#'],['C#','M','G','C#/G'],['C','m7','A#','Cm7/A#'],['C','M7','E','Cmaj7/E'],['F#','sus4','C#','F#sus4/C#']]){
  assert.deepEqual(res(r,k,b),[expect],`${r}+${k}+${b}`);
  const c=parse(expect);assert.equal(c.root,r);assert.equal(c.bassNote,b);assert.equal(c.quality,kinds.find(x=>x.label===k).quality);
  const v=makeVoicings(c);assert(v.length>0&&v.every(x=>x.bass===c.bassPc),`${expect} voicings all have the selected bass`);
}
assert.deepEqual(res('C','M','none'),['C'],'plain chord has no slash');
assert.deepEqual(res('C','M','all').slice(0,3),['C','C/D','C/E'],'all = plain first, then bass order');
assert.equal(res('C','M','all').length,12,'plain + 11 basses (own root excluded)');
assert.deepEqual(res('C','M','C'),[],'bass equal to root is empty');assert.equal(res('C','M','C#').length,1);
assert(!res('C','all','G').some(n=>n.startsWith('C#')),'C does not match C#');
assert(res('all','m7','G#').every(n=>n.endsWith('m7/G#')),'M7/m7 never cross; bass fixed');
assert.equal(res('all','all','all').length,12*17+12*17*11,'full set');
for(const n of ['C/G','C#m7/G#','Cm7/A#','Csus2/D','Cdim/F#','C#m11/G#','Am/C']){const c=parse(n);const v=makeVoicings(c);assert(v.length>0&&v.every(x=>x.bass===c.bassPc),n);}
// Two ways to find: search (default) and a root filter.
assert.match(html,/id="mode-name"[^>]*aria-selected="true"[^>]*>검색</);
assert.match(html,/id="mode-steps"[^>]*role="tab" aria-selected="false"[^>]*>필터</);
assert.match(html,/id="chord-steps"[^>]*hidden/,'filter starts folded away');
assert.match(html,/id="step-current"[\s\S]*?id="filter-reset"[^>]*disabled[^>]*>[\s\S]*?처음부터<\/button>/,'picked chord and start-over share a row, start-over always in place');
// A root alone lists every chord kind on it, without slash chords.
const steps=code=>run(`${code};stepResults()`);
assert.deepEqual(steps('stepRoot=null'),[],'nothing before a root');
assert.equal(steps("stepRoot='C'").length,17,'root: every kind, no slash');
assert.equal(steps("stepRoot='C'")[0],'C','plain triad first');
// Switching roots keeps the chord type and slash bass.
assert.equal(run("stepRoot='C';current=parse('Csus4/G');stepCarry('D')"),'Dsus4/G');
assert.equal(run("stepRoot='C';current=parse('Cm7/D');stepCarry('D')"),'Dm7','a bass equal to the new root is dropped');
assert.equal(run("stepRoot=null;current=parse('Cm7');stepCarry('E')"),'E','first pick starts from the plain chord');
assert.match(html,/id="bass-row"[^>]*hidden[\s\S]*?id="bass-quick"/,'slash bass row sits under the chord row');
const fretboards=run("current=parse('C'); var grip=makeVoicings(current)[0]; [neck(grip,false),neck(grip,true)]");
for(const board of fretboards){
  assert.deepEqual([...board.matchAll(/>(\d+)<\/text>/g)].map(match=>Number(match[1])),Array.from({length:16},(_,i)=>i));
  assert.equal([...board.matchAll(/<circle[^>]*fill="var\(--(?:orange|green)\)"/g)].length,5,'Same open C fingering highlighted');
  const circles=board.match(/<circle[^>]+>/g);
  const inactive=circles.filter(dot=>/var\(--(?:root-soft|neck-tone-soft)\)/.test(dot));
  assert(inactive.length>0&&inactive.every(dot=>dot.includes('stroke-width="1"')),'Inactive notes have thin outlines');
  assert(circles.filter(dot=>!inactive.includes(dot)).every(dot=>!dot.includes('stroke=')),'Active notes and position markers stay unoutlined');
}
assert.match(fretboards[0],/<circle cx="40" cy="35" r="12" fill="var\(--green\)"/,'High E open note at the top on desktop');
assert.match(fretboards[1],/<circle cx="256" cy="48" r="12" fill="var\(--green\)"/,'High E open note at the right on mobile');
console.log('Chord filters, voicings, and both fretboard orientations passed.');
