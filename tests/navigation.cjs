'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pages=[['index.html','chords','./'],['identify.html','identify','./identify.html'],['tuner.html','tuner','./tuner.html'],['score.html','score','./score.html']];
for(const [file,mode,href] of pages){
  const html=fs.readFileSync(file,'utf8');
  const nav=html.slice(html.indexOf('<nav class="mode-tabs"'),html.indexOf('</nav>'));
  assert(nav.includes(`id="${mode}-tab"`)&&nav.includes(`href="${href}"`)&&nav.includes('aria-current="page"'));
  assert.match(html,new RegExp(`<section id="${mode}-panel"[^>]*>`));
  assert(html.includes('data-ad-slot'),'Every page needs an ad placement');
  const markup=html.slice(0,html.indexOf('<script>'));
  for(const [other] of pages)if(other!==file)assert(!markup.includes(`id="${other.replace('.html','')}-panel"`),`${file} includes another mode panel`);
}
console.log('Each menu has its own page, active navigation item and ad slot.');
