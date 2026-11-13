'use strict';
// Tool pages = app-core.js (shared) + the page's own <script data-main-app>. Tests load both, core first.
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..','..');
const core=fs.readFileSync(path.join(root,'guitar-synth.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'app-core.js'),'utf8');
const mainScript=file=>fs.readFileSync(path.join(root,file),'utf8').match(/<script data-main-app[^>]*>([\s\S]*?)<\/script>/)[1];
// Top-level code of a page up to its first feature wiring (`if(ready(...))`): definitions only, no DOM needed.
const definitions=file=>{const s=mainScript(file),i=s.search(/^if\(ready\(/m);return i<0?s:s.slice(0,i);};
module.exports={core,mainScript,definitions};
// Run core + page script for its definitions. DOM globals the context lacks become inert stubs, and ready()
// matches no mode, so the page's feature wiring (`if(ready(...))`) is skipped.
const vm=require('node:vm');
function stub(){const s=new Proxy(function(){},{get:(_,k)=>k===Symbol.toPrimitive?()=>'':k==='then'?undefined:s,apply:()=>s,construct:()=>s,set:()=>true});return s;}
function loadPage(context,file){
  for(const name of ['document','window','navigator','localStorage','location','performance'])if(!(name in context))context[name]=stub();
  vm.runInContext(core,context);vm.runInContext(mainScript(file),context);return context;
}
module.exports.loadPage=loadPage;
