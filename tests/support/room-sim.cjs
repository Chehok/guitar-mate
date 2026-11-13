'use strict';
// Room simulator for auto match: the app's real click/chirp shapes through phone-speaker filters,
// room reflections and a reverb tail, plus other phones in the room, mic noise and AGC.
const fs=require('fs'),path=require('path'),vm=require('vm');
function load(file){const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(file,'utf8'),ctx);return ctx.metronomeCalibrate;}
let seed=11;const random=()=>((seed=(seed*16807)%2147483647)/2147483647);const gauss=()=>Math.sqrt(-2*Math.log(random()+1e-12))*Math.cos(2*Math.PI*random());
function biquadHP(x,rate,f,q=.707){const w=2*Math.PI*f/rate,al=Math.sin(w)/(2*q),c=Math.cos(w),a0=1+al;const b0=(1+c)/2/a0,b1=-(1+c)/a0,b2=b0,a1=-2*c/a0,a2=(1-al)/a0;let x1=0,x2=0,y1=0,y2=0;const y=new Float32Array(x.length);for(let i=0;i<x.length;i++){const v=b0*x[i]+b1*x1+b2*x2-a1*y1-a2*y2;y[i]=v;x2=x1;x1=x[i];y2=y1;y1=v;}return y;}
function biquadLP(x,rate,f,q=.707){const w=2*Math.PI*f/rate,al=Math.sin(w)/(2*q),c=Math.cos(w),a0=1+al;const b0=(1-c)/2/a0,b1=(1-c)/a0,b2=b0,a1=-2*c/a0,a2=(1-al)/a0;let x1=0,x2=0,y1=0,y2=0;const y=new Float32Array(x.length);for(let i=0;i<x.length;i++){const v=b0*x[i]+b1*x1+b2*x2-a1*y1-a2*y2;y[i]=v;x2=x1;x1=x[i];y2=y1;y1=v;}return y;}
// The app's own sounds (metronome.html playClick / playChirp)
function click(rate,beat){const n=Math.round(.05*rate),y=new Float32Array(n),f=beat===0?1320:880,peak=beat===0?.75:.6;for(let i=0;i<n;i++){const t=i/rate;const env=t<.002?.0001*Math.pow(peak/.0001,t/.002):peak*Math.pow(.0001/peak,(t-.002)/.043);y[i]=env*Math.sign(Math.sin(2*Math.PI*f*t));}return y;}
function chirp(rate,hz=2000){const n=Math.round(.045*rate),y=new Float32Array(n);for(let i=0;i<n;i++){const t=i/rate;const env=t<.002?.0001*Math.pow(.9/.0001,t/.002):.9*Math.pow(.0001/.9,(t-.002)/.038);y[i]=env*Math.sin(2*Math.PI*hz*t);}return y;}
// Room: direct + reflections + diffuse tail
function room(rate,{rt60=.35,early=[[.004,.5],[.009,.35],[.017,.3]],tail=.15}={}){const n=Math.round(rt60*rate),h=new Float32Array(n);h[0]=1;for(const [d,g] of early){const i=Math.round(d*rate);if(i<n)h[i]+=g*(random()<.5?-1:1);}const decay=6.9/rt60;for(let i=Math.round(.005*rate);i<n;i++)h[i]+=tail*gauss()*Math.exp(-decay*i/rate)*Math.min(1,(i/rate-.005)/.01)*.05;return h;}
function convolveAdd(out,sig,at,ir,gain){for(let k=0;k<ir.length;k++){const g=ir[k]*gain;if(!g)continue;const base=at+k;for(let i=0;i<sig.length;i++){const j=base+i;if(j>=0&&j<out.length)out[j]+=sig[i]*g;}}}
function sparse(ir){const out=[];for(let k=0;k<ir.length;k++)if(Math.abs(ir[k])>1e-4)out.push([k,ir[k]]);return out;}
function addThrough(out,sig,at,irs,gain){for(const [k,g] of irs){const base=at+k,gg=g*gain;for(let i=0;i<sig.length;i++){const j=base+i;if(j>=0&&j<out.length)out[j]+=sig[i]*gg;}}}
function speaker(sig,rate,{hp=700,lp=9000}){return biquadLP(biquadHP(sig,rate,hp,1.1),rate,lp);}
function record({bpm=100,beats=10,loopback=.12,delta=.065,rate=48000,leaderGain=1,ownGain=2,noise=.002,start=12.345,leaderSpk={hp:900},ownSpk={hp:700},others=[],rt60=.35,tail=.15,agc=false}){
const interval=60/bpm,first=start+.3,dur=.3+beats*interval+.8,s=new Float32Array(Math.ceil(dur*rate));
const irL=sparse(room(rate,{rt60,tail})),irO=sparse(room(rate,{rt60:rt60*.6,tail:tail*.4,early:[[.002,.6]]}));
const beatTimes=[],ownTimes=[],beatKinds=[];
for(let k=0;k<beats;k++){const t=first+k*interval;beatTimes.push(t);beatKinds.push(k%4);const lc=speaker(click(rate,k%4),rate,leaderSpk);
addThrough(s,lc,Math.round((t+loopback+delta-start)*rate),irL,leaderGain);
for(const o of others){addThrough(s,speaker(click(rate,k%4),rate,{hp:800}),Math.round((t+loopback+delta+o.at-start)*rate),irL,o.gain);}
const own=t+interval/2;ownTimes.push(own);addThrough(s,speaker(chirp(rate),rate,ownSpk),Math.round((own+loopback-start)*rate),irO,ownGain);}
for(let i=0;i<s.length;i++)s[i]+=noise*gauss();
if(agc){let g=1;for(let i=0;i<s.length;i++){const a=Math.abs(s[i]*g);g+= (a>.3?-.0005:.000002);g=Math.max(.2,Math.min(3,g));s[i]*=g;}}
return {samples:s,sampleRate:rate,startTime:start,ownTimes,beatTimes,beatKinds,interval};}
const scenarios=[
{name:'typical',delta:.065},
{name:'late',delta:-.09},
{name:'matched',delta:0},
{name:'small leader speaker (hp 1.5k)',delta:.04,leaderSpk:{hp:1500}},
{name:'reverberant room',delta:.03,rt60:.8,tail:.6},
{name:'leader far, quiet',delta:.05,leaderGain:.15},
{name:'another follower 20ms early, 40%',delta:.05,others:[{at:-.02,gain:.4}]},
{name:'another follower 35ms late, 70%',delta:-.03,others:[{at:.035,gain:.7}]},
{name:'another follower 15ms early, 75%',delta:.04,others:[{at:-.015,gain:.75}]},
{name:'tiny leader speaker (hp 2.2k)',delta:.05,leaderSpk:{hp:2200}},
{name:'two others',delta:.02,others:[{at:-.015,gain:.35},{at:.025,gain:.5}]},
{name:'fast 180',bpm:180,delta:.03,beats:16},
{name:'slow 60',bpm:60,delta:.12,beats:7},
{name:'agc',delta:.06,agc:true},
{name:'noisy',delta:-.04,noise:.02},
{name:'44.1k',rate:44100,delta:.07},
];
module.exports={load,record,scenarios};
