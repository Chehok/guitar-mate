'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const pages=[['index.html','tuner','./'],['chord-search.html','chords','./chord-search.html'],['chord-identifier.html','identify','./chord-identifier.html'],['metronome.html','metronome','./metronome.html'],['score-key-transposer.html','score','./score-key-transposer.html']];
const components=new Map();
vm.runInNewContext(fs.readFileSync('app-shell.js','utf8'),{
  customElements:{define:(name,component)=>components.set(name,component)},
  HTMLElement:class {querySelector(){return {addEventListener(){}};}},
  navigator:{userAgent:'Desktop Chrome'},
  window:{addEventListener(){},matchMedia:()=>({matches:false,addEventListener(){}})}
});
const footer=new (components.get('gm-footer'))();
footer.connectedCallback();
assert.match(footer.innerHTML,/href="\.\/about\.html">소개 · 문의/);
assert.match(footer.innerHTML,/href="\.\/privacy\.html">개인정보처리방침/);
for(const [file,mode,href] of pages){
  const html=fs.readFileSync(file,'utf8');
  assert(html.includes(`<gm-header active="${mode}"></gm-header>`));
  assert(html.includes('<gm-footer></gm-footer>'));
  assert(html.indexOf('src="./app-shell.js"')>=0 && html.indexOf('src="./app-shell.js"')<html.indexOf('src="./guide-dialog.js"'));
  assert(html.includes('href="./app-shell.css"'));
  const header=new (components.get('gm-header'))();
  header.getAttribute=()=>mode;
  header.connectedCallback();
  const guide=mode==='metronome'?'./guide.html#example-metronome':'./guide.html';
  assert(header.innerHTML.includes(`class="guide-launch" href="${guide}"`));
  assert.match(header.innerHTML,/<header>[\s\S]*?id="install-button"[\s\S]*?<\/header>/);
  const nav=header.innerHTML.match(/<nav class="mode-tabs"[\s\S]*?<\/nav>/)[0];
  const links=[...nav.matchAll(/<a id="([^"]+)-tab" href="([^"]+)"( aria-current="page")?>/g)];
  assert.deepEqual(links.map(link=>link.slice(1,3)),pages.map(([,name,url])=>[name,url]));
  assert.deepEqual(links.filter(link=>link[3]).map(link=>link.slice(1,3)),[[mode,href]]);
  assert(html.includes(`<section id="${mode}-panel"`),`${file} must show its main panel`);
  assert(!html.includes('data-ad-slot'),`${file} has an empty ad panel`);
  const markup=html.slice(0,html.indexOf('</main>'));
  for(const [,other] of pages)if(other!==mode)assert(!markup.includes(`id="${other}-panel"`),`${file} includes another mode panel`);
}
console.log('Each menu has its own page and active navigation item, without an empty ad panel.');
