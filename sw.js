'use strict';
// Increment when changing any app-shell file so installed copies refresh together.
const VERSION='v20-multipage-identify-playback';
// Keep the storage namespace so activation also removes pre-rebrand caches.
const CACHE_PREFIX=`six-strings:${self.registration.scope}:`;
const CACHE_NAME=CACHE_PREFIX+VERSION;
const APP_FILES=['./','./index.html','./identify.html','./tuner.html','./score.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png','./favicon.svg','./favicon-32.png','./favicon-16.png'];
const APP_URLS=new Set(APP_FILES.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const names=await caches.keys();
    await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  // Queries and deep navigation within this scope share the offline app shell.
  const key=request.mode==='navigate'?new URL(url.pathname,self.location.origin).href:url.href;
  if(request.mode==='navigate'&&key===new URL('./index.html',self.registration.scope).href){
    event.respondWith(caches.open(CACHE_NAME).then(cache=>cache.match(new URL('./',self.registration.scope).href)));
    return;
  }
  if(request.mode==='navigate'&&key===new URL('./',self.registration.scope).href){
    event.respondWith((async()=>{const cache=await caches.open(CACHE_NAME);return await cache.match(key)||await cache.match(new URL('./index.html',self.registration.scope).href)||fetch(request);})());
    return;
  }
  if(!APP_URLS.has(key)){
    if(request.mode!=='navigate'||url.search||url.hash)return;
    const page=key.slice(self.registration.scope.length),fallback=page.endsWith('/')?'index.html':page+'.html';
    if(!APP_URLS.has(new URL(fallback,self.registration.scope).href))return;
    event.respondWith(caches.open(CACHE_NAME).then(cache=>cache.match(new URL(fallback,self.registration.scope).href)));
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME),cached=await cache.match(key);
    return cached||fetch(request);
  })());
});
