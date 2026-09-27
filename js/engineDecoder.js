(() => {
  'use strict';
  const te = new TextEncoder();
  function fail(message){ throw new Error(`Node2D engine decoder: ${message}`); }
  function parseEngineText(text){
    const source=String(text||'');
    const open=/<node2DEngine\s+file="([^"]+)"\s+length="(\d+)">\n/gy;
    const files=[]; let cursor=0;
    while(cursor<source.length){
      open.lastIndex=cursor;
      const m=open.exec(source);
      if(!m){
        if(!source.slice(cursor).trim())break;
        fail('invalid node2DEngine block at offset '+cursor);
      }
      const path=m[1],length=Number(m[2]);
      if(!Number.isSafeInteger(length)||length<0)fail(`invalid length for ${path}`);
      const bodyStart=open.lastIndex;
      const bodyEnd=bodyStart+length;
      if(bodyEnd>source.length)fail(`truncated ${path}`);
      const code=source.slice(bodyStart,bodyEnd);
      const marker=`\n</node2DEngine>`;
      if(source.slice(bodyEnd,bodyEnd+marker.length)!==marker)fail(`missing terminator for ${path}`);
      cursor=bodyEnd+marker.length;
      if(source[cursor]==='\n')cursor++;
      files.push({path,code});
    }
    if(!files.length)fail('engine package contains no files');
    return files;
  }
  function injectScript(file){
    return new Promise((resolve,reject)=>{
      try{
        const script=document.createElement('script');
        script.type='text/javascript';
        script.dataset.node2dEngineFile=file.path;
        script.textContent=file.code;
        document.head.appendChild(script);
        resolve();
      }catch(err){reject(err);}
    });
  }
  async function loadEngine(){
    if(!window.UIXNDCCodec?.decode)fail('NDC codec is not loaded');
    const response=await fetch('./js/node2dEngine.ndc',{cache:'no-store'});
    if(!response.ok)fail(`could not load node2dEngine.ndc: HTTP ${response.status}`);
    const bytes=new Uint8Array(await response.arrayBuffer());
    const packageData=window.UIXNDCCodec.decode(bytes);
    if(!packageData?.__uixEnginePackage)fail('invalid Node2D engine package');
    const files=parseEngineText(packageData.engineText);
    for(const file of files)await injectScript(file);
    return files.map(f=>f.path);
  }
  window.__UIX_ENGINE_READY__=loadEngine().catch(err=>{console.error(err);throw err;});
})();
