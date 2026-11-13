'use strict';
// Code shared by the tool pages (tuner, chord search, chord identifier, sheet transposer).
// Loaded before each page's own script; top-level names here are visible to it.
const $=id=>document.getElementById(id);
const ready=names=>names.includes(document.querySelector('[data-main-app]').dataset.mode);
const mod=n=>((n%12)+12)%12;
const tuning=[40,45,50,55,59,64], letters=['C','D','E','F','G','A','B'], natural=[0,2,4,5,7,9,11];
// Each tone stores semitones, interval label and diatonic distance for correct spelling.
const types={
'':{name:'메이저 · 장3화음',tones:[[0,'R',0],[4,'3',2],[7,'5',4]]},
m:{name:'마이너 · 단3화음',tones:[[0,'R',0],[3,'♭3',2],[7,'5',4]]},
'7':{name:'도미넌트 세븐',tones:[[0,'R',0],[4,'3',2],[7,'5',4],[10,'♭7',6]]},
maj7:{name:'메이저 세븐',tones:[[0,'R',0],[4,'3',2],[7,'5',4],[11,'7',6]]},
m7:{name:'마이너 세븐',tones:[[0,'R',0],[3,'♭3',2],[7,'5',4],[10,'♭7',6]]},
sus2:{name:'서스펜디드 세컨드',tones:[[0,'R',0],[2,'2',1],[7,'5',4]]},
sus4:{name:'서스펜디드 포스',tones:[[0,'R',0],[5,'4',3],[7,'5',4]]},
dim:{name:'디미니시드 · 감3화음',tones:[[0,'R',0],[3,'♭3',2],[6,'♭5',4]]},
aug:{name:'어그먼티드 · 증3화음',tones:[[0,'R',0],[4,'3',2],[8,'♯5',4]]},
dim7:{name:'디미니시드 세븐',tones:[[0,'R',0],[3,'♭3',2],[6,'♭5',4],[9,'♭♭7',6]]},
m7b5:{name:'하프 디미니시드',tones:[[0,'R',0],[3,'♭3',2],[6,'♭5',4],[10,'♭7',6]]},
'6':{name:'메이저 식스',tones:[[0,'R',0],[4,'3',2],[7,'5',4],[9,'6',5]]},
m6:{name:'마이너 식스',tones:[[0,'R',0],[3,'♭3',2],[7,'5',4],[9,'6',5]]},
'9':{name:'도미넌트 나인',tones:[[0,'R',0],[4,'3',2],[7,'5',4],[10,'♭7',6],[2,'9',1]]},
add9:{name:'애드 나인',tones:[[0,'R',0],[4,'3',2],[7,'5',4],[2,'9',1]]}
};
function parse(text){
const s=text.trim().replace(/♯/g,'#').replace(/♭/g,'b').replace(/[−–]/g,'-').replace(/\s+/g,'');
const match=/^([A-Ga-g])([#b]?)(.*)$/.exec(s);
if(!match)throw Error('코드 이름을 확인해 주세요. A–G로 시작해 주세요. 예: C, F#m, Bb7');
const root=match[1].toUpperCase()+match[2];
const pitch=n=>mod(natural[letters.indexOf(n[0].toUpperCase())]+(n[1]==='#'?1:n[1]==='b'?-1:0));
let raw=match[3],bassNote=null;
raw=raw.replace(/\/([A-Ga-g][#b]?)$/,(_,n)=>{bassNote=n[0].toUpperCase()+n.slice(1);return '';});
// Parentheses and commas group tokens without changing their meaning.
let tokens=raw.replace(/[(),]/g,'').replace(/^69$/, '6add9').replace(/^6\/9$/, '6add9');
tokens=tokens.replace(/^minor|^min/,'m').replace(/^major|^maj|^M(?!$)/,'maj').replace(/^-/, 'm');
if(tokens==='M')tokens='';
if(/^ø7?$/.test(tokens))tokens='m7b5';
tokens=tokens.replace(/^[°o]/,'dim').replace(/^\+/,'aug');
let triad='major',seventh=0,top=0,six=false,majorSeventh=false;
if(tokens.startsWith('m')&&!tokens.startsWith('maj')){triad='minor';tokens=tokens.slice(1);}
else if(tokens.startsWith('dim')){triad='dim';tokens=tokens.slice(3);}
else if(tokens.startsWith('aug')){triad='aug';tokens=tokens.slice(3);}
if(tokens.startsWith('maj')||tokens.startsWith('M')){majorSeventh=true;tokens=tokens.replace(/^(maj|M)/,'');if(!tokens&&triad==='major')majorSeventh=false;else if(!tokens)seventh=11;}
const extension=/^(13|11|9|7|6)/.exec(tokens);
if(extension){top=Number(extension[1]);tokens=tokens.slice(extension[0].length);if(top===6)six=true;else seventh=majorSeventh?11:triad==='dim'?9:10;}
const tones=new Map([[1,[0,'R',0]],[3,[triad==='major'||triad==='aug'?4:3,triad==='major'||triad==='aug'?'3':'b3',2]],[5,[triad==='dim'?6:triad==='aug'?8:7,triad==='dim'?'b5':triad==='aug'?'#5':'5',4]]]);
const intervals={2:2,3:4,4:5,5:7,6:9,7:10,9:2,11:5,13:9};
const put=(degree,alter=0,label)=>{const d=(degree-1)%7;tones.set(degree,[mod(intervals[degree]+alter),label||(alter<0?'b':alter>0?'#':'')+degree,d]);};
if(seventh)tones.set(7,[seventh,seventh===11?'7':seventh===9?'bb7':'b7',6]);
if(six)put(6);
if(top>=9)put(9);if(top>=11)put(11);if(top>=13)put(13);
const protectedDegrees=new Set();let suspended=false;
while(tokens){
const token=/^(sus[24]?|add[#b]?(?:13|11|9|[2-7])|(?:omit|no)(?:13|11|9|[1-7])|[#b](?:13|11|9|[2-7]))/.exec(tokens);
if(!token)throw Error('코드 종류를 확인해 주세요. 예: F#m11, C7b9b13, Cm(maj7), C6/9, D/F#');
const t=token[0];tokens=tokens.slice(t.length);
if(t.startsWith('sus')){tones.delete(3);const d=t==='sus2'?2:4;put(d);protectedDegrees.add(d);suspended=true;}
else if(/^(omit|no)/.test(t))tones.delete(Number(t.replace(/^(omit|no)/,'')));
else {const part=t.replace(/^add/,'');const a=part[0]==='b'?-1:part[0]==='#'?1:0;const d=Number(part.replace(/^[#b]/,''));put(d,a);protectedDegrees.add(d);}
}
if(top>=9)protectedDegrees.add(top);
const quality=raw.replace(/[(),]/g,'').replace(/^minor|^min/,'m').replace(/^major|^M(?=\d)/,'maj').replace(/^-/,'m').replace(/^[°o]/,'dim').replace(/^\+/,'aug');
const aliases={'major':'','maj':'','M':'','maj6':'6','sus':'sus4','ø':'m7b5','ø7':'m7b5','mmaj7':'m(maj7)','mM7':'m(maj7)'};
const canonical=Object.prototype.hasOwnProperty.call(aliases,quality)?aliases[quality]:quality;
const ordered=[...tones.entries()].sort((a,b)=>a[0]-b[0]);
const optional=[];
// Retain the original seventh/sixth grips that omit the perfect fifth.
if(tones.size>=4&&tones.has(5)&&tones.get(5)[0]===7&&!protectedDegrees.has(5))optional.push(5);
if(tones.size>4){
if(!bassNote&&tones.has(3)&&tones.has(7))optional.push(1);
if(top===13&&tones.has(11)&&!protectedDegrees.has(11))optional.push(11);
if(top>=11&&tones.has(9)&&!protectedDegrees.has(9))optional.push(9);}
return {root,pc:pitch(root),quality:canonical,label:root+canonical+(bassNote?'/'+bassNote:''),tones:ordered.map(e=>e[1]),degrees:ordered.map(e=>e[0]),optional,bassNote,bassPc:bassNote?pitch(bassNote):null,name:types[canonical]?.name||'확장 · 변화 코드',suspended};
}
function toneName(chord,interval){const [semitones,,degree]=interval;const i=(letters.indexOf(chord.root[0])+degree)%7;let delta=mod(chord.pc+semitones-natural[i]);if(delta>6)delta-=12;return letters[i]+(delta>0?'#'.repeat(delta):'b'.repeat(-delta));}
function noteName(chord,pc){const tone=chord.tones.find(t=>mod(chord.pc+t[0])===pc);return tone?toneName(chord,tone):chord.bassNote||'';}
// Hand-checked shapes, low E to high e. A negative fret means a muted string.
const open={
A:[['x02220','001230']],Am:[['x02210','002310']],A7:[['x02020','001020']],Amaj7:[['x02120','002130']],Am7:[['x02010','002010']],Asus2:[['x02200','001200']],Asus4:[['x02230','001240']],
B:[['x24442','013331']],Bm:[['x24432','013421']],B7:[['x21202','021304']],
C:[['x32010','032010']],C7:[['x32310','032410']],Cmaj7:[['x32000','032000']],Cadd9:[['x32033','021034']],
D:[['xx0232','000132']],Dm:[['xx0231','000231']],D7:[['xx0212','000213']],Dmaj7:[['xx0222','000111']],Dsus2:[['xx0230','000130']],Dsus4:[['xx0233','000134']],
E:[['022100','023100']],Em:[['022000','023000']],E7:[['020100','020100']],Em7:[['020000','020000']],Esus4:[['022200','023400']],
F:[['133211','134211'],['xx3211','003211']],Fmaj7:[['xx3210','003210']],
G:[['320003','210003'],['320033','210034']],G7:[['320001','320001']],
'C/E':[['032010','032010']],'C/G':[['332010','432010']],
'D/A':[['x00232','000132']],'D/F#':[['2x0232','100243']],
'G/B':[['x20033','010034']],'Am/C':[['x32210','042310']]
};
const eShapes={'':[0,2,2,1,0,0],m:[0,2,2,0,0,0],'7':[0,2,0,1,0,0],m7:[0,2,0,0,0,0],maj7:[0,2,1,1,0,0],sus4:[0,2,2,2,0,0],sus2:[0,2,4,4,0,0]};
const aShapes={'':[-1,0,2,2,2,0],m:[-1,0,2,2,1,0],'7':[-1,0,2,0,2,0],m7:[-1,0,2,0,1,0],maj7:[-1,0,2,1,2,0],sus2:[-1,0,2,2,0,0],sus4:[-1,0,2,2,3,0]};
function fingering(frets){
const positive=frets.filter(f=>f>0), fingers=frets.map(()=>0);if(!positive.length)return {fingers,barres:[]};
const min=Math.min(...positive), at=frets.map((f,i)=>f===min?i:-1).filter(i=>i>=0);let barres=[],next=1;
if(at.length>=2&&frets.slice(at[0],at.at(-1)+1).every(f=>f>=min)){
barres.push({fret:min,from:at[0],to:at.at(-1),finger:1});at.forEach(i=>fingers[i]=1);next=2;
}
const indexBarre=barres.length>0;
const rest=frets.map((f,i)=>({f,i})).filter(o=>o.f>0&&!fingers[o.i]).sort((a,b)=>a.f-b.f||a.i-b.i);
// Same-fret adjacent notes may share a finger as a small barre.
for(let k=0;k<rest.length;){let j=k+1;while(j<rest.length&&rest[j].f===rest[k].f&&rest[j].i===rest[j-1].i+1)j++;
// Above an index barre, leave room for the middle finger and use ring/pinky for paired notes.
if(indexBarre)next=Math.max(next,Math.min(4,rest[k].f-min+1));
if(indexBarre&&j-k===2&&next===3)j=k+1;
const group=rest.slice(k,j);if(next>4)return null;group.forEach(o=>fingers[o.i]=next);if(group.length>1)barres.push({fret:group[0].f,from:group[0].i,to:group.at(-1).i,finger:next});next++;k=j;}
return {fingers,barres};
}
function legacyVoicings(chord){
const pcs=chord.tones.map(t=>mod(chord.pc+t[0])),seen=new Set(),result=[];
function add(frets,name,manual){
const played=frets.map((f,i)=>f<0?null:mod(tuning[i]+f)).filter(p=>p!==null);
if(played.length<3||played.some(p=>!pcs.includes(p))||!chord.tones.filter(t=>!(chord.tones.length>=4&&t[0]===7)).every(t=>played.includes(mod(chord.pc+t[0]))))return;
const key=frets.join(',');if(seen.has(key))return;
const fing=fingering(frets);if(!fing)return;
if(manual){fing.fingers=manual.split('').map(Number);fing.barres=[];for(let finger=1;finger<=4;finger++){const indices=frets.map((f,i)=>f>0&&fing.fingers[i]===finger?i:-1).filter(i=>i>=0);if(indices.length>1){const start=indices[0],end=indices.at(-1),fret=frets[start];if(indices.every(i=>frets[i]===fret)&&frets.slice(start,end+1).every(f=>f>=fret))fing.barres.push({fret,from:start,to:end,finger});}}}
seen.add(key);const first=frets.findIndex(f=>f>=0),positive=frets.filter(f=>f>0);const max=Math.max(...frets),span=positive.length?max-Math.min(...positive):0;
result.push({frets,...fing,name,bass:mod(tuning[first]+frets[first]),score:(played[0]===chord.pc?0:100)+(manual?-30:0)+(name.includes('폼')?-10:0)+max*2+span+frets.filter(f=>f<0).length});
}
// Match open shapes by pitch too, so enharmonic roots retain useful open voicings.
for(const [name,shapes] of Object.entries(open)){const c=parse(name);if(c.pc===chord.pc&&c.quality===chord.quality&&c.bassPc===chord.bassPc)shapes.forEach(([shape,fingers])=>add([...shape].map(f=>f==='x'?-1:Number(f)),'기본 운지',fingers));}
if(chord.bassPc!==null)return result;
for(const [shapeSet,rootPc,name] of [[eShapes,4,'E폼'],[aShapes,9,'A폼']]){
const shape=shapeSet[chord.quality];if(!shape)continue;const first=mod(chord.pc-rootPc);for(const base of [first,first+12])if(Math.max(...shape)+base<=15)add(shape.map(f=>f<0?-1:f+base),base?name+' 바레':name+' 개방형');
}
// Additional movable triads and diminished/augmented forms, all checked above.
const special={dim:[-1,0,1,2,1,-1],dim7:[-1,0,1,-1,1,2],aug:[-1,3,2,1,1,-1],m7b5:[-1,0,1,0,1,-1],'6':[-1,0,2,2,2,2],m6:[-1,0,2,2,1,2],'9':[-1,2,1,2,2,2],add9:[-1,0,2,4,2,0]};
if(special[chord.quality]){const shape=special[chord.quality],reference=chord.quality==='aug'?0:chord.quality==='9'?11:9;const offset=mod(chord.pc-reference);for(const base of [offset,offset+12])if(Math.max(...shape)+base<=15)add(shape.map(f=>f<0?-1:f+base),'이동형 운지');}
result.sort((a,b)=>a.score-b.score);return result.slice(0,12);
}
// A barre can cross higher frets, but never an open or muted string.
function generatedFingering(frets){
const fingers=Array(6).fill(0),barres=[];let finger=0;
for(const fret of [...new Set(frets.filter(f=>f>0))].sort((a,b)=>a-b)){
for(let i=0;i<6;i++){
if(frets[i]!==fret||fingers[i])continue;
let end=i;for(let j=i+1;j<6&&frets[j]>=fret;j++)if(frets[j]===fret)end=j;
if(++finger>4)return null;
for(let j=i;j<=end;j++)if(frets[j]===fret)fingers[j]=finger;
if(end>i)barres.push({fret,from:i,to:end,finger});
}}
// shortcut: skip crowded four-finger grips until finger reach and barre angles can be modeled.
const splitsOpenString=frets.some((f,i)=>f>0&&frets.slice(i+1,frets.lastIndexOf(f)).includes(0));
if(finger===4&&(splitsOpenString||barres.some(barre=>barre.finger!==1)))return null;
return {fingers,barres};
}
function voicingSubset(a,b){return a.every((fret,i)=>fret<0||fret===b[i]);}
const maxFretSpan=3;
function makeVoicings(chord){
// Preserve the established grips and their ordering for the original vocabulary.
const legacy=types[chord.quality]?legacyVoicings(chord):[];
const pcs=chord.tones.map(t=>mod(chord.pc+t[0])),allowed=new Set(pcs);
if(chord.bassPc!==null)allowed.add(chord.bassPc);
const seen=new Set(),result=[];
function add(frets,name,manual){
const key=frets.join(',');if(seen.has(key))return;seen.add(key);
const sounded=frets.flatMap((f,i)=>f<0?[]:[tuning[i]+f]);if(sounded.length<3)return;
const positive=frets.filter(f=>f>0),low=positive.length?Math.min(...positive):0,high=positive.length?Math.max(...positive):0;
const span=high-low;
if(span>maxFretSpan||high>15||sounded.some(n=>!allowed.has(mod(n))))return;
const bass=mod(Math.min(...sounded));if(chord.bassPc!==null&&bass!==chord.bassPc)return;
const played=new Set(sounded.map(mod));const missing=chord.tones.map((t,i)=>played.has(pcs[i])?-1:i).filter(i=>i>=0);
if(missing.some(i=>!chord.optional.includes(chord.degrees[i])))return;
const fing=manual||generatedFingering(frets);if(!fing)return;
const omitted=missing.map(i=>chord.tones[i][1]);
const omissionCost=missing.reduce((n,i)=>n+({5:1,1:2,11:3,9:4}[chord.degrees[i]]||0),0);
const inside=frets.slice(frets.findIndex(f=>f>=0),frets.findLastIndex(f=>f>=0)+1);
const mutedInside=inside.filter(f=>f<0).length;
const fingersUsed=new Set(fing.fingers.filter(Boolean)).size;
const upperBarres=fing.barres.filter(barre=>barre.finger>1).length;
const effort=mutedInside*24+span*10+fingersUsed**2*4+fing.barres.length*10+upperBarres*14;
result.push({frets:[...frets],...fing,name,bass,omitted,span,score:(bass===chord.pc?0:100000)+missing.length*10000+omissionCost*100+low*10+high+effort-sounded.length});
}
legacy.forEach(v=>add(v.frets,v.name,{fingers:v.fingers,barres:v.barres}));
// Windows include open strings at every position; permit one interior muted string.
for(let base=1;base<=15;base++){
const choices=tuning.map(n=>[-1,...Array.from({length:Math.min(15,base+maxFretSpan)-base+1},(_,j)=>base+j),0].filter(f=>f<0||allowed.has(mod(n+f))));
const visit=(i,frets,count,gaps,ended)=>{
if(i===6){if(count>=3)add(frets,'자동 생성 운지');return;}
if(count+6-i<3)return;
for(const f of choices[i]){
if(f<0){visit(i+1,[...frets,f],count,gaps,count>0?true:ended);continue;}
const nextGaps=gaps+(ended?1:0);if(nextGaps>1)continue;
visit(i+1,[...frets,f],count+1,nextGaps,false);
}};
visit(0,[],0,0,false);
}
result.sort((a,b)=>Number(a.span===maxFretSpan)-Number(b.span===maxFretSpan)||a.score-b.score);
const preserved=legacy.map(v=>result.find(r=>r.frets.join(',')===v.frets.join(','))).filter(Boolean)
  .filter((v,i)=>v.span<maxFretSpan&&(i===0||v.name==='기본 운지'));
const groups=new Map(),distinct=[];
for(const voicing of [...preserved,...result.filter(v=>!preserved.includes(v))]){
  const notes=voicing.frets.flatMap((fret,i)=>fret<0?[]:[tuning[i]+fret]);
  const pitchMask=notes.reduce((mask,note)=>mask|(1<<mod(note)),0);
  const key=`${voicing.bass}:${pitchMask}`;
  const group=groups.get(key)||[];
  // Keep the better-ranked grip when the other only adds or drops doubled notes.
  if(group.some(frets=>voicingSubset(frets,voicing.frets)||voicingSubset(voicing.frets,frets)))continue;
  group.push(voicing.frets);
  groups.set(key,group);
  distinct.push(voicing);
  if(distinct.length===10)break;
}
return distinct;
}
let current=null,voicings=[],position=0;
const svg=(body,view,cls,label)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" class="${cls}" role="img" aria-label="${label}">${body}</svg>`;
function diagram(v,editBase=null){
if(!v)return '<p class="empty">4프렛 범위에서 추천할 운지를 찾지 못했습니다.</p>';
const f=v.frets,max=Math.max(...f),positive=f.filter(n=>n>0),base=editBase??(max<=5?1:Math.min(...positive)),x=i=>editBase===null?59+i*35:22+i*44,rowHeight=editBase===null?40:44,y=n=>67+(n-base+.5)*rowHeight;
let s='';if(base>1)s+=`<text x="${editBase===null?10:0}" y="${editBase===null?49:16}" font-size="14" fill="var(--muted)">${base}fr</text>`;
for(let fret=base;fret<base+5;fret++){
  const position=fret%12;
  const dots=position===0?[-5,5]:[3,5,7,9].includes(position)?[0]:[];
  for(const offset of dots)s+=`<circle cx="${x(0)-22}" cy="${y(fret)+offset}" r="3" fill="var(--inlay)" aria-hidden="true" pointer-events="none"/>`;
}
for(let n=0;n<=5;n++)s+=`<line x1="${x(0)}" x2="${x(5)}" y1="${67+n*rowHeight}" y2="${67+n*rowHeight}" stroke="var(--fret)" stroke-width="${n===0&&base===1?6:1.3}"/>`;
for(let i=0;i<6;i++){s+=`<line x1="${x(i)}" x2="${x(i)}" y1="67" y2="${67+5*rowHeight}" stroke="var(--string)" stroke-width="${2-i*.18}"/>`;
if(f[i]<=0||editBase!==null)s+=`<text x="${x(i)}" y="49" text-anchor="middle" font-size="17" fill="var(--ink)">${f[i]===0?'O':f[i]<0?'X':'—'}</text>`;
s+=`<text x="${x(i)}" y="${90+5*rowHeight}" text-anchor="middle" font-size="12" fill="var(--muted)">${['E','A','D','G','B','e'][i]}</text>`;}
for(const b of v.barres.filter(b=>editBase===null||(b.fret>=base&&b.fret<base+5)))s+=`<line x1="${x(b.from)}" x2="${x(b.to)}" y1="${y(b.fret)}" y2="${y(b.fret)}" stroke="var(--green)" stroke-width="25" stroke-linecap="round"/>`;
f.forEach((n,i)=>{if(n>0&&(editBase===null||(n>=base&&n<base+5)))s+=`<circle cx="${x(i)}" cy="${y(n)}" r="12.5" fill="var(--green)"/><text x="${x(i)}" y="${y(n)+4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--on-green)">${editBase===null?v.fingers[i]:''}</text>`;});
if(editBase!==null){
for(let i=0;i<6;i++)for(let row=-1;row<5;row++){
const fret=row<0?0:base+row,top=row<0?23:67+row*44;
s+=`<g class="identify-hit" role="button" tabindex="0" data-string="${i}" data-fret="${fret}" aria-label="${6-i}번 줄 ${row<0?'개방현 / 뮤트 전환':fret+'프렛'}" aria-pressed="${row<0?f[i]===0:f[i]===fret}"><rect x="${x(i)-22}" y="${top}" width="44" height="44" fill="transparent"/></g>`;
}
return svg(s,'-8 0 272 330','diagram diagram-editor',`운지 입력, ${base}–${base+4}프렛`).replace('role="img"','role="group"');
}
return svg(s,'0 0 290 310','diagram',`${current.label} 운지, 6번 줄부터 ${f.map(n=>n<0?'뮤트':n+'프렛').join(', ')}`);
}
function syncFilters(chord){const kind=filterKinds.find(k=>k.quality===chord.quality),bass=chord.bassNote||'none';if(!kind||!filterRoots.includes(chord.root)||(bass!=='none'&&!filterRoots.includes(bass)))return;if(!chordFilterResults(filterRoot,filterKind,filterBass).includes(chord.label)){filterRoot=chord.root;filterKind=kind.label;filterBass=bass;}if(document.getElementById('root-filter'))renderFilters();}
function find(value){try{const parsed=parse(value);const shapes=makeVoicings(parsed);current=parsed;voicings=shapes;position=0;syncFilters(parsed);$('error').textContent='';$('chord-input').removeAttribute('aria-invalid');render();}catch(error){$('error').textContent=error.message;$('chord-input').setAttribute('aria-invalid','true');}}
// Chord filter functions:
const filterRoots=['C','D','E','F','G','A','B','C#','D#','F#','G#','A#'];
const filterKinds=[['M','',''],['m','m','m'],['7','7','7'],['M7','maj7','maj7'],['m7','m7','m7'],['sus2','sus2','sus2'],['sus4','sus4','sus4'],['dim','dim','dim'],['aug','aug','aug'],['6','6','6'],['m6','m6','m6'],['add9','add9','add9'],['9','9','9'],['m9','m9','m9'],['m11','m11','m11'],['dim7','dim7','dim7'],['m7b5','m7b5','m7b5']].map(([label,suffix,quality])=>({label,suffix,quality}));
const filterPc={C:0,D:2,E:4,F:5,G:7,A:9,B:11,'C#':1,'D#':3,'F#':6,'G#':8,'A#':10};
// bass: 'none' = plain chord without slash, 'all' = plain chord plus every slash bass, or one note name.
function chordFilterResults(root,kind,bass='none'){
  const roots=root==='all'?filterRoots:filterRoots.filter(r=>r===root),kinds=kind==='all'?filterKinds:filterKinds.filter(k=>k.label===kind);
  const basses=bass==='none'?[null]:bass==='all'?[null,...filterRoots]:filterRoots.filter(n=>n===bass);
  const names=[];
  for(const r of roots)for(const k of kinds)for(const b of basses){
    if(b&&filterPc[b]===filterPc[r])continue;
    try{const c=parse(r+k.suffix+(b?'/'+b:''));if(c.root===r&&c.quality===k.quality&&(b?c.bassNote===b:!c.bassNote))names.push(c.label);}catch(_){}
  }
  return names;
}
// End chord filter functions.
let filterRoot='C',filterKind='M',filterBass='none';
const filterListLimit=96;
function filterButton(text,pressed,onClick,label){const b=document.createElement('button');b.type='button';b.textContent=text;b.setAttribute('aria-pressed',String(pressed));if(label)b.setAttribute('aria-label',label);b.addEventListener('click',onClick);return b;}
function fillSelect(id,options,value,onChange){
  const select=$(id);
  if(!select.options.length){for(const [v,text] of options){const o=document.createElement('option');o.value=v;o.textContent=text;if(v==='none')o.title='슬래시 없는 일반 코드';if(v==='all'&&id==='bass-filter')o.title='일반 코드와 모든 슬래시 베이스';select.append(o);}select.addEventListener('change',()=>onChange(select.value));}
  select.value=value;
}
function renderFilters(){
  const word=value=>value==='all'?'전체':value==='none'?'일반(슬래시 없음)':value;
  fillSelect('root-filter',[['all','전체'],...filterRoots.map(r=>[r,r])],filterRoot,v=>setFilters(v,filterKind,filterBass));
  fillSelect('kind-filter',[['all','전체'],...filterKinds.map(k=>[k.label,k.label])],filterKind,v=>setFilters(filterRoot,v,filterBass));
  fillSelect('bass-filter',[['none','일반'],['all','전체'],...filterRoots.map(n=>[n,n])],filterBass,v=>setFilters(filterRoot,filterKind,v));
  const names=chordFilterResults(filterRoot,filterKind,filterBass),shown=names.slice(0,filterListLimit);
  $('quick').replaceChildren(...shown.map(name=>filterButton(name,current&&current.label===name,()=>{$('chord-input').value=name;find(name);})));
  $('filter-empty').hidden=names.length>0;$('quick').hidden=!names.length;
  const status=$('filter-status');status.textContent='';
  status.append(`기본음 ${word(filterRoot)} · 종류 ${word(filterKind)} · 베이스 ${word(filterBass)} → ${names.length}개`);
  if(names.length===1){const strong=document.createElement('strong');strong.textContent=names[0];status.append(' · ',strong);}
  if(names.length>shown.length)status.append(` (앞의 ${shown.length}개만 표시 · 필터를 좁혀 보세요)`);
  return names;
}
function setFilters(root,kind,bass=filterBass){
  filterRoot=root;filterKind=kind;filterBass=bass;const names=renderFilters();
  if(names.length&&!(current&&names.includes(current.label))){$('chord-input').value=names[0];find(names[0]);}
}
let audioContext=null,playing=[],captureActive=()=>false;
// iOS Web Audio can stay suspended/interrupted after backgrounding and is routed as "ambient" by default; prepare it on every explicit tap and fail visibly instead of reporting playback.
function setAudioSession(type){try{if(navigator.audioSession&&navigator.audioSession.type!==type)navigator.audioSession.type=type;}catch(_){}}
async function resumeAudio(context){if(context.state==='running')return true;try{await Promise.race([context.resume(),new Promise(resolve=>setTimeout(resolve,1500))]);}catch(_){}return context.state==='running';}
async function prepareAudio(){
const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('unsupported');
// A 'playback' session ends a live microphone track (W3C Audio Session), so keep 'auto' while the tuner listens.
setAudioSession(captureActive()?'auto':'playback');
if(audioContext&&audioContext.state==='closed')audioContext=null;
if(!audioContext)audioContext=new Audio();
if(await resumeAudio(audioContext))return audioContext;
const stale=audioContext;audioContext=new Audio();try{stale.close();}catch(_){}
if(await resumeAudio(audioContext))return audioContext;
throw Error('audio-not-running');
}
// Report failure if the context stops right after scheduling instead of leaving a false "playing" status.
function confirmPlayback(ctx,stillCurrent,onFail){setTimeout(()=>{if(stillCurrent()&&(audioContext!==ctx||ctx.state!=='running'))onFail();},400);}
const audioFailure='소리를 재생할 수 없습니다. 같은 버튼을 한 번 더 눌러 다시 시도하고, 계속되면 페이지를 새로고침해 주세요.';
const chordLevel=.82,chordDecay=2.8,referenceLevel=.36,referenceDecay=1.7;
function scheduleTone(ctx,out,frequency,at,peak,decay,weights,attack){
const gain=ctx.createGain(),release=ctx.createGain(),oscs=[],end=at+decay+.1;
gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(peak,at+attack);gain.gain.exponentialRampToValueAtTime(.0001,at+decay);gain.gain.linearRampToValueAtTime(0,end);
gain.connect(release);release.connect(out);
weights.forEach((weight,k)=>{const osc=ctx.createOscillator(),level=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(frequency*(k+1),at);level.gain.value=weight;osc.connect(level);level.connect(gain);osc.start(at);osc.stop(end);oscs.push(osc);osc.addEventListener('ended',()=>{osc.disconnect();level.disconnect();if(k===weights.length-1){gain.disconnect();release.disconnect();}});});
let stopped=false;
return {oscs,voice:{stop(){
const now=ctx.currentTime;
if(stopped||now>=end)return;
stopped=true;
// Fade separately so the natural decay never jumps back to its attack level.
const stopAt=now<at?now:Math.min(end,now+.02);
if(now>=at){release.gain.setValueAtTime(1,now);release.gain.linearRampToValueAtTime(0,stopAt);}
for(const osc of oscs)osc.stop(stopAt);
}}};
}
// Steel-string acoustic pluck: a Karplus–Strong string (soft pick, 3-tap loop filter so upper partials die
// away quickly like a real string), then a guitar-body EQ, rendered once per pitch into a cached buffer.
function renderPluck(data,rate,frequency,seed=1){
let state=(seed>>>0)||1;const rand=()=>(state=(Math.imul(state,1664525)+1013904223)>>>0)/2**31-1;
// Loop delay = (n − 1) for the centred 3-tap filter + frac from the all-pass = one period.
const period=rate/frequency;let n=Math.floor(period+1),frac=period+1-n;if(frac<.1&&n>3){n--;frac++;}
const c=(1-frac)/(1+frac);
// Pick: noise softened twice (a plectrum, not a click), mixed with a smooth pluck shape, then the
// pick-position comb (plucked about 1/7 of the way from the bridge).
const line=new Float32Array(n),pick=Math.max(1,Math.round(n/7));
let soft1=0,soft2=0;const k=Math.min(.6,1200/frequency*.12+.18);
for(let i=0;i<n;i++){soft1+=k*(rand()-soft1);soft2+=k*(soft1-soft2);line[i]=.75*soft2+.25*(1-Math.abs(2*i/n-1));}
let mean=0;for(let i=0;i<n;i++)mean+=line[i]/n;for(let i=0;i<n;i++)line[i]-=mean;
for(let i=n-1;i>=pick;i--)line[i]-=.85*line[i-pick];
const t60=Math.max(1.5,Math.min(4.5,4.8-frequency/220)),loss=Math.pow(.001,1/(t60*frequency));
let idx=0,apIn=0,apOut=0;
for(let t=0;t<data.length;t++){
const i1=idx+1===n?0:idx+1,i2=i1+1===n?0:i1+1;
const a=line[idx],lowpass=loss*(.25*a+.5*line[i1]+.25*line[i2]),y=c*lowpass+apIn-c*apOut;
apIn=lowpass;apOut=y;data[t]=a;line[idx]=y;idx=i1;
}
// Body: cut rumble, warm air/top resonances, tame the 3–6 kHz edge, roll off the very top.
const biquad=(type,f0,q,gainDb=0)=>{const A=Math.pow(10,gainDb/40),w=2*Math.PI*f0/rate,cs=Math.cos(w),al=Math.sin(w)/(2*q);let b0,b1,b2,a0,a1,a2;
if(type==='hp'){b0=(1+cs)/2;b1=-(1+cs);b2=(1+cs)/2;a0=1+al;a1=-2*cs;a2=1-al;}
else if(type==='lp'){b0=(1-cs)/2;b1=1-cs;b2=(1-cs)/2;a0=1+al;a1=-2*cs;a2=1-al;}
else if(type==='peak'){b0=1+al*A;b1=-2*cs;b2=1-al*A;a0=1+al/A;a1=-2*cs;a2=1-al/A;}
else{const sq=2*Math.sqrt(A)*al;b0=A*((A+1)+(A-1)*cs+sq);b1=-2*A*((A-1)+(A+1)*cs);b2=A*((A+1)+(A-1)*cs-sq);a0=(A+1)-(A-1)*cs+sq;a1=2*((A-1)-(A+1)*cs);a2=(A+1)-(A-1)*cs-sq;}
let x1=0,x2=0,y1=0,y2=0;for(let t=0;t<data.length;t++){const x=data[t],y=(b0*x+b1*x1+b2*x2-a1*y1-a2*y2)/a0;x2=x1;x1=x;y2=y1;y1=y;data[t]=y;}};
biquad('hp',70,.7);biquad('peak',105,1.1,4);biquad('peak',220,1.3,2.5);biquad('peak',3200,.9,-4);biquad('shelf',5000,.7,-6);biquad('lp',7500,.7);
let peak=0;for(let t=0;t<data.length;t++)peak=Math.max(peak,Math.abs(data[t]));
const scale=peak?.9/peak:0,fade=Math.min(data.length,Math.round(rate*.002));
for(let t=0;t<data.length;t++)data[t]*=scale*(t<fade?t/fade:1);
return data;
}
const pluckBuffers=new Map();
function pluckBuffer(ctx,frequency){
const rate=ctx.sampleRate||48000,key=rate+':'+Math.round(frequency*100);
if(!pluckBuffers.has(key)){const buffer=ctx.createBuffer(1,Math.round(rate*(chordDecay+.2)),rate);renderPluck(buffer.getChannelData(0),rate,frequency,Math.round(frequency*7));pluckBuffers.set(key,buffer);}
return pluckBuffers.get(key);
}
function schedulePluck(ctx,out,frequency,at,peak,decay){
const source=ctx.createBufferSource(),gain=ctx.createGain(),release=ctx.createGain(),end=at+decay+.08;
source.buffer=pluckBuffer(ctx,frequency);
gain.gain.setValueAtTime(peak,at);gain.gain.setValueAtTime(peak,at+decay);gain.gain.linearRampToValueAtTime(0,end);
source.connect(gain);gain.connect(release);release.connect(out);source.start(at);source.stop(end);
let stopped=false;
return {oscs:[source],voice:{stop(){
const now=ctx.currentTime;
if(stopped||now>=end)return;
stopped=true;
const stopAt=now<at?now:Math.min(end,now+.02);
if(now>=at){release.gain.setValueAtTime(1,now);release.gain.linearRampToValueAtTime(0,stopAt);}
source.stop(stopAt);
}}};
}
// One strum across the given MIDI notes (low to high): a quick down stroke, or an up stroke from the top string.
function scheduleStrum(ctx,midis,at,{decay=chordDecay,level=1,up=false}={}){
// Render any new strings first (tens of ms the first time); if that ran past the start, start a bit later.
for(const midi of midis)pluckBuffer(ctx,440*Math.pow(2,(midi-69)/12));
at=Math.max(at,(ctx.currentTime||0)+.02);
const count=midis.length,peak=level*chordLevel*1.1/Math.max(3,count);
return midis.map((midi,i)=>{
const order=up?count-1-i:i,humanize=((midi*37+order*11)%7-3)/1000,velocity=.92+((midi*13)%9)/50;
return schedulePluck(ctx,ctx.destination,440*Math.pow(2,(midi-69)/12),at+order*.013+Math.max(0,humanize),peak*velocity,decay);
});
}
let concertA=440,selectedString=null,micContext=null,micStream=null,micSource=null,micGain=null,analyser=null,micTimer=null,micRequest=0;
captureActive=()=>!!micStream;
