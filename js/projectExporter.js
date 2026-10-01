(() => {
  'use strict';
  const ENGINE_BUILD_VERSION='40.0.0';
  const te=new TextEncoder();
  const safeName=s=>String(s||'project').trim().replace(/[^a-z0-9._-]+/gi,'_')||'project';
  const u16=v=>[v&255,(v>>>8)&255];
  const u32=v=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];
  const cat=parts=>{let n=0;for(const p of parts)n+=p.length;const out=new Uint8Array(n);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
  const crc32=b=>{let c=0xffffffff;for(const x of b){c^=x;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;};
  async function fetchFile(path){
    const scripts=[...(document.scripts||[])];
    const exact=scripts.find(s=>String(s.src||'').endsWith('/'+path)||String(s.src||'').endsWith(path));
    const url=exact?.src||new URL(path,document.baseURI).href;
    const r=await fetch(url,{cache:'no-store'});
    if(!r.ok)throw Error(`Could not read ${path}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async function fetchText(path){return new TextDecoder().decode(await fetchFile(path));}
  function zipStore(files,onProgress){
    const local=[],central=[];let offset=0;
    for(let i=0;i<files.length;i++){
      const f=files[i],name=te.encode(f.name),data=f.bytes instanceof Uint8Array?f.bytes:new Uint8Array(f.bytes),crc=crc32(data),flags=0x0800;
      const lh=Uint8Array.from([0x50,0x4b,0x03,0x04,20,0,flags&255,(flags>>>8)&255,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0]);
      if(lh.length!==30)throw Error('ZIP local header error');
      const ch=Uint8Array.from([0x50,0x4b,0x01,0x02,20,0,20,0,flags&255,(flags>>>8)&255,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(offset)]);
      if(ch.length!==46)throw Error('ZIP central header error');
      local.push(lh,name,data);central.push(ch,name);offset+=30+name.length+data.length;
      onProgress?.(20+Math.round((i+1)/files.length*65),`Packing ${f.name}`);
    }
    const centralOffset=offset,centralSize=central.reduce((n,p)=>n+p.length,0),count=files.length;
    const end=Uint8Array.from([0x50,0x4b,0x05,0x06,0,0,0,0,...u16(count),...u16(count),...u32(centralSize),...u32(centralOffset),0,0]);
    if(end.length!==22)throw Error('ZIP end header error');
    return cat([...local,...central,end]);
  }
  function escapeHTML(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function attr(v){return String(v??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;');}
  const SCREEN_TYPES=['Stretch','Windowboxing','Crop','Smart Camera'];
  const normalizeScreenType=v=>SCREEN_TYPES.includes(v)?v:'Windowboxing';
  function standaloneHTML(name,pwa,screenType='Windowboxing',splash={}){
    screenType=normalizeScreenType(screenType);
    const slug=screenType==='Smart Camera'?'smart-camera':screenType.toLowerCase();
    const screenClass=`uix-screen-${slug}`;
    const title=escapeHTML(name||'My Project');
    const splashOn=splash?.enabled!==false;
    const splashTitle=escapeHTML(String(splash?.title||'Node2D'));
    const splashIcon=splash?.iconPath?`<img class="uix-splash-icon" src="${attr(splash.iconPath)}" onerror="this.onerror=null;this.src='assets/splash-icon.svg';" alt="">`:'';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
  <title>${title}</title>
  ${pwa?'<link rel="manifest" href="manifest.json">':''}
  <style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}body{overscroll-behavior:none}#runtimeRoot{position:fixed;inset:0;width:100vw;height:100dvh;overflow:hidden;background:#111}#runtimeRoot.uix-screen-windowboxing{display:grid;place-items:center;background:#111}#runtimeRoot.uix-screen-windowboxing #runtimeCanvas{display:block;width:min(100vw,177.7778dvh);height:min(100dvh,56.25vw);max-width:100%;max-height:100%;aspect-ratio:16/9;touch-action:none;image-rendering:auto;background:#202020}#runtimeRoot.uix-screen-stretch,#runtimeRoot.uix-screen-crop,#runtimeRoot.uix-screen-smart-camera{display:block;background:#202020}#runtimeRoot.uix-screen-stretch #runtimeCanvas,#runtimeRoot.uix-screen-crop #runtimeCanvas,#runtimeRoot.uix-screen-smart-camera #runtimeCanvas{display:block;width:100vw;height:100dvh;max-width:none;max-height:none;aspect-ratio:auto;touch-action:none;image-rendering:auto;background:#202020}.uix-splash{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#111;color:#fff;font-family:system-ui,sans-serif;transition:opacity .28s ease;opacity:1}.uix-splash.uix-hidden{opacity:0;pointer-events:none}.uix-splash-inner{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:30px;text-align:center}.uix-splash-icon{width:min(30vw,180px);height:min(30vw,180px);object-fit:contain}.uix-splash-title{font-size:clamp(22px,5vw,42px);font-weight:700;letter-spacing:.08em}</style>
</head>
<body>
  ${splashOn?`<div id="uixSplash" class="uix-splash"><div class="uix-splash-inner">${splashIcon}<div class="uix-splash-title">${splashTitle}</div></div></div>`:''}
  <div id="runtimeRoot" class="${screenClass}"><canvas id="runtimeCanvas" width="1280" height="720"></canvas></div>
  <script>
    window.__UIX_STANDALONE__=true;
    window.__UIX_HIDE_SPLASH__=function(force){
      const el=document.getElementById('uixSplash');
      if(!el)return;
      if(force){el.remove();return;}
      el.classList.add('uix-hidden');
      setTimeout(()=>el.remove(),320);
    };
  </script>
  <script src="js/ndcCodec.js"></script>
  <script src="js/engineDecoder.js"></script>
  ${pwa?'<script>navigator.serviceWorker?.register("sw.js").catch(()=>{});</script>':''}
  <script>
    (async()=>{
      const showError=e=>{
        let el=document.getElementById('standaloneError');
        if(!el){el=document.createElement('div');el.id='standaloneError';el.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;padding:10px;border:1px solid #555;border-radius:6px;background:#252525;color:#ddd;font:12px system-ui;z-index:2147483647;white-space:pre-wrap';document.body.append(el);}
        el.textContent='Could not start project: '+(e?.message||e);
      };
      try{
        await window.__UIX_ENGINE_READY__;
        const target=new URLSearchParams(location.search).get('load')||'project.ndc';
        const r=await fetch(target,{cache:'no-store'});
        if(!r.ok)throw new Error('Could not load project: HTTP '+r.status);
        const bytes=new Uint8Array(await r.arrayBuffer());
        if(!window.UIXApp?.loadProjectBytes||!window.UIXApp?.startRuntime)throw new Error('UIX runtime failed to initialize');
        window.UIXApp.loadProjectBytes(bytes,target.split('/').pop()||'project.ndc',{force:true});
        if(!window.UIXApp.hasLoadedProject?.())throw new Error('Project did not load');
        window.UIXApp.startRuntime(false);
        window.__UIX_HIDE_SPLASH__?.();
      }catch(e){console.error(e);showError(e);window.__UIX_HIDE_SPLASH__?.(true);}
    })();
  </script>
</body>
</html>`;
  }
  function iconBytes(asset,pathBase){
    if(!asset?.value)return null;const m=String(asset.value).match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/i);if(!m)return null;
    let b;if(m[2]){const raw=atob(m[3].replace(/\s+/g,''));b=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)b[i]=raw.charCodeAt(i);}else b=te.encode(decodeURIComponent(m[3]));
    const ext=/\.svg$/i.test(asset.filename||'')?'svg':'png';return{bytes:b,name:`assets/${pathBase}.${ext}`,mime:m[1]||'image/png'};
  }
  function serviceWorker(version,files){const cache=`uix-player-engine-${ENGINE_BUILD_VERSION}-${safeName(version)}`;return `const C=${JSON.stringify(cache)},F=${JSON.stringify(['./',...files])};self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request))));`;}
  function buildEngineText(filePairs){
    return filePairs.map(([path,source])=>`<node2DEngine file="${attr(path)}" length="${source.length}">\n${source}\n</node2DEngine>`).join('\n')+'\n';
  }
  async function exportProject(o={}){
    const name=String(o.name||'My Project').trim()||'My Project',version=String(o.version||'1.0.0').trim()||'1.0.0',pwa=!!o.pwa,needMidi=!!o.needMidi,screenType=normalizeScreenType(o.screenType),splash=o.splash||{enabled:true,title:'Node2D'};
    o.onProgress?.(4,'Building standalone Playtime');
    const projectFiles=[{name:'project.ndc',bytes:o.projectNdc instanceof Uint8Array?o.projectNdc:new Uint8Array(o.projectNdc||[])}];
    const enginePaths=['js/node.js','js/assets.js','js/network.js','js/scriptNodes.js','js/uiComponents.js','js/runtimeEngine.js',...(needMidi?['js/midiParser.js']:[]),'js/app.js'];
    const enginePairs=[];
    for(let i=0;i<enginePaths.length;i++){const path=enginePaths[i],source=await fetchText(path);enginePairs.push([path,source]);o.onProgress?.(8+Math.round((i+1)/enginePaths.length*40),`Packed ${path}`);}
    if(!window.UIXNDCCodec?.encode)throw Error('NDC codec is not loaded');
    const engineContainer=buildEngineText(enginePairs);
    const engineNdc=window.UIXNDCCodec.encode({__uixEnginePackage:1,engineText:engineContainer,assets:{}});
    let splashIcon=splash?.iconAsset?iconBytes(splash.iconAsset,'splash-icon'):null;
    if(splash?.enabled!==false&&!splashIcon){
      splashIcon={bytes:await fetchFile('icon.svg'),name:'assets/splash-icon.svg',mime:'image/svg+xml'};
    }
    const pwaIcon=iconBytes(o.iconAsset,'icon');
    const splashPath=splashIcon?.name||'';
    const pwaPath=pwaIcon?.name||'';
    const files=[{name:'index.html',bytes:te.encode(standaloneHTML(name,pwa,screenType,{...splash,iconPath:splashPath}))},...projectFiles,{name:'js/ndcCodec.js',bytes:await fetchFile('js/ndcCodec.js')},{name:'js/engineDecoder.js',bytes:await fetchFile('js/engineDecoder.js')},{name:'js/node2dEngine.ndc',bytes:engineNdc}];
    if(splashIcon)files.push(splashIcon);
    if(pwa&&pwaIcon)files.push(pwaIcon);
    if(pwa){const manifest={...(o.manifest||{})};manifest.name=manifest.name||name;manifest.short_name=(manifest.short_name||name).slice(0,32);manifest.version=version;manifest.start_url='./';manifest.display=manifest.display||'standalone';if(pwaIcon)manifest.icons=[{src:`./${pwaPath}`,sizes:'any',type:pwaIcon.mime}];files.push({name:'manifest.json',bytes:te.encode(JSON.stringify(manifest,null,2))});files.push({name:'sw.js',bytes:te.encode(serviceWorker(version,files.map(f=>f.name)))});}
    o.onProgress?.(70,'Creating ZIP');
    const zip=zipStore(files,o.onProgress),out=`${safeName(name)}.zip`,blob=new Blob([zip],{type:'application/zip'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=out;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    o.onProgress?.(100,`Download started · ${out}`);return{bytes:zip,name:out,files:files.map(f=>f.name)};
  }
  window.UIXProjectExporter={exportProject};
})();
