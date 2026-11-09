'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pages=[['index.html','tuner','./'],['chord-search.html','chords','./chord-search.html'],['chord-identifier.html','identify','./chord-identifier.html'],['score-key-transposer.html','score','./score-key-transposer.html']];
for(const [file,mode,href] of pages){
  const html=fs.readFileSync(file,'utf8');
  const nav=html.slice(html.indexOf('<nav class="mode-tabs"'),html.indexOf('</nav>'));
  const links=[...nav.matchAll(/<a id="([^"]+)-tab" href="([^"]+)"( aria-current="page")?>/g)];
  assert.deepEqual(links.map(link=>link.slice(1,3)),pages.map(([,name,url])=>[name,url]));
  assert.deepEqual(links.filter(link=>link[3]).map(link=>link.slice(1,3)),[[mode,href]]);
  assert(html.includes(`<section id="${mode}-panel">`),`${file} must show its main panel`);
  assert(html.includes('data-ad-slot'),'Every page needs an ad placement');
  const markup=html.slice(0,html.indexOf('<script data-main-app'));
  for(const [,other] of pages)if(other!==mode)assert(!markup.includes(`id="${other}-panel"`),`${file} includes another mode panel`);
}
console.log('Each menu has its own page, active navigation item and ad slot.');
