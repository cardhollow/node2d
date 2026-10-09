const CACHE_NAME='uix-node2d-v49-shared-midi-notes-zoom-multipad';
const ROOT=new URL('./',self.location.href);
const EXTRA_FILES=['help/index.html','help/help.json','updates/index.html','updates/changes.json'];
const STATIC_ASSETS=[
  './help/help.json',
  './help/index.html',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './index.html',
  './js/app.js',
  './js/assets.js',
  './js/engineDecoder.js',
  './js/gifConvert.js',
  './js/keyBinds.js',
  './js/midiEditor.js',
  './js/midiParser.js',
  './js/ndcCodec.js',
  './js/ndcLoadWorker.js',
  './js/ndcSaveWorker.js',
  './js/node.js',
  './js/projectExporter.js',
  './js/network.js',
  './js/runtimeEngine.js',
  './js/scriptNodes.js',
  './js/spriteEditor.js',
  './js/uiComponents.js',
  './manifest.json',
  './style.css',
  './svgIcons/actions.svg',
  './svgIcons/add.svg',
  './svgIcons/camera.svg',
  './svgIcons/center.svg',
  './svgIcons/circle.svg',
  './svgIcons/clear.svg',
  './svgIcons/delete.svg',
  './svgIcons/disconnect.svg',
  './svgIcons/duplicate.svg',
  './svgIcons/edit.svg',
  './svgIcons/eraser.svg',
  './svgIcons/fill.svg',
  './svgIcons/flip-x.svg',
  './svgIcons/flip-y.svg',
  './svgIcons/flipx.svg',
  './svgIcons/flipy.svg',
  './svgIcons/folder.svg',
  './svgIcons/follow.svg',
  './svgIcons/grid.svg',
  './svgIcons/input.svg',
  './svgIcons/line.svg',
  './svgIcons/mirror.svg',
  './svgIcons/move.svg',
  './svgIcons/next.svg',
  './svgIcons/node.svg',
  './svgIcons/pan.svg',
  './svgIcons/pause.svg',
  './svgIcons/pencil.svg',
  './svgIcons/physics.svg',
  './svgIcons/picker.svg',
  './svgIcons/play.svg',
  './svgIcons/point.svg',
  './svgIcons/prev.svg',
  './svgIcons/rectangle.svg',
  './svgIcons/redo.svg',
  './svgIcons/reorder.svg',
  './svgIcons/rotate.svg',
  './svgIcons/ruler.svg',
  './svgIcons/save.svg',
  './svgIcons/scale.svg',
  './svgIcons/scene.svg',
  './svgIcons/select.svg',
  './svgIcons/snap.svg',
  './svgIcons/triangle.svg',
  './svgIcons/undo.svg',
  './svgIcons/zoom.svg',
  './updates/changes.json',
  './updates/index.html'
];

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
async function refreshResources(){
  const cache=await caches.open(CACHE_NAME);
  const targets=new Set([ROOT.href,...STATIC_ASSETS.map(path=>new URL(path,ROOT.href).href)]);
  for(const href of targets){
    try{
      const req=new Request(href,{cache:'no-store'});
      const response=await fetch(req);
      if(response && response.ok) await cache.put(req,response.clone());
    }catch{}
  }
  try{
    await getAppShell();
  }catch{}
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
  const extraHrefs=EXTRA_FILES.map(path=>new URL(path,ROOT.href).href);
  await Promise.all([...refs,...extraHrefs].map(async href=>{
    try{
      const req=new Request(href,{cache:'no-store'});
      const r=await fetch(req);
      await cacheResponse(cache,req,r);
    }catch{}
  }));
}

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    try{await refreshResources();}catch{}
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

self.addEventListener('message',event=>{
  if(event.data?.type==='uix-refresh-all'){
    event.waitUntil((async()=>{
      await refreshResources();
      const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
      clients.forEach(client=>client.postMessage({type:'uix-online-refresh-complete'}));
    })());
  }
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
      const cached=await cache.match(request) || (request.mode==='navigate'?await cache.match(ROOT.href):null) || (request.mode==='navigate'?await cache.match(new URL('./index.html',ROOT.href).href):null);
      if(cached){
        if(request.mode==='navigate'){event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>cs.forEach(c=>c.postMessage({type:'uix-offline-mode'}))).catch(()=>{}));}
        return cached;
      }
      return new Response('Offline', {status:503,statusText:'Offline'});
    }
  })());
});
