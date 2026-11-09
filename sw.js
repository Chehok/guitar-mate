'use strict';
// Increment when changing any app-shell file so installed copies refresh together.
const VERSION='v18-ios-reference-audio';
// Keep the storage namespace so activation also removes pre-rebrand caches.
const CACHE_PREFIX=`six-strings:${self.registration.scope}:`;
const CACHE_NAME=CACHE_PREFIX+VERSION;
const APP_FILES=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png','./favicon.svg','./favicon-32.png','./favicon-16.png'];
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
  const key=request.mode==='navigate'?new URL('./',self.registration.scope).href:url.href;
  if(!APP_URLS.has(key))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME),cached=await cache.match(key);
    return cached||fetch(request);
  })());
});
