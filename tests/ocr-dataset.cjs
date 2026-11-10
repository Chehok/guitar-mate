'use strict';
const assert=require('node:assert/strict');
const {evaluateSequence,scoreReport}=require('../scripts/ocr-dataset.cjs');
for(const [actual,truth,counts] of [
[['C','G','C'],['C','G','C'],[3,0,0,0]],
[['C','Am','C'],['C','G','C'],[2,1,0,0]],
[['C','C'],['C','G','C'],[2,0,1,0]],
[['C','Am','G','C'],['C','G','C'],[3,0,0,1]],
[['C','C','G'],['C','G','C'],[2,0,1,1]],
[[],['C'],[0,0,1,0]],
[['C'],[],[0,0,0,1]],
[['CM7','C/E','Csus4'],['Cm7','C','C(sus4)'],[0,3,0,0]]
]){
const e=evaluateSequence(actual,truth);
assert.deepEqual([e.correct,e.wrong.length,e.missing.length,e.extra.length],counts);
assert.equal(e.correct+e.wrong.length+e.missing.length,truth.length);
assert.equal(e.correct+e.wrong.length+e.extra.length,actual.length);
}
const label={rows:[{chords:[{text:'C'},{text:'C'}]},{tokens:[{text:'G'}]}]};
assert.equal(scoreReport({codes:[{text:'C'},{text:'G'}]},label).correct,2);
assert.throws(()=>scoreReport({codes:[]},{rows:[{notes:[]}]}),/Unsupported/);
console.log('External dataset sequence alignment: repeats, order, substitutions, omissions, extras and literal spelling passed.');
