// Shared acoustic guitar sound for every page that strums (tool pages via app-core.js, and the metronome's
// strum previews). Plain top-level functions, no state besides the per-rate pluck cache.
const chordLevel=.82,chordDecay=2.8;
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
// A small wooden room around the guitar: a stereo impulse response of decaying noise that darkens as it
// fades, with an 8 ms pre-delay; each channel normalized to unit energy so the wet level is predictable.
function roomImpulse(rate,seconds=1.1){
let state=7;const rand=()=>(state=(Math.imul(state,1664525)+1013904223)>>>0)/2**31-1;
const length=Math.round(rate*seconds),pre=Math.round(rate*.008),channels=[new Float32Array(length),new Float32Array(length)];
for(const data of channels){let low=0,energy=0;
for(let t=pre;t<length;t++){const x=(t-pre)/(length-pre),k=.55-.45*x;low+=k*(rand()-low);data[t]=low*Math.pow(.001,x);energy+=data[t]*data[t];}
const scale=1/Math.sqrt(energy||1);for(let t=0;t<length;t++)data[t]*=scale;}
return channels;
}
const roomWet=.2;
function guitarBus(ctx){
if(ctx.guitarBus)return ctx.guitarBus;
const input=ctx.createGain();input.connect(ctx.destination);
if(ctx.createConvolver&&ctx.createBuffer){
const rate=ctx.sampleRate||48000,[left,right]=roomImpulse(rate),ir=ctx.createBuffer(2,left.length,rate);
ir.getChannelData(0).set(left);ir.getChannelData(1).set(right);
const room=ctx.createConvolver(),wet=ctx.createGain();room.normalize=false;room.buffer=ir;wet.gain.value=roomWet;
input.connect(room);room.connect(wet);wet.connect(ctx.destination);
}
return ctx.guitarBus=input;
}
function schedulePluck(ctx,out,frequency,at,peak,decay,pan=0){
const source=ctx.createBufferSource(),gain=ctx.createGain(),release=ctx.createGain(),end=at+decay+.08;
source.buffer=pluckBuffer(ctx,frequency);
gain.gain.setValueAtTime(peak,at);gain.gain.setValueAtTime(peak,at+decay);gain.gain.linearRampToValueAtTime(0,end);
source.connect(gain);gain.connect(release);
if(pan&&ctx.createStereoPanner){const panner=ctx.createStereoPanner();panner.pan.value=pan;release.connect(panner);panner.connect(out);}else release.connect(out);
source.start(at);source.stop(end);
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
const count=midis.length,peak=level*chordLevel*1.4/Math.max(3,count); // ×1.4 makes up for the stereo pan law
return midis.map((midi,i)=>{
const order=up?count-1-i:i,humanize=((midi*37+order*11)%7-3)/1000,velocity=.92+((midi*13)%9)/50;
// Low strings a little left, high strings a little right, as heard from in front of the guitar.
const pan=count>1?(i/(count-1)-.5)*.4:0;
return schedulePluck(ctx,guitarBus(ctx),440*Math.pow(2,(midi-69)/12),at+order*.013+Math.max(0,humanize),peak*velocity,decay,pan);
});
}
