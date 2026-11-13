'use strict';
// Increment when changing any app-shell file so installed copies refresh together.
const VERSION='v171-bass-head-blade';
// Keep the storage namespace so activation also removes pre-rebrand caches.
const CACHE_PREFIX=`six-strings:${self.registration.scope}:`;
const CACHE_NAME=CACHE_PREFIX+VERSION;
const scope=new URL(self.registration.scope);
const pages=['chord-search','chord-identifier','metronome','score-key-transposer','guide','about','privacy'];
const menuRoutes=new Map([
  ['', './'],
  ...pages.flatMap(name=>[[name, `./${name}.html`], [`${name}.html`, `./${name}.html`]])
]);
const pageRoutes=new Map([
  ...menuRoutes, ['index.html', './'],
  ...[['tuner','./'], ['identify','./chord-identifier.html'], ['score','./score-key-transposer.html']]
    .flatMap(([name,path])=>[[name,path],[`${name}.html`,path]])
]);
const assets=['./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png','./favicon.svg','./favicon-32.png','./favicon-16.png','./app-shell.css','./app-shell.js','./guitar-synth.js','./app-core.js','./guide-dialog.css','./guide-dialog.js','./i18n.js','./i18n-en.js','./manifest.en.webmanifest','./qr.js','./sync-config.js','./metronome-sync.js','./metronome-audio.js','./metronome-room.js','./metronome-calibrate.js'];
const assetURLs=new Set(assets.map(path=>new URL(path,scope).href));
const appURLs=new Set([...assetURLs,...[...pageRoutes.values()].map(path=>new URL(path,scope).href)]);
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll([...appURLs].map(url=>new Request(url,{cache:'reload'})));
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
  if(request.mode==='navigate'){
    const route=url.pathname.slice(scope.pathname.length);
    const page=pageRoutes.get(route);
    if(!page)return;
    const cachedPage=async()=>{
      const cache=await caches.open(CACHE_NAME);
      const cached=await cache.match(new URL(page,scope).href);
      // A cached HTML response may have followed Cloudflare's .html redirect.
      return cached?.redirected?new Response(cached.body,{status:cached.status,headers:cached.headers}):cached;
    };
    if(menuRoutes.has(route)&&page!=='./guide.html')event.respondWith(cachedPage().then(cached=>cached||fetch(request)));
    else event.respondWith(fetch(request,page==='./guide.html'?{cache:'no-cache'}:undefined).catch(async error=>{
      const cached=await cachedPage();
      if(!cached)throw error;
      return cached;
    }));
    return;
  }
  if(!assetURLs.has(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME),cached=await cache.match(url.href);
    return cached||fetch(request);
  })());
});
