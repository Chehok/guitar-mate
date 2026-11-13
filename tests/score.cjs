'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('score-key-transposer.html','utf8');
assert.doesNotMatch(html,/name="score-mode"/);
const script=html.match(/<script data-main-app[^>]*>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const pure=script.slice(script.indexOf('// Score music functions:'),script.indexOf('// End score music functions.'));
const {core}=require('./support/page-source.cjs');
const context=vm.createContext({});vm.runInContext(core,context);vm.runInContext(pure,context);
const {parseScoreChord:parse,transposeScoreChord:transpose,capoScoreChord:capo,detectScoreKey:detect,filterScoreWords:filter}=context;
const selectImage=context.selectScoreClipboardImage;
const textItem={kind:'string',type:'text/plain'},pngItem={kind:'file',type:'image/png'},jpegItem={kind:'file',type:'image/jpeg'};
for(const items of [undefined,null,[],[textItem],[{kind:'string',type:'image/png'}],[{type:'application/pdf'}]])assert.equal(selectImage(items),null);
assert.equal(selectImage([textItem,pngItem,jpegItem]).item,pngItem,'First image after text is selected');
assert.equal(selectImage({0:pngItem,length:1}).item,pngItem,'DataTransferItemList can be array-like');
const asyncItem={types:['text/html','image/webp','image/png']};
assert.equal(selectImage([asyncItem]).item,asyncItem);
assert.equal(selectImage([asyncItem]).type,'image/webp','ClipboardItem may offer multiple representations');
assert.equal(selectImage([{type:'image/gif'}]).type,'image/gif','All image MIME types are accepted');
const key=name=>{const c=parse(name);return {pc:c.root,minor:c.minor};};
assert.equal(capo('G',1,key('G')),'F#');
assert.equal(capo('C/E',1,key('C')),'B/D#');
assert.equal(capo('Gm/Bb',1,key('Gm')),'F#m/A');
assert.equal(transpose('Gm/Bb',2,key('Am')),'Am/C');
assert.equal(transpose('D7sus4',1,key('Eb')),'Eb7sus4');
assert.equal(transpose('Am7',-2,key('G')),'Gm7');
assert.equal(transpose('C/E',-1,key('B')),'B/D#');
assert.equal(transpose('G',1,key('Ab')),'Ab');
assert.equal(transpose('G',-1,key('F#')),'F#');
assert.equal(transpose('Gm/Bb',0,key('Gm')),'Gm/Bb');
assert.equal(transpose('B♭maj7/F',2,key('C')),'Cmaj7/G');
assert.equal(transpose('F♯m7',0,key('F#m')),'F#m7');
for(const name of ['G','C/E','Gm/Bb','D7sus4','Am7','C7(b9)','F#m7b5','Cadd9','C5','Aaug','Bdim7','CM7','C6/9']){
if(name==='C6/9'){assert.equal(parse(name),null);continue;}
assert(parse(name),name);
for(let n=-11;n<=11;n++){
const result=transpose(name,n,key('C')),back=transpose(result,-n,key('C'));
assert.equal(parse(back).root,parse(name).root);
assert.equal(parse(back).bass,parse(name).bass);assert.equal(parse(back).suffix,parse(name).suffix);
}
}
for(const value of ['', 'Amazing', 'Capo','Bridge','Amor','Guitar','H7','C//E','C()','Gmm','Cmajmaj','C/Eb/G',null,'<img>'])assert.equal(parse(value),null,String(value));
for(const fret of [-1,12,1.5])assert.equal(capo('G',fret,key('G')),null);
assert.equal(transpose('G',NaN),null);
assert.equal(detect([]),null);
assert.equal(detect(['G','C','D7','G']).name,'G');
assert.equal(detect(['Am','Dm','E7','Am']).name,'Am');
assert.equal(detect(['Bb','Eb','F7','Bb']).name,'Bb');
assert.equal(detect(['C','G','Am','F','C']).name,'C');
// Intro recommendations: no doubled chords, dominant pickups, optional chords and the closing phrase.
{
  const intros=chords=>{const r=context.recommendScoreIntros(detect(chords),chords);return [r.easy,r.basedOnOpening,r.basedOnEnding].map(x=>Array.from(x).join(' '));};
  assert.deepEqual(intros(['C','G','Am','F','C']),['C Am Dm G7','C G Am G7','G Am F C']);
  assert.deepEqual(intros(['G','G','C','D','G']).slice(1),['G C D D7','G C D G'],'Repeated chords are read once');
  assert.deepEqual(intros(['Am','Dm','E7','Am']).slice(1),['Am Dm Am E7','Am Dm E7 Am'],'The lead chord is not played twice');
  assert.deepEqual(intros(['D7','G','C','D7','G']),['G Em C Am7','G C G Am7','G C D7 G'],'A dominant pickup is approached from ii');
  assert.deepEqual(intros(['C','(G)','C/B','Am(G)','F','C']).slice(1),['C C/B Am G7','C/B Am F C'],'Optional chords are skipped');
  assert.deepEqual(intros(['G','D7','G']).slice(2),[''],'The closing phrase needs four chords');
}
// Added chords join their own line in reading order, even with different glyph tops.
{
  const box=(x,y,h=18)=>({x0:x,y0:y,x1:x+30,y1:y+h});
  const codes=[{text:'Gm7/B',bbox:box(50,198,22)},{text:'C',bbox:box(200,201)},{text:'Dsus4',bbox:box(350,199)},{text:'Em',bbox:box(50,300)}];
  for(const [text,bbox] of [['A',box(280,203,12)],['F',box(10,250,12)],['B',box(500,400,12)],['D',box(10,20,12)]])context.insertScoreCode(codes,{text,bbox});
  assert.deepEqual(codes.map(c=>c.text),['D','Gm7/B','C','A','Dsus4','F','Em','B']);
}
const word=(text,x,y,h=18,confidence=95)=>({text,confidence,bbox:{x0:x,y0:y,x1:x+35,y1:y+h}});
const words=[word('G',50,200),word('C/E',300,200),word('D7sus4',50,400),word('Am7',300,400),word('G',500,5,65),word('C',50,500,18,10),word('G',50,600),word('sing',100,600),word('along',180,600),word('A',50,20),word('Bm',50,720,1),word('Em',-1,800)];
assert.deepEqual(Array.from(filter(words,1000,1000),w=>w.text),['G','C/E','D7sus4','Am7']);
// OCR repairs stay separate from manual input parsing, and never guess a bare 0.
const {normalizeScoreOCR:normalize,scoreImageSize:imageSize,resizeScorePixels:resize,preprocessScorePixels:preprocess,scoreOCRWords:ocrWords,mergeScoreOCR:merge}=context;
for(const [raw,expected] of [[' B♭m7 / F♯ ','Bbm7/F#'],['F＃m7','F#m7'],['G∕B','G/B'],['G\\B','G/B'],['Bb','Bb'],['bm7','Bm7'],['CM1','CM7'],['Cml','Cm7'],['DIl','D11'],['C1','C7'],['0m7','Dm7'],['07','D7'],['CM7','CM7'],['Cm7','Cm7'],['D7sus4','D7sus4'],['C13','C13'],['G7/B','G7/B']])assert.equal(normalize(raw),expected,raw);
for(const [raw,expected] of [
['F♭m7/B♯','Fbm7/B#'],['E♭/G♭','Eb/Gb'],['A/C♯','A/C#'],['Gm/B♭','Gm/Bb'],
['Gm/B6','Gm/Bb'],['Gm/B)','Gm/Bb'],['Gm/g)','Gm/Bb'],['Gm/b)','Gm/Bb'],
['F6m7','Fbm7'],['B)m7/F','Bbm7/F'],['C6','C6'],['B6','B6'],['C7(b9)','C7(b9)'],
['A/c','A/C#'],['Alc','A/C#'],['Alcs','A/C#'],['A/ci','A/C#'],['A/C','A/C'],
['C/i','C/D'],['CiD','C/D'],['GiB','G/B'],['G/b','G/B'],['C/e','C/E'],['C/f#','C/F#'],['C/gb','C/Gb'],['C/g6','C/Gb']
])assert.equal(normalize(raw),expected,raw);
for(const raw of ['0','O','1','l','7','a','sing','Amazing','C/0','C/1','C118','Gmumble',null])assert.equal(normalize(raw),null,String(raw));
assert.equal(parse('CM1'),null,'Manual chord input must not use OCR guesses');
for(const raw of ['Gm/B6','Gm/g)','Alc','A/c','C/i','CiD'])assert.equal(parse(raw),null,raw);
assert.equal(parse('A/C').text,'A/C','A literal natural bass must remain natural');
assert.equal(parse('B6').suffix,'6','A sixth is not a flat');
assert.deepEqual({...imageSize(437,585,true)},{width:1311,height:1755});
assert.deepEqual({...imageSize(1800,1000,true)},{width:3286,height:1826});
assert.deepEqual({...imageSize(8000,4000)},{width:4096,height:2048});
for(const [w,h] of [[4000,3000],[8000,8000],[1,8000],[8000,1]]){
const size=imageSize(w,h,true);assert(Math.max(size.width,size.height)<=4096);assert(size.width*size.height<=6005000);
}
const pixels=(w,h,fn)=>({width:w,height:h,data:Uint8ClampedArray.from(Array.from({length:w*h},(_,p)=>[...fn(p%w,Math.floor(p/w)),255]).flat())});
const colorful=pixels(4,1,x=>[[210,15,15],[240,130,15],[20,20,20],[245,245,245]][x]);
const before=Array.from(colorful.data),mask=preprocess(colorful,'color');
assert.deepEqual([0,1,2,3].map(p=>mask.data[p*4]),[0,0,255,255],'Color mask drops neutral staff/lyrics while keeping red and orange');
assert.deepEqual(Array.from(colorful.data),before,'Variants must not mutate shared color pixels');
assert.equal(preprocess(pixels(1,1,()=>[15,70,200]),'color').data[0],0,'Blue chords also survive');
const alpha={width:1,height:1,data:Uint8ClampedArray.from([0,0,0,0])};
assert.deepEqual(Array.from(resize(alpha,2,2).data),Array(16).fill(255),'Transparent backgrounds become white');
const scaled=resize(pixels(2,1,x=>x?[255,255,255]:[0,0,0]),6,3);
assert.equal(scaled.width,6);assert.equal(scaled.height,3);assert(scaled.data[8]>0&&scaled.data[8]<255,'Upscaling interpolates edges');
const shaded=pixels(90,30,(x,y)=>{const paper=x<45?150:240,ink=(x===15||x===65)&&y>=10&&y<=20;return Array(3).fill(ink?paper-65:paper);});
const binary=preprocess(shaded,'adaptive'),gray=preprocess(shaded,'gray');
for(const x of [15,65])assert.equal(binary.data[(15*90+x)*4],0,'Ink survives across unequal lighting');
for(const x of [30,80])assert.equal(binary.data[(15*90+x)*4],255,'Unequal paper backgrounds stay white');
assert(gray.data[(15*90+15)*4]<gray.data[(15*90+30)*4]);
assert(binary.data.every((v,i)=>i%4===3?v===255:v===0||v===255));
// Region grouping preserves nearby glyphs and separates distant chords from neutral staff.
const redScore=pixels(200,200,(x,y)=>y>=60&&y<68&&((x>=20&&x<24)||(x>=26&&x<30)||(x>=90&&x<94))?[190,20,20]:[240,240,240]);
const regions=context.scoreRedRegions(redScore);
assert.deepEqual(Array.from(regions,b=>[b.x0,b.y0,b.x1,b.y1]),[[20,60,30,68],[90,60,94,68]]);
const screenshot=pixels(200,200,(x,y)=>(((y>=60&&y<68)||(y>=120&&y<128))&&((x>=20&&x<24)||(x>=90&&x<94)))||((y>=20&&y<28||y>=170&&y<178)&&x>=50&&x<54)?[190,20,20]:[255,255,255]);
assert.equal(context.scoreRedRegions(screenshot).length,4,'Repeated chord rows exclude screenshot logos and controls');
const crop=context.scoreRegionPixels(redScore,regions[0]);
assert.equal(crop.width,88);assert.equal(crop.height,80);
const binaryCrop=context.scoreRegionPixels(redScore,regions[0],true);
assert.equal(binaryCrop.width,crop.width);assert.equal(binaryCrop.height,crop.height);
assert(binaryCrop.data.every((v,i)=>i%4===3?v===255:v===0||v===255),'Individual region retry uses binary pixels');
assert.equal(normalize('A/C♯'),'A/C#');assert.equal(normalize('Gm/B♭'),'Gm/Bb');
assert.equal(normalize('D73us4'),'D7sus4');assert.equal(normalize('G'),'G');assert.equal(normalize('C'),'C');
// Scaled coordinates, split suffixes and slash tokens are folded before bbox deduplication.
const split=[word('B',150,600),{...word('b',187,600),bbox:{x0:187,y0:600,x1:198,y1:618}},word('G',500,600),{...word('/',537,600),bbox:{x0:537,y0:600,x1:545,y1:618}},word('B',547,600)];
const candidates=ocrWords(split,{width:3000,height:3000},{width:1000,height:1000},'gray');
const merged=merge(candidates);
assert.deepEqual(Array.from(merged,c=>c.text),['Bb','G/B']);
assert.equal(merged[0].bbox.x0,50);assert.equal(merged[0].bbox.x1,66);
const duplicate=word('CM7',50,200,18,85),short=word('C',50,201,17,88),repeat=word('CM7',350,200,18,80);
assert.deepEqual(Array.from(merge([short,duplicate,{...duplicate,variant:'color'},repeat]),c=>c.text),['CM7','CM7'],'Repeated occurrences survive; overlapping partial/conflicting OCR does not');
const uncertain=[word('Am7',50,200,18,35)];
assert.equal(ocrWords(uncertain,{width:1000,height:1000},{width:1000,height:1000},'gray').length,0);
assert.equal(ocrWords(uncertain,{width:1000,height:1000},{width:1000,height:1000},'color').length,1);
assert.deepEqual(Array.from(merge([word('G/B',350,198),word('CM7',50,200)]),c=>c.text),['CM7','G/B'],'Read a chord row from left to right despite differing glyph heights');

// No browser: execute actual UI wiring with small DOM/canvas doubles.
class Element{
constructor(){this.children=[];this.value='';this.style={};this.dataset={};this.handlers={};this.classList={toggle(){},remove(){},add(){}};this.hidden=false;}
append(...children){this.children.push(...children);}
replaceChildren(...children){this.children=children;}
setAttribute(name,value){this[name]=value;}
addEventListener(name,handler){this.handlers[name]=handler;}
remove(){} close(){} showModal(){} focus(){}
getContext(){return painter;}
}
const paint=[];
const painter={drawImage(...a){paint.push(['image',...a]);},getImageData(_x,_y,w=1,h=1){return {data:new Uint8ClampedArray(w*h*4).fill(255)};},createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},putImageData(){},measureText(text){return {width:text.length*12};},fillRect(...a){paint.push(['mask',...a]);},fillText(...a){paint.push(['text',...a]);}};
const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const documentHandlers={};
const head=new Element(),start=script.indexOf('// Score editor: images');
const ui=script.slice(start,script.indexOf('// Stop sound when the page goes away.',start));
Object.assign(context,{painter,$,ready:modes=>modes.includes('score'),document:{getElementById:id=>$(id),querySelector:selector=>selector==='[data-main-app]'?{dataset:{mode:'score'}}:null,addEventListener:(name,handler)=>{documentHandlers[name]=handler;},createElement:()=>new Element(),head,querySelectorAll:()=>[],activeElement:null},window:{},navigator:{onLine:true},setTimeout,clearTimeout,requestAnimationFrame:callback=>{callback();return 1;},cancelAnimationFrame(){},localStorage:{getItem:()=>null}});
vm.runInContext(ui,context);
context.loadScoreRecognizer=async()=>{throw Error('Exercise legacy fallback in DOM doubles');};
assert.equal(head.children.length,0,'OCR must not download at app startup');
assert.equal(head.children.length,0,'Opening the page must not download OCR');
assert.equal($('score-frets').children.length,11);
$('score-frets').children[0].handlers.click();
assert.equal($('score-capo-value').textContent,'카포 1');
assert.equal($('score-frets').children[0]['aria-pressed'],'true');
$('score-capo-minus').handlers.click();
vm.runInContext("scoreState.source={width:1000,height:1000,getContext:()=>({getImageData:()=>({data:[255,255,255,255]})})};scoreState.image={};scoreState.codes=[{text:'G',bbox:{x0:50,y0:200,x1:85,y1:218}}];scoreState.capo=1;",context);
context.drawScore(new Element(),false);
assert(paint.some(call=>call[0]==='text'&&call[1]==='F#'));
assert(paint.some(call=>call[0]==='mask'&&call[2]===198),'Replacement covers original bbox');
paint.length=0;context.drawScore(new Element(),true);assert.deepEqual(paint.map(p=>p[0]),['image']);
paint.length=0;vm.runInContext("scoreState.overlay='above'",context);context.drawScore(new Element(),false);
assert(paint.find(p=>p[0]==='text')[3]<200,'Above mode draws above original chord');
// Capo view: "−" below capo 0 lowers the key (never a negative fret); + returns the same way.
{
  const click=id=>$(id).handlers.click(),state=()=>JSON.parse(vm.runInContext('JSON.stringify([scoreState.capo,-scoreState.keyShift])',context));
  const shown=chord=>vm.runInContext(`transformedScoreChord(${JSON.stringify(chord)},{pc:7,minor:false,name:'G'})`,context);
  vm.runInContext("scoreState.capo=0;scoreState.keyShift=0;",context);
  context.renderScore();assert(!$('score-capo-minus').disabled,'− is available at capo 0');
  assert.equal(shown('G'),'G');
  click('score-capo-minus');assert.deepEqual(state(),[0,1]);
  assert.equal(shown('G'),'F#');assert.equal(shown('C/E'),'B/D#');assert.equal(shown('Gm/Bb'),'F#m/A');assert.equal(shown('Em7'),'D#m7');
  assert.equal($('score-capo-value').textContent,'카포 X · −1키');assert.match($('score-result-key').textContent,/소리의 키/);
  assert(!/카포 −/.test($('score-capo-value').textContent));
  click('score-capo-minus');assert.deepEqual(state(),[0,2]);assert.equal(shown('G'),'F');
  for(let i=0;i<20;i++)click('score-capo-minus');assert.deepEqual(state(),[0,11]);assert($('score-capo-minus').disabled);
  for(let i=0;i<11;i++)click('score-capo-plus');assert.deepEqual(state(),[0,0]);assert.equal(shown('G'),'G');
  click('score-capo-plus');assert.deepEqual(state(),[1,0]);assert.equal(shown('G'),'F#');
  click('score-capo-minus');assert.deepEqual(state(),[0,0]);click('score-capo-minus');assert.deepEqual(state(),[0,1]);
  $('score-frets').children[2].handlers.click();assert.deepEqual(state(),[3,1],'a fret keeps the song key change');
  assert.equal($('score-capo-value').textContent,'카포 3 · −1키');
  click('score-capo-minus');click('score-capo-minus');click('score-capo-minus');click('score-capo-minus');assert.deepEqual(state(),[0,2]);
  // The key is set in one place only: the neck under the sheet.
  assert(!/id="score-shift-/.test(html),'no second key control on the sheet');
  vm.runInContext("scoreState.capo=1;scoreState.keyShift=0;",context);
}
// Recommendations follow the actual score controls and keep four bars per progression.
{
  const bars=id=>$(id).children.map(item=>item.children[1].textContent);
  const easy='score-intro-easy',opening='score-intro-opening';
  vm.runInContext("scoreState.codes=[];scoreState.capo=0;",context);
  context.renderScore();assert(!$('score-intro-open').hidden,'Intro button is there before any chord is found');assert(!$('score-intro-empty').hidden,'Without a key the dialog explains what is coming');
  vm.runInContext("scoreState.codes=['C','G','Am','F','C'].map((text,i)=>({text,bbox:{x0:50+i*90,y0:200,x1:85+i*90,y1:218}}));",context);
  context.renderScore();
  assert(!$('score-intro-open').hidden,'Recommended intros open from a button beside manual add');
  assert.deepEqual(bars(easy),['C','Am','Dm','G7']);
  assert.deepEqual(bars(opening),['C','G','Am','G7']);
  assert.deepEqual(bars('score-intro-ending'),['G','Am','F','C'],'The closing phrase is offered as an intro');
  assert($('score-intro-more').hidden);
  $('score-frets').children[1].handlers.click();
  assert.deepEqual(bars(easy),['Bb','Gm','Cm','F7']);
  assert.deepEqual(bars(opening),['Bb','F','Gm','F7']);
  for(let i=0;i<3;i++)$('score-capo-minus').handlers.click();
  assert.deepEqual(bars(easy),['B','G#m','C#m','F#7']);
  assert.deepEqual(bars(opening),['B','F#','G#m','F#7']);
  vm.runInContext("scoreState.codes.length=2;scoreState.keyShift=0;",context);
  context.renderScore();assert.deepEqual(bars(opening),['C','G','Am','G7']);
  assert($('score-intro-ending').hidden);assert($('score-intro-ending-title').hidden);assert(!$('score-intro-more').hidden);
  vm.runInContext("scoreState.codes.length=1;scoreState.capo=1;",context);
  context.renderScore();assert($(opening).hidden);assert(!$('score-intro-more').hidden);
}
async function checkIntroActions(){
  vm.runInContext(script.slice(script.indexOf('const mod='),script.indexOf('let current=null')),context);
  vm.runInContext("scoreState.codes=['C','G','Am','F','C'].map((text,i)=>({text,bbox:{x0:50+i*90,y0:200,x1:85+i*90,y1:218}}));",context);
  const bars=[],strums=[],stopped=[];
  context.prepareAudio=async()=>({currentTime:10});
  context.confirmPlayback=()=>{};
  // Every pulse is strummed; the full-volume downbeat stands for the bar.
  context.scheduleChordNotes=(_ctx,notes,at,_decay,level=1)=>{
    const strum={pitches:[...new Set(Array.from(notes,n=>n.midi%12))].sort((a,b)=>a-b),at,level,count:notes.length};
    strums.push(strum);if(level===1)bars.push(strum);
    return [{voice:{stop:()=>stopped.push(at)},oscs:[{addEventListener(){}}]}];
  };
  const easy=$('score-intro-easy-play'),opening=$('score-intro-opening-play');
  $('score-frets').children[1].handlers.click();
  await easy.onclick();
  assert.deepEqual(bars.map(bar=>bar.at),[10.04,12.04,14.04,16.04]);
  assert.deepEqual(bars[0].pitches,[0,4,7],'Bb shapes with capo 2 sound in C');
  assert.equal(easy.textContent,'중지');
  await opening.onclick();
  assert.equal(stopped.length,16,'Switching recommendations stops all scheduled bars');
  assert.deepEqual(bars[5].pitches,[2,7,11],'Opening progression plays its own second bar');
  for(let i=0;i<3;i++)$('score-capo-minus').handlers.click();
  assert.equal(stopped.length,32,'Changing key or capo stops playback');
  await easy.onclick();
  assert.deepEqual(bars[8].pitches,[3,6,11],'Lowering the key one semitone sounds in B');
  assert.deepEqual(strums.slice(-16,-12).map(s=>[Number((s.at-10.04).toFixed(3)),s.level]),[[0,1],[.5,.45],[1,.7],[1.5,.45]],'4/4 strums every quarter note');
  assert(strums.at(-15).count<=3,'Weak beats brush the top strings');
  // Tempo: 4/4 bars, changing it stops playback, typing a partial number waits for a valid value.
  $('score-intro-tempo-range').value='90';$('score-intro-tempo-range').handlers.input();
  assert.equal(stopped.length,48,'Changing the tempo stops playback');
  assert.equal($('score-intro-tempo-value').value,'90');
  assert.match($('score-intro-tempo-note').textContent,/2\.7초/);
  await easy.onclick();
  assert.deepEqual(bars.slice(12).map(bar=>Number(bar.at.toFixed(3))),[10.04,12.707,15.373,18.04],'90 BPM spaces bars 2.67 seconds apart');
  await easy.onclick();
  $('score-intro-tempo-value').value='9';$('score-intro-tempo-value').handlers.input();
  assert.equal(vm.runInContext('scoreState.introTempo',context),90,'A partial number does not change the tempo');
  $('score-intro-tempo-value').value='500';$('score-intro-tempo-value').handlers.change();
  assert.equal($('score-intro-tempo-value').value,'180');
  $('score-intro-tempo-value').value='';$('score-intro-tempo-value').handlers.change();
  assert.equal($('score-intro-tempo-value').value,'180','An empty field restores the tempo');
  $('score-intro-tempo-range').value='120';$('score-intro-tempo-range').handlers.input();
  // Meter: 3/4 and 6/8 (BPM counts dotted quarters) change bar length and strum pulses.
  await easy.onclick();const beforeMeter=stopped.length;
  context.setScoreIntroMeter('3/4');
  assert(stopped.length>beforeMeter,'Changing the meter stops playback');
  assert.equal($('score-intro-tempo-note').textContent,'3/4박자 · 한 마디 1.5초');
  let first=strums.length;await easy.onclick();
  assert.deepEqual(strums.slice(first,first+6).map(s=>Number((s.at-10.04).toFixed(3))),[0,.5,1,1.5,2,2.5]);
  assert.equal(strums.length-first,12,'3 pulses x 4 bars');
  await easy.onclick();context.setScoreIntroMeter('6/8');
  assert.match($('score-intro-tempo-note').textContent,/6\/8박자 · 점4분음표 기준 · 한 마디 1\.0초/);
  first=strums.length;await easy.onclick();
  assert.deepEqual(strums.slice(first,first+6).map(s=>[Number((s.at-10.04).toFixed(3)),s.level]),[[0,1],[.167,.35],[.333,.35],[.5,.7],[.667,.35],[.833,.35]]);
  await easy.onclick();context.setScoreIntroMeter('bogus');
  assert.equal(vm.runInContext('scoreState.introMeter',context),'6/8');
  context.setScoreIntroMeter('4/4');
  let opened=0;$('score-intro-dialog').showModal=()=>{opened++;};
  $('score-intro-open').handlers.click();assert.equal(opened,1);
  $('score-intro-opening-place').onclick();
  assert($('score-manual-position').hidden,'Placing an intro needs no position step');
  assert.equal(vm.runInContext('scoreState.codes.length',context),5,'An inserted intro stays separate from recognized chords');
  const introAt=()=>JSON.parse(vm.runInContext('JSON.stringify([scoreState.intro.x,scoreState.intro.y])',context));
  assert.deepEqual(introAt(),[20,59],'A new intro starts near the top-left corner, just below the key stamp');
  // Key stamp: top-left corner, follows capo/key changes, can be turned off, never in original view.
  {
    const stampOf=()=>{paint.length=0;context.drawScore(new Element(),false);return paint.filter(c=>c[0]==='text').map(c=>c[1]).find(t=>t.match(/(폼|키)/));};
    const capo=vm.runInContext('scoreState.capo',context),keyShift=vm.runInContext('scoreState.keyShift',context);
    vm.runInContext('scoreState.capo=0;scoreState.keyShift=0;',context);
    assert.equal(stampOf(),'C키','Stamp shows the detected key');
    const call=paint.find(c=>c[0]==='text'&&c[1]==='C키');assert.deepEqual([call[2],call[3]],[22,22],'Stamp sits in the top-left corner');
    vm.runInContext('scoreState.capo=2;',context);
    assert.equal(stampOf(),'Bb폼 (Capo 2) / C키','Capo stamp keeps the sounding key and names the chord shapes');
    vm.runInContext('scoreState.capo=0;scoreState.keyShift=-2;',context);
    assert.equal(stampOf(),'Bb키','Lowering the key stamps the new key');
    vm.runInContext('scoreState.capo=3;scoreState.keyShift=2;',context);
    assert.equal(stampOf(),'B폼 (Capo 3) / D키','Key change and capo together');
    vm.runInContext('scoreState.capo=0;scoreState.keyShift=0;',context);
    $('score-key-stamp').checked=false;$('score-key-stamp').handlers.change();
    assert.equal(stampOf(),undefined,'Stamp can be turned off');
    $('score-key-stamp').checked=true;$('score-key-stamp').handlers.change();
    paint.length=0;context.drawScore(new Element(),true);assert.deepEqual(paint.map(p=>p[0]),['image'],'Original view stays untouched');
    vm.runInContext(`scoreState.capo=${capo};scoreState.keyShift=${keyShift};`,context);paint.length=0;context.drawScore(new Element(),false);
  }
  assert(paint.some(call=>call[0]==='text'&&call[1]==='|  B  |  F#  |  G#m  |  F#7  |'),'Intro is drawn without a label');
  assert(!paint.some(call=>call[0]==='text'&&String(call[1]).includes('전주')));
  $('score-frets').children[1].handlers.click();
  paint.length=0;context.drawScore(new Element(),false);
  const intro=paint.find(call=>call[0]==='text'&&call[1].startsWith('|  '));
  assert.equal(intro[1],'|  A  |  E  |  F#m  |  E7  |','PNG drawing uses the current key change and capo shapes');
  assert(intro[2]+intro[4]<=1000,'Placed intro stays inside the image');
  paint.length=0;context.drawScore(new Element(),true);assert.deepEqual(paint.map(p=>p[0]),['image']);
  context.renderScore();
  // Pointer drag: the preview is shown at half size, so 1 CSS px moves 2 image px.
  $('score-canvas').getBoundingClientRect=()=>({left:0,top:0,width:500,height:500});
  const drag=(button,dx,dy)=>{
    button.handlers.pointerdown({pointerId:7,button:0,clientX:10,clientY:10});
    button.handlers.pointermove({pointerId:7,clientX:10+dx,clientY:10+dy,preventDefault(){}});
    button.handlers.pointerup({pointerId:7});
  };
  const introHit=()=>$('score-hit-layer').children.at(-1);
  let hit=introHit();drag(hit,100,150);
  assert.deepEqual(introAt(),[220,359],'Dragging moves the intro');
  hit.handlers.click();assert.equal(opened,1,'The click that ends a drag does not open the dialog');
  hit=introHit();hit.handlers.pointerdown({pointerId:8,button:0,clientX:5,clientY:5});hit.handlers.pointerup({pointerId:8});hit.handlers.click();
  assert.equal(opened,2,'A plain tap on the intro opens recommendations');
  drag(introHit(),5000,5000);
  const [farX,farY]=introAt();assert(farX>0&&farX<1000&&farY>0&&farY<1000,'Dragging stays inside the image');
  introHit().handlers.keydown({key:'ArrowLeft',preventDefault(){}});
  assert.equal(introAt()[0],farX-10,'Arrow keys nudge the intro by 1%');
  assert(!$('score-intro-remove').hidden);
  // Intro size: −/+ in the dialog (and +/− keys on the score) scale the drawn label, within 50–200%.
  {
    const introFont=()=>{paint.length=0;context.drawScore(new Element(),false);return vm.runInContext('scoreState.intro.scale',context);};
    const widthAt=()=>context.drawScore(new Element(),false).intro.width;
    assert(!$('score-intro-size').hidden,'Size control appears once an intro is placed');
    assert.equal($('score-intro-size-value').textContent,'100%');
    const base=widthAt();
    $('score-intro-bigger').handlers.click();
    assert.equal(introFont(),1.2);assert.equal($('score-intro-size-value').textContent,'120%');
    assert(widthAt()>base,'A bigger intro is drawn wider');
    for(let i=0;i<20;i++)$('score-intro-smaller').handlers.click();
    assert.equal(introFont(),.5,'Size stops at 50%');assert($('score-intro-smaller').disabled);
    assert(widthAt()<base,'A smaller intro is drawn narrower');
    introHit().handlers.keydown({key:'+',preventDefault(){}});
    assert.equal(introFont(),.6,'The + key enlarges the focused intro');
    for(let i=0;i<20;i++)introHit().handlers.keydown({key:'=',preventDefault(){}});
    assert.equal(introFont(),2,'Size stops at 200%');assert($('score-intro-bigger').disabled);
    introHit().handlers.keydown({key:'-',preventDefault(){}});
    assert.equal(introFont(),1.8,'The − key shrinks the focused intro');
    const hit=context.drawScore(new Element(),false).intro;assert(hit.x+hit.width<=1000,'A large intro stays inside the image');
    $('score-intro-opening-place').onclick();
    assert.equal(vm.runInContext('scoreState.intro.scale',context),1.8,'Placing another intro keeps the chosen size');
  }
  $('score-intro-remove').handlers.click();
  assert.equal(vm.runInContext('scoreState.intro',context),null);
  assert($('score-intro-size').hidden,'Size control hides when the intro is removed');
  const submit=()=>$('score-edit-form').handlers.submit({preventDefault(){}});
  const position=(x,y)=>{
    $('score-pos-x').value=String(x);$('score-pos-y').value=String(y);
    $('score-position-add').handlers.click();
  };
  vm.runInContext("scoreState.overlay='above';",context);
  $('score-add').handlers.click();position(25,40);
  $('score-edit-text').value='invalid';submit();
  assert.match($('score-edit-error').textContent,/코드 형식/);
  $('score-edit-text').value='Am';submit();
  let added=$('score-hit-layer').children.at(-1);
  assert.equal(added.style.top,'40%','Manually added chord stays at the chosen position in above mode');
  assert.match(added.className,/draggable/,'Manually added chords can be dragged');
  assert.doesNotMatch($('score-hit-layer').children[0].className,/draggable/,'Recognized chords stay tap-to-edit');
  assert.equal($('score-hit-layer').children[0].handlers.pointerdown,undefined);
  added.handlers.click();assert.equal($('score-edit-text').value,'Am');
  $('score-edit-text').value='G7';submit();
  $('score-code-list').children.at(-1).handlers.click();
  assert.equal($('score-edit-text').value,'G7');
  drag($('score-hit-layer').children.at(-1),50,25);
  added=$('score-hit-layer').children.at(-1);
  assert.equal(added.style.left,'35%');assert.equal(added.style.top,'45%');
  assert.match($('score-status').textContent,/옮겼어요/);
  added.handlers.click();
  $('score-delete').handlers.click();
  assert.equal(vm.runInContext('scoreState.codes.length',context),5);
}
async function checkOCR(){
let regionPSM,regionCalls=0;
const regionResult=await context.runScoreOCRPasses({setParameters:async p=>{regionPSM=p.tessedit_pageseg_mode;},recognize:async()=>{
if(regionPSM==='11')return {data:{words:[]}};
return {data:{text:regionCalls++?'G':'Gm/B♭',confidence:90}};
}},redScore,image=>image);
assert.deepEqual(Array.from(regionResult,w=>w.text),['Gm/Bb','G']);
assert.equal(regionCalls,2,'Single-character chords survive region OCR without a neighbouring chord');

// Confidence-zero accidentals need matching reads; one unsupported guess stays out.
let activeRegion=-1,attempt=0;const retryCalls=[];
const repaired=await context.runScoreOCRPasses({setParameters:async()=>{},recognize:async()=>{
if(activeRegion<0)return {data:{words:[]}};
const texts=activeRegion===0?['Gm/g)','Gm/g)']:['C/','C/i','CiD'];
retryCalls[activeRegion]=(retryCalls[activeRegion]||0)+1;
return {data:{text:texts[attempt++]||'',confidence:0}};
}},redScore,image=>image,(_index,_total,name)=>{if(name==='region'){activeRegion++;attempt=0;}});
assert.deepEqual(Array.from(repaired,w=>w.text),['Gm/Bb','C/D']);
assert.deepEqual(retryCalls,[2,3],'Unresolved slash bass retries with a binary crop');
assert(repaired.every(w=>w.confidence===0&&w.support===2),'Consensus preserves the raw OCR confidence');
activeRegion=-1;attempt=0;
const unsupported=await context.runScoreOCRPasses({setParameters:async()=>{},recognize:async()=>{
if(activeRegion<0)return {data:{words:[]}};
return {data:{text:attempt++===0?'Gm/g)':'noise',confidence:0}};
}},redScore,image=>image,(_index,_total,name)=>{if(name==='region'){activeRegion++;attempt=0;}});
assert.equal(unsupported.length,0,'A single confidence-zero repair is insufficient');

let params,terminated=0,recognized=0;const progress=[];
vm.runInContext("scoreState.source={width:300,height:300,getContext:()=>painter}",context);
context.window.Tesseract={createWorker:async(lang,oem,options,config)=>{
assert.equal(lang,'eng');assert(options.workerPath.startsWith('https://cdn.jsdelivr.net/'));assert.equal(config.load_system_dawg,'0');
return {setParameters:async p=>{params=p;},recognize:async canvas=>{assert.equal(canvas.width,900);assert.equal(canvas.height,900);recognized++;options.logger({status:'recognizing text',progress:.5});progress.push($('score-status').textContent);return {data:{words:[word('G',90,270,30),word('D7',600,270,30)]}};},terminate:async()=>{terminated++;}};
}};
await context.recognizeScore();
assert(params.tessedit_char_whitelist.includes('♭♯'));assert.equal(params.tessedit_pageseg_mode,'11');assert.equal(recognized,3);assert.equal(terminated,1);
assert.deepEqual(progress.map(text=>text.match(/(\d+)%/)[1]),['17','50','83']);
assert.equal(vm.runInContext('scoreState.codes.length',context),2);
assert.equal($('score-file').disabled,false);
assert($('score-code-list').children.every(b=>!b.disabled),'Editing enabled after OCR finishes');
context.navigator.onLine=false;await context.recognizeScore();assert.equal(recognized,3);assert.match($('score-status').textContent,/오프라인/);
context.navigator.onLine=true;context.window.Tesseract.createWorker=async()=>{throw Error('unavailable');};
await context.recognizeScore();assert.match($('score-status').textContent,/직접 추가/);assert.equal($('score-add').disabled,false);
assert.equal(vm.runInContext('scoreState.codes.length',context),2,'Failed retry keeps previous edits');
// Cancelled work cannot replace manual edits, or disable controls after a new job.
let finish;
context.window.Tesseract.createWorker=async()=>({setParameters:async()=>{},recognize:()=>new Promise(resolve=>{finish=resolve;}),terminate:async()=>{}});
const pending=context.recognizeScore();
for(let i=0;i<30&&!finish;i++)await new Promise(resolve=>setTimeout(resolve,0));
assert(finish);assert.equal($('score-add').disabled,false);
$('score-add').handlers.click();
assert.equal($('score-manual-position').hidden,false);
finish({data:{words:[]}});await pending;
assert.equal(vm.runInContext('scoreState.codes.length',context),2);
assert.equal($('score-add').disabled,false);
$('score-add').handlers.click();
// Library download fails cleanly and can be retried.
delete context.window.Tesseract;
const loading=context.loadScoreLibrary();assert.equal(head.children.length,1);head.children[0].onerror();await assert.rejects(loading);
const retry=context.loadScoreLibrary();context.window.Tesseract={};head.children[1].onload();await retry;
assert.equal(head.children.length,2);
// File validation and downscaling use the same dimensions as OCR and export.
$('score-file').files=[{type:'text/plain',size:100}];
await $('score-file').handlers.change();assert.match($('score-status').textContent,/20MB/);
$('score-file').files=[{type:'image/png',size:20*1024*1024+1}];
await $('score-file').handlers.change();assert.match($('score-status').textContent,/20MB/);
let revoked=0;
context.URL={createObjectURL:()=> 'blob:test',revokeObjectURL:()=>{revoked++;}};
context.Image=class {constructor(){this.naturalWidth=8000;this.naturalHeight=4000;}set src(value){Promise.resolve().then(()=>this.onload());}};
context.navigator.onLine=false;
const dropFile={type:'image/png',size:20*1024*1024};
let dropPrevented=false;
const dropImages=files=>$('score-drop').handlers.drop({dataTransfer:{files},preventDefault(){dropPrevented=true;}});
await dropImages([dropFile,dropFile]);assert.match($('score-status').textContent,/한 장씩/);
await dropImages([dropFile]);assert(dropPrevented);
assert.equal(vm.runInContext('scoreState.source.width',context),4096);
assert.equal(vm.runInContext('scoreState.source.height',context),2048);
assert.equal($('score-work').hidden,false);assert.equal($('score-upload').hidden,true,'the upload area steps aside for the preview');assert.equal($('score-add').disabled,false);assert.equal(revoked,1);
// "다른 악보 선택" drops the sheet and brings the upload area back, cancelling recognition still running.
vm.runInContext('scoreState.capo=2;scoreState.busy=true',context);const runBefore=vm.runInContext('scoreState.run',context);
$('score-reselect').handlers.click();
assert.equal($('score-work').hidden,true);assert.equal($('score-upload').hidden,false);
assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify([scoreState.image,scoreState.capo,scoreState.busy,scoreState.run>'+runBefore+'])',context)),[null,0,false,true]);
assert.equal($('score-file').disabled,false);
// Clipboard entry points share image loading, validation and OCR with file selection.
const pasted={type:'image/webp',size:100};let prevented=0;
const pasteEvent={target:$('score-panel'),clipboardData:{items:[textItem,{kind:'file',type:pasted.type,getAsFile:()=>pasted}]},preventDefault(){prevented++;}};
$('score-panel').hidden=true;
await documentHandlers.paste(pasteEvent);assert.equal(revoked,1);assert.equal(prevented,0);
$('score-panel').hidden=false;
await documentHandlers.paste(pasteEvent);assert.equal(revoked,2);assert.equal(prevented,1);
vm.runInContext('scoreState.busy=true',context);
await documentHandlers.paste(pasteEvent);assert.equal(revoked,2);assert.match($('score-status').textContent,/처리 중/);
vm.runInContext('scoreState.busy=false',context);
await documentHandlers.paste({...pasteEvent,clipboardData:{items:[textItem]}});
assert.equal(revoked,2);assert.equal(prevented,2);assert.match($('score-status').textContent,/텍스트/);
// Ordinary text fields still receive native text paste; no image load is attempted.
await documentHandlers.paste({...pasteEvent,target:$('score-edit-text'),clipboardData:{items:[textItem]}});
assert.equal(prevented,2);assert.equal(revoked,2);
// Without clipboard.read, or when it fails, the status explains why (with the error name for diagnosis).
await $('score-paste').handlers.click();assert.match($('score-status').textContent,/파일 선택/);
context.navigator.clipboard={read:async()=>{throw Error('read failed');}};
await $('score-paste').handlers.click();assert.equal($('score-status').textContent,'클립보드를 읽을 수 없어요. 파일 선택으로 악보 이미지를 올려 주세요.');assert.equal($('score-paste').disabled,false);
context.navigator.clipboard.read=async()=>{throw Object.assign(Error('denied'),{name:'NotAllowedError'});};
await $('score-paste').handlers.click();assert.match($('score-status').textContent,/허용되지 않았어요/);
context.navigator.clipboard.read=async()=>{throw Object.assign(Error('bad'),{name:'DataError'});};
await $('score-paste').handlers.click();assert.match($('score-status').textContent,/\(DataError\)$/);
// clipboard.read() starts before the button is disabled (iOS cancels its paste bubble otherwise).
let disabledAtRead=null;context.navigator.clipboard.read=async()=>{disabledAtRead=$('score-paste').disabled;return [];};
$('score-paste').disabled=false;await $('score-paste').handlers.click();assert.equal(disabledAtRead,false);
// iPhone/iPad: the button pastes into an invisible editable spot so iOS fires a real paste event.
{
  const pasteCalls=[];let sinks=0;
  context.navigator.userAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
  context.navigator.clipboard.read=async()=>{throw Error('clipboard.read must not be used on iOS');};
  const realCreate=context.document.createElement,realBody=context.document.body;
  context.document.createElement=()=>{const el=new Element();el.focus=()=>{};el.remove=()=>{sinks--;};return el;};
  context.document.body={append(){sinks++;}};
  context.document.execCommand=command=>{pasteCalls.push(command);return false;};
  await $('score-paste').handlers.click();
  assert.deepEqual(pasteCalls,['paste']);assert.equal(sinks,0,'The invisible paste spot is removed');
  assert.match($('score-status').textContent,/붙여넣지 못했어요/);
  context.document.execCommand=()=>{documentHandlers.paste(pasteEvent);return true;};
  const loaded=[];const realLoad=context.loadScoreImage;context.loadScoreImage=async file=>{loaded.push(file);};
  await $('score-paste').handlers.click();
  assert.equal(loaded.length,1,'The pasted image is loaded through the paste event');
  context.loadScoreImage=realLoad;context.document.createElement=realCreate;context.document.body=realBody;
  delete context.document.execCommand;context.navigator.userAgent='';
}
context.navigator.clipboard.read=async()=>[{types:['text/plain']}];
await $('score-paste').handlers.click();assert.equal(revoked,2);assert.match($('score-status').textContent,/텍스트/);
context.File=class {constructor(parts,name,options){this.parts=parts;this.name=name;this.type=options.type;this.size=100;}};
context.navigator.clipboard.read=async()=>[{types:['image/png'],getType:async()=>({size:100,type:''})}];
const loaded=[];const realLoad=context.loadScoreImage;context.loadScoreImage=async file=>{loaded.push(file);};
await $('score-paste').handlers.click();assert.equal(loaded[0].type,'image/png','A clipboard Blob without a MIME type is still loaded as an image');
context.loadScoreImage=realLoad;
context.navigator.clipboard.read=async()=>[{types:['text/html','image/webp'],getType:async type=>{assert.equal(type,'image/webp');return pasted;}}];
let automaticOCR=0;context.recognizeScore=async()=>{automaticOCR++;};
await $('score-paste').handlers.click();assert.equal(revoked,3);assert.equal(automaticOCR,1);
await documentHandlers.paste(pasteEvent);assert.equal(revoked,4);assert.equal(automaticOCR,2);
assert.equal($('score-paste').disabled,false);
// A tab switch during a permission prompt must not load into a hidden tab.
context.navigator.clipboard.read=async()=>{$('score-panel').hidden=true;return [{types:['image/png'],getType:async()=>pasted}];};
await $('score-paste').handlers.click();assert.equal(revoked,4);
}
checkIntroActions().then(checkOCR).then(()=>console.log('Score transposition, intro playback and placement, rendering, and OCR passed (no browser).')).catch(error=>{console.error(error);process.exitCode=1;});
