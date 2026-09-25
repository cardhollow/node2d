const CACHE_NAME='uix-node2d-v23';
const ROOT=new URL('./',self.location.href);

function sameOrigin(url){return url.origin===self.location.origin;}
function shouldCache(request){
  if(request.method!=='GET')return false;
  if(request.headers.has('range'))return false;
  const url=new URL(request.url);
  return sameOrigin(url) && !url.pathname.endsWith('/sw.js');
}
async function cacheResponse(cache,request,response){
  if(response && response.ok && shouldCache(request)){
    try{await cache.put(request,response.clone());}catch{}
  }
  return response;
}
async function getAppShell(){
  const cache=await caches.open(CACHE_NAME);
  const rootRequest=new Request(ROOT.href,{cache:'no-store'});
  const page=await fetch(rootRequest);
  if(!page.ok)throw new Error('App shell HTTP '+page.status);
  await cacheResponse(cache,rootRequest,page);
  const html=await page.clone().text();
  const refs=new Set();
  const re=/(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while((m=re.exec(html))){
    try{
      const u=new URL(m[1],ROOT.href);
      if(sameOrigin(u) && u.pathname!==new URL(self.location.href).pathname){refs.add(u.href);}
    }catch{}
  }
  await Promise.all([...refs].map(async href=>{
    try{
      const req=new Request(href,{cache:'no-store'});
      const r=await fetch(req);
      await cacheResponse(cache,req,r);
    }catch{}
  }));
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try{await getAppShell();}catch{}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('uix-node2d-')&&k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(!shouldCache(request))return;
  const url=new URL(request.url);
  if(!sameOrigin(url))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try{
      const fresh=await fetch(request,{cache:'no-store'});
      if(fresh.ok){
        await cache.put(request,fresh.clone()).catch(()=>{});
        if(request.mode==='navigate'){event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>cs.forEach(c=>c.postMessage({type:'uix-online-update'}))).catch(()=>{}));}
      }
      return fresh;
    }catch{
      const cached=await cache.match(request) || (request.mode==='navigate'?await cache.match(ROOT.href):null);
      if(cached){
        if(request.mode==='navigate'){event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>cs.forEach(c=>c.postMessage({type:'uix-offline-mode'}))).catch(()=>{}));}
        return cached;
      }
      return new Response('Offline', {status:503,statusText:'Offline'});
    }
  })());
});
