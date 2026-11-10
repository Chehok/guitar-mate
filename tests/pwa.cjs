'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
assert.equal(manifest.name,'기타메이트');
assert.equal(manifest.short_name,'기타메이트');
assert.equal(manifest.start_url,'./');
assert.equal(manifest.scope,'./');
assert.equal(manifest.display,'standalone');
for(const icon of [...manifest.icons,{src:'./icons/apple-touch-icon.png',sizes:'180x180'},
  {src:'./favicon-32.png',sizes:'32x32'},{src:'./favicon-16.png',sizes:'16x16'}]){
  const png=fs.readFileSync(icon.src);
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);
}
assert(manifest.icons.some(icon=>icon.purpose==='maskable'));
const html=fs.readFileSync('index.html','utf8');
assert(html.includes('href="./manifest.webmanifest"'));
for(const file of ['favicon.svg','favicon-32.png','favicon-16.png'])assert(html.includes(`href="./${file}"`));
assert(html.includes('<title>기타메이트 · 튜닝</title>'));
assert(html.includes('name="apple-mobile-web-app-title" content="기타메이트"'));
assert(fs.readFileSync('favicon.svg','utf8').includes('<title>기타메이트</title>'));
assert(html.includes("register('./sw.js',{scope:'./'})"));
const source=fs.readFileSync('sw.js','utf8');
async function checkScope(scope){
  const handlers={},stored=new Map(),deleted=[],requests=[];
  let skipped=false,claimed=false,online=true;
  const prefix=`six-strings:${scope}:`;
  stored.set(prefix+'old',new Map());
  stored.set('unrelated-app-v1',new Map());
  const caches={
    async open(name){
      if(!stored.has(name))stored.set(name,new Map());
      const entries=stored.get(name);
      return {
        async addAll(items){
          for(const request of items){
            assert.equal(request.cache,'reload');
            assert(request.url.startsWith(scope),'Asset escaped subpath');
            const path='./'+request.url.slice(scope.length);
            assert(fs.existsSync(path==='./'?'./index.html':path),`Missing shell file ${path}`);
            entries.set(request.url,new Response(path));requests.push(request.url);
          }
        },
        async match(key){
          const response=entries.get(String(key))?.clone();
          if(response&&String(key).endsWith('/chord-identifier.html'))Object.defineProperty(response,'redirected',{value:true});
          return response;
        }
      };
    },
    async keys(){return [...stored.keys()];},
    async delete(name){deleted.push(name);return stored.delete(name);}
  };
  vm.runInNewContext(source,{
    URL,Request,Response,caches,
    fetch:async()=>{if(!online)throw Error('offline');return new Response('network');},
    self:{registration:{scope},location:{origin:new URL(scope).origin},
      addEventListener:(name,handler)=>{handlers[name]=handler;},
      skipWaiting:async()=>{skipped=true;},clients:{claim:async()=>{claimed=true;}}}
  });
  async function lifecycle(name){let pending;handlers[name]({waitUntil:promise=>{pending=promise;}});await pending;}
  await lifecycle('install');
  assert(skipped);assert.equal(requests.length,15);
  await lifecycle('activate');
  assert(claimed);assert.deepEqual(deleted,[prefix+'old']);
  assert(stored.has('unrelated-app-v1'));
  async function request(url,mode='cors',method='GET'){
    let response;handlers.fetch({request:{url,mode,method},respondWith:promise=>{response=promise;}});
    if(!response)return;
    const result=await response;
    if(mode==='navigate')assert.equal(result.redirected,false);
    return result.text();
  }
  assert.equal(await request(scope+'chord-identifier.html','navigate'),'./chord-identifier.html');
  assert.equal(await request(scope+'identify.html','navigate'),'network');
  online=false;
  assert.equal(await request(scope,'navigate'),'./');
  assert.equal(await request(scope+'index.html?from=home','navigate'),'./');
  assert.equal(await request(scope+'practice','navigate'),undefined);
  assert.equal(await request(scope+'identify.html','navigate'),'./chord-identifier.html');
  assert.equal(await request(scope+'tuner.html','navigate'),'./');
  assert.equal(await request(scope+'score.html','navigate'),'./score-key-transposer.html');
  assert.equal(await request(scope+'chord-search?chord=F%23m','navigate'),'./chord-search.html');
  for(const url of requests)assert(await request(url,url===scope||url.endsWith('.html')?'navigate':'cors'),`Offline miss for ${url}`);
  if(new URL(scope).pathname!=='/')assert.equal(await request(new URL('/other-app/',scope).href,'navigate'),undefined);
  assert.equal(await request('https://elsewhere.example/app/','navigate'),undefined);
  assert.equal(await request(scope+'sw.js'),undefined);
  assert.equal(await request(scope,'navigate','POST'),undefined);
}
(async()=>{
  await checkScope('https://example.github.io/guitar-chord/');
  await checkScope('https://example.github.io/');
  console.log('PWA manifest, PNG dimensions, offline shell, subpath scope and cache replacement passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
