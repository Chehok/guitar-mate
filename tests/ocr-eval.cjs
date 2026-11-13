'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {evaluate}=require('../scripts/ocr-eval.cjs');
const html=fs.readFileSync('score-key-transposer.html','utf8'),c=vm.createContext({});
vm.runInContext(html.slice(html.indexOf('// Score music functions:'),html.indexOf('// End score music functions.')),c);
const files=fs.readdirSync('tests/fixtures/scores').filter(n=>n.endsWith('.json')).sort();
assert.equal(files.length,11);
for(const name of files){
const fixture=JSON.parse(fs.readFileSync('tests/fixtures/scores/'+name,'utf8'));
assert.equal(fixture.count,fixture.lines.reduce((n,l)=>n+l.chords.length,0),name);
for(const line of fixture.lines){assert(line.y>=0&&line.y<fixture.height,name);for(const chord of line.chords)assert(c.parseScoreChord(chord),name+': '+chord);}
}
for(const [raw,expected] of [['F♯m⁷','F#m7'],['E(sus4)','E(sus4)'],['C2','C2'],['Db(Bbm7)','Db(Bbm7)'],['(C/E)','(C/E)'],['Csusd','Csus4'],['D/F4','D/F#'],['C2E','C2/E'],['(Cm7','(Cm7)'],['Fm7)','(Fm7)']])assert.equal(c.normalizeScoreOCR(raw),expected);
assert.equal(c.transposeScoreChord('Db(Bbm7)',2,'Eb'),'Eb(Cm7)');
assert.equal(c.transposeScoreChord('(C/E)',2,'D'),'(D/F#)');
assert.equal(c.transposeScoreChord('F♯m⁷',1,'G'),'Gm7');
// Keyword spelling is literal; M7 and m7 keep their distinct meanings.
for(const text of ['C(SUS4)','DADD2','EMaj7','Fdim7','GAUG']){
assert.equal(c.parseScoreChord(text).text,text);
assert.equal(c.normalizeScoreOCR(text),text);
}
assert.equal(c.transposeScoreChord('C(SUS4)/E',2,'D'),'D(SUS4)/F#');
assert.equal(c.parseScoreChord('CM7').minor,false);
assert.equal(c.parseScoreChord('Cm7').minor,true);
assert.equal(c.parseScoreChord('CmMAJ7').minor,true);
assert.equal(c.normalizeScoreOCR('Da7'),'Dm7');
assert.equal(c.normalizeScoreOCR('Cadd2'),'Cadd2');
assert.equal(c.normalizeScoreOCR('a'),null);
const truth={width:400,height:400,count:4,lines:[{y:100,chords:['C','G','C']},{y:200,chords:['F']}]};
const chord=(text,x,y)=>({text,bbox:{x0:x,y0:y-5,x1:x+10,y1:y+5}});
const actual=[chord('C',10,100),chord('C',50,100),chord('G',100,100),chord('F',10,200),chord('A',20,350)];
const e=evaluate(actual,truth);assert.equal(e.correct,3);assert.equal(e.recall,.75);assert.equal(e.precision,.6);assert.equal(e.extra.length,2);assert.equal(e.missing.length,1);
// Facing pages must not share rows or let a repeated label match the other page.
const pages={width:400,height:400,count:2,lines:[{x0:0,x1:190,y:100,chords:['C']},{x0:210,x1:400,y:100,chords:['G']}]};
assert.equal(evaluate([chord('G',10,100),chord('C',250,100)],pages).correct,0);
const width=300,height=250,data=new Uint8ClampedArray(width*height*4).fill(255);
for(const top of [80,180])for(let n=0;n<5;n++)for(let x=20;x<280;x++){const i=((top+n*5)*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}
const staffs=c.scoreStaffBands({width,height,data});assert.equal(staffs.length,2);assert.equal(staffs[0].gap,5);assert.equal(staffs[1].top,180);
// Dense note beams can bridge the projection troughs; a faint staff still counts.
const dense=new Uint8ClampedArray(width*height*4).fill(255);
for(const [top,gap,ink] of [[60,4,0],[140,2,0],[200,5,225]]){
for(let n=0;n<5;n++)for(let x=20;x<280;x++){
const i=((top+n*gap)*width+x)*4;dense[i]=dense[i+1]=dense[i+2]=ink;
}
if(top===60)for(let y=61;y<77;y++)for(let x=30;x<230;x++){
const i=(y*width+x)*4;dense[i]=dense[i+1]=dense[i+2]=0;
}
}
const recovered=c.scoreStaffBands({width,height,data:dense});
assert.deepEqual(Array.from(recovered,s=>s.top),[60,140,200]);
// Red handwriting above black printed labels must not win the ink selection.
for(const [x0,y0,w,h,color] of [[40,58,8,10,[0,0,0]],[110,58,8,10,[0,0,0]],[190,58,8,10,[0,0,0]],[40,43,8,10,[210,30,30]],[190,43,8,10,[210,30,30]]])for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const i=(y*width+x)*4;data.set(color,i);}
const regions=c.scoreStaffRegions({width,height,data},staffs).filter(b=>b.staff===80);
assert.equal(regions.length,3);assert(regions.every(b=>b.ink==='neutral'&&b.y0===58));
assert(c.scoreNeutralInk(99,122,149)<195,'Subpixel colored edges in black printing survive');
assert.equal(c.scoreNeutralInk(210,100,100),255,'Red annotation pixels are removed from black ink');
console.log('Score fixtures, occurrence/order evaluation, parenthesized chords, superscripts and staff detection passed.');
