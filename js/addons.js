(() => {
  'use strict';

  const DB_NAME='node2d-addon-packages-v1';
  const DB_VERSION=1;
  const STORE='packages';
  const te=new TextEncoder();
  const td=new TextDecoder();
  const ADDON_UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const VERSION_RE=/^\d+\.\d+\.\d+$/;
  const MAX_PACKAGE_BYTES=64*1024*1024;
  const MAX_FILES=2048;
  const MAX_FILE_BYTES=32*1024*1024;
  const baseScriptNodes=(window.UIXScriptNodes?.scriptNodes||[]).slice();
  let dbPromise=null;
  let memoryOnly=false;
  const memoryRecords=new Map();
  let initialized=false;
  let projectConfig={active:[]};
  let lastLogs=new Map();
  let detailsKey='';

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fallbackIcon='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"%3E%3Crect x="7" y="7" width="50" height="50" rx="10" fill="%23333"/%3E%3Cpath d="M20 32h24M32 20v24" stroke="%23bbb" stroke-width="4"/%3E%3C/svg%3E';
  const packageKey=(uuid,version)=>`${String(uuid||'').toLowerCase()}@${String(version||'')}`;
  const cloneConfig=c=>{
    const active=[],seen=new Set();
    for(const item of Array.isArray(c?.active)?c.active:[]){
      const uuid=String(item?.uuid||'').toLowerCase(),version=String(item?.version||'');
      if(!ADDON_UUID_RE.test(uuid)||!VERSION_RE.test(version)||seen.has(uuid))continue;
      seen.add(uuid);active.push({uuid,version});
    }
    return {active};
  };
  const u16=(v)=>[v&255,(v>>>8)&255];
  const u32=(v)=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];
  const read16=(v,i)=>v[i]|(v[i+1]<<8);
  const read32=(v,i)=>(v[i]|(v[i+1]<<8)|(v[i+2]<<16)|(v[i+3]<<24))>>>0;
  const concat=parts=>{let n=0;for(const p of parts)n+=p.length;const out=new Uint8Array(n);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
  const crc32=bytes=>{let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;};
  function compareVersions(a,b){
    const aa=String(a||'').split('.'),bb=String(b||'').split('.');
    for(let i=0;i<3;i++){
      const av=BigInt(aa[i]||0),bv=BigInt(bb[i]||0);
      if(av!==bv)return av>bv?1:-1;
      const az=(aa[i]||'').length-String(av).length,bz=(bb[i]||'').length-String(bv).length;
      if(az!==bz)return az<bz?1:-1;
    }
    return 0;
  }
  function openDB(){
    if(dbPromise)return dbPromise;
    dbPromise=new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){reject(new Error('IndexedDB is not available in this browser.'));return;}
      const request=indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error||new Error('Could not open Addon storage.'));
      request.onblocked=()=>reject(new Error('Addon storage upgrade is blocked by another Node2D tab.'));
    }).catch(err=>{dbPromise=null;throw err;});
    return dbPromise;
  }
  async function dbRequest(mode,fn){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
      let result;
      try{result=fn(store,tx);}catch(err){reject(err);return;}
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error||new Error('Addon storage transaction failed.'));
      tx.onabort=()=>reject(tx.error||new Error('Addon storage transaction aborted.'));
    });
  }
  async function getRecord(key){
    if(memoryOnly)return memoryRecords.get(key)||null;
    const db=await openDB();
    return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readonly').objectStore(STORE).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error||new Error('Could not read Addon package.'));});
  }
  async function listRecords(){
    if(memoryOnly)return [...memoryRecords.values()];
    const db=await openDB();
    return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readonly').objectStore(STORE).getAll();req.onsuccess=()=>resolve(Array.isArray(req.result)?req.result:[]);req.onerror=()=>reject(req.error||new Error('Could not list Addon packages.'));});
  }
  async function storeRecord(record){
    const key=packageKey(record.manifest.uuid,record.manifest.version);
    if(memoryOnly){memoryRecords.set(key,record);return key;}
    return dbRequest('readwrite',store=>store.put(record,key));
  }

  function safePath(path){
    const p=String(path||'').replace(/\\/g,'/').replace(/^\.\//,'');
    if(!p||p.startsWith('/')||/^[a-z]:/i.test(p)||p.split('/').some(x=>x==='..'||x===''))throw new Error(`Unsafe ZIP path: ${path}`);
    return p;
  }
  async function inflateRaw(bytes){
    if(typeof DecompressionStream!=='function')throw new Error('This browser cannot decompress deflated ZIP entries. Use a ZIP with Store compression or update the browser.');
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(bytes){
    const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
    if(b.length<22||b.length>MAX_PACKAGE_BYTES)throw new Error('Invalid Addon ZIP size.');
    let eocd=-1;for(let i=Math.max(0,b.length-65557);i<=b.length-22;i++){if(read32(b,i)===0x06054b50)eocd=i;}
    if(eocd<0)throw new Error('ZIP end directory was not found.');
    if(read16(b,eocd+4)!==0||read16(b,eocd+6)!==0)throw new Error('Multi-disk ZIP files are not supported.');
    const count=read16(b,eocd+10),dirSize=read32(b,eocd+12),dirOffset=read32(b,eocd+16);
    if(count>MAX_FILES||dirOffset+dirSize>eocd)throw new Error('Invalid ZIP central directory.');
    const files=new Map();let at=dirOffset;
    for(let n=0;n<count;n++){
      if(at+46>b.length||read32(b,at)!==0x02014b50)throw new Error('Invalid ZIP central file record.');
      const flags=read16(b,at+8),method=read16(b,at+10),crc=read32(b,at+16),compressedSize=read32(b,at+20),size=read32(b,at+24),nameLen=read16(b,at+28),extraLen=read16(b,at+30),commentLen=read16(b,at+32),localOffset=read32(b,at+42);
      const nameStart=at+46,nameEnd=nameStart+nameLen;
      if(nameEnd+extraLen+commentLen>b.length)throw new Error('Truncated ZIP central directory.');
      const rawName=td.decode(b.subarray(nameStart,nameEnd));
      at=nameEnd+extraLen+commentLen;
      if(rawName.endsWith('/'))continue;
      const name=safePath(rawName);
      if(files.has(name))throw new Error(`Duplicate ZIP entry: ${name}`);
      if(flags&1)throw new Error(`Encrypted ZIP entry is not supported: ${name}`);
      if(size>MAX_FILE_BYTES||compressedSize>MAX_PACKAGE_BYTES)throw new Error(`ZIP entry is too large: ${name}`);
      if(localOffset+30>b.length||read32(b,localOffset)!==0x04034b50)throw new Error(`Invalid local ZIP header: ${name}`);
      const localName=read16(b,localOffset+26),localExtra=read16(b,localOffset+28),dataStart=localOffset+30+localName+localExtra,dataEnd=dataStart+compressedSize;
      if(dataEnd>b.length)throw new Error(`Truncated ZIP entry: ${name}`);
      const packed=b.slice(dataStart,dataEnd);
      let data;
      if(method===0)data=packed;
      else if(method===8)data=await inflateRaw(packed);
      else throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
      if(data.length!==size||crc32(data)!==crc)throw new Error(`ZIP integrity check failed: ${name}`);
      files.set(name,data);
    }
    return files;
  }
  function asText(files,path,required=true){const b=files.get(path);if(!b){if(required)throw new Error(`Addon is missing ${path}.`);return '';}return td.decode(b);}
  function evalIIFE(source,label){
    try{
      const code=String(source||'').trim().replace(/;\s*$/,'');
      if(!code)throw new Error('The file is empty.');
      return Function(`"use strict"; return ${code};`)();
    }catch(err){throw new Error(`${label} could not be evaluated: ${err?.message||err}`);}
  }
  async function inspectPackage(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    const files=await unzip(bytes);
    const manifestText=asText(files,'manifest.json');
    let manifest;try{manifest=JSON.parse(manifestText);}catch{throw new Error('manifest.json is not valid JSON.');}
    if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw new Error('Addon manifest root must be an object.');
    const uuid=String(manifest.uuid||'').trim().toLowerCase(),name=String(manifest.name||'').trim(),version=String(manifest.version||'').trim();
    if(!ADDON_UUID_RE.test(uuid))throw new Error('manifest.uuid must be a valid UUID.');
    if(!name)throw new Error('manifest.name is required.');
    if(!VERSION_RE.test(version))throw new Error('manifest.version must contain exactly three numeric segments, such as 1.0.0.');
    manifest={...manifest,uuid,name,version,description:String(manifest.description||'').trim(),icon:String(manifest.icon||'').trim()};
    if(manifest.icon){manifest.icon=safePath(manifest.icon);if(!files.has(manifest.icon))throw new Error(`Addon icon was not found: ${manifest.icon}`);}
    const main=evalIIFE(asText(files,'main.js'),'main.js');
    if(!main||typeof main!=='object'||Array.isArray(main))throw new Error('main.js must return an Addon definition object.');
    const registry=main.registry&&typeof main.registry==='object'?main.registry:{};
    const scriptFiles=registry.scriptNodes===undefined?[]:registry.scriptNodes;
    const componentFiles=registry.components===undefined?[]:registry.components;
    if(!Array.isArray(scriptFiles)||!scriptFiles.every(x=>typeof x==='string'))throw new Error('main.js registry.scriptNodes must be an array of filenames.');
    if(!Array.isArray(componentFiles)||!componentFiles.every(x=>typeof x==='string'))throw new Error('main.js registry.components must be an array of filenames.');
    const scriptNodeFiles=scriptFiles.map(x=>{
      const file=safePath(`scriptNodes/${x}`);
      if(file.split('/').length!==2||!file.toLowerCase().endsWith('.js'))throw new Error(`Invalid ScriptNode bundle filename: ${x}`);
      return file;
    });
    const componentBundleFiles=componentFiles.map(x=>{
      const file=safePath(`components/${x}`);
      if(file.split('/').length!==2||!file.toLowerCase().endsWith('.js'))throw new Error(`Invalid component bundle filename: ${x}`);
      return file;
    });
    return {manifest,bytes:bytes.slice(),files,registry:{scriptNodes:scriptNodeFiles,components:componentBundleFiles}};
  }
  async function importAddonPackage(input){
    const inspected=await inspectPackage(input);
    const key=packageKey(inspected.manifest.uuid,inspected.manifest.version);
    const existing=await getRecord(key);
    if(existing)return {installed:false,reused:true,record:existing,manifest:existing.manifest};
    const record={key,manifest:inspected.manifest,zip:inspected.bytes.buffer.slice(inspected.bytes.byteOffset,inspected.bytes.byteOffset+inspected.bytes.byteLength),installedAt:Date.now()};
    await storeRecord(record);
    notify('package-installed');
    if(isActive(inspected.manifest.uuid,inspected.manifest.version))await rebuildRegistry();
    return {installed:true,reused:false,record,manifest:record.manifest};
  }
  async function importEmbeddedPackages(packages){
    const outcomes=[];
    for(const item of Array.isArray(packages)?packages:[]){
      try{const bytes=item?.bytes instanceof Uint8Array?item.bytes:new Uint8Array(item?.bytes||[]);if(!bytes.length)continue;outcomes.push(await importAddonPackage(bytes));}
      catch(err){outcomes.push({error:String(err?.message||err),manifest:item?.manifest||null});}
    }
    return outcomes;
  }
  function bytesToDataURL(bytes,path){
    if(!bytes)return '';
    const ext=String(path||'').split('.').pop().toLowerCase();
    const mime=ext==='svg'?'image/svg+xml':ext==='jpg'||ext==='jpeg'?'image/jpeg':ext==='webp'?'image/webp':'image/png';
    let raw='';for(let i=0;i<bytes.length;i+=0x8000)raw+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return `data:${mime};base64,${btoa(raw)}`;
  }
  async function readRecordDetails(record){
    const inspected=await inspectPackage(new Uint8Array(record.zip));
    const icon=inspected.manifest.icon?bytesToDataURL(inspected.files.get(inspected.manifest.icon),inspected.manifest.icon):'';
    return {...record,manifest:inspected.manifest,icon,registry:inspected.registry};
  }
  function getProjectConfig(){return cloneConfig(projectConfig);}
  async function getActivePackages(){
    const out=[];
    for(const active of projectConfig.active){
      const record=await getRecord(packageKey(active.uuid,active.version));
      if(!record)continue;
      out.push({manifest:record.manifest,bytes:new Uint8Array(record.zip)});
    }
    return out;
  }
  function notify(reason='change'){
    try{window.dispatchEvent(new CustomEvent('node2d:addons-changed',{detail:{reason,config:cloneConfig(projectConfig)}}));}catch{}
  }
  function normalizeDefinition(def,sourceName){
    if(!def||typeof def!=='object'||Array.isArray(def))throw new Error('Definition must be an object.');
    const name=String(def.name||'').trim();
    if(!name)throw new Error('Definition is missing a non-empty name.');
    if(typeof def.func!=='function')throw new Error(`ScriptNode "${name}" must provide func(ctx, values).`);
    const group=String(def.group||'Actions').trim()||'Actions';
    const normalized={...def,name,group,require:String(def.require||''),receiver:def.receiver!==false,editor:Array.isArray(def.editor)?def.editor:[],output:Array.isArray(def.output)?def.output:[]};
    normalized.__addonSource=sourceName;
    return normalized;
  }
  async function evaluateRecord(record){
    const log=[];
    const add=(level,message)=>log.push({level,message:String(message)});
    try{
      const inspected=await inspectPackage(new Uint8Array(record.zip));
      const main=evalIIFE(asText(inspected.files,'main.js'),'main.js');
      const defs=[];
      for(const path of inspected.registry.scriptNodes){
        try{
          if(!inspected.files.has(path)){add('warning',`Missing ScriptNode bundle: ${path}`);continue;}
          const result=evalIIFE(asText(inspected.files,path),path);
          const bundle=Array.isArray(result)?result:[result];
          if(!bundle.length){add('warning',`${path} returned no ScriptNode definitions.`);continue;}
          bundle.forEach((raw,index)=>{
            try{defs.push(normalizeDefinition(raw,`${inspected.manifest.name}/${path}`));}
            catch(err){add('error',`${path} item ${index+1}: ${err.message||err}`);}
          });
        }catch(err){add('error',`${path}: ${err.message||err}`);}
      }
      if(inspected.registry.components.length)add('warning',`${inspected.registry.components.length} component bundle(s) declared; the component extension API is reserved but not active in v43.0.0.`);
      return {manifest:inspected.manifest,defs,log,main};
    }catch(err){add('error',err?.message||err);return {manifest:record.manifest,defs:[],log,error:err};}
  }
  async function rebuildRegistry(){
    const combined=baseScriptNodes.slice();
    const seen=new Map(baseScriptNodes.map(def=>[String(def?.name||''),{type:'built-in',name:'Node2D'}]));
    const logs=new Map();
    for(const active of projectConfig.active){
      const key=packageKey(active.uuid,active.version),record=await getRecord(key);
      const label=`${active.uuid}@${active.version}`;
      if(!record){logs.set(key,[{level:'error',message:'This active package is missing from the installed Addon library.'}]);continue;}
      const evaluated=await evaluateRecord(record),entries=evaluated.log.slice();
      for(const def of evaluated.defs){
        if(seen.has(def.name)){
          const owner=seen.get(def.name);
          entries.push({level:'warning',message:`ScriptNode "${def.name}" was skipped because it is already defined by ${owner.type==='built-in'?'Node2D built-ins':`Addon ${owner.name}`}.`});
          continue;
        }
        seen.set(def.name,{type:'addon',name:evaluated.manifest.name});
        combined.push(def);
      }
      logs.set(key,entries);
    }
    lastLogs=logs;
    const registry=window.UIXScriptNodes?.scriptNodes;
    if(Array.isArray(registry))registry.splice(0,registry.length,...combined);
    notify('registry-rebuilt');
    return combined;
  }
  async function restoreProject(config,embeddedPackages=[]){
    if(!initialized)await initialize();
    const imported=await importEmbeddedPackages(embeddedPackages);
    imported.filter(x=>x.error).forEach(x=>console.warn('[Node2D Addons] Embedded Addon skipped:',x.error));
    projectConfig=cloneConfig(config);
    await rebuildRegistry();
    return cloneConfig(projectConfig);
  }
  async function initialize(){
    if(initialized)return true;
    try{await openDB();}
    catch(err){memoryOnly=true;console.warn('[Node2D Addons] IndexedDB is unavailable; Addons will be available only for this session.',err);}
    initialized=true;
    await rebuildRegistry();
    return true;
  }
  async function activate(uuid,version){
    const u=String(uuid||'').toLowerCase(),v=String(version||'');
    const rec=await getRecord(packageKey(u,v));if(!rec)throw new Error('That Addon version is not installed.');
    const next=cloneConfig(projectConfig),i=next.active.findIndex(x=>x.uuid===u);
    if(i>=0)next.active[i]={uuid:u,version:v};
    else next.active.push({uuid:u,version:v});
    projectConfig=next;
    await rebuildRegistry();notify('activated');
    return true;
  }
  async function deactivate(uuid){
    const u=String(uuid||'').toLowerCase(),next=cloneConfig(projectConfig);
    next.active=next.active.filter(x=>x.uuid!==u);projectConfig=next;
    await rebuildRegistry();notify('deactivated');return true;
  }
  async function moveActive(uuid,delta){
    const list=cloneConfig(projectConfig).active,i=list.findIndex(x=>x.uuid===String(uuid||'').toLowerCase()),j=i+Number(delta);
    if(i<0||j<0||j>=list.length)return false;
    [list[i],list[j]]=[list[j],list[i]];projectConfig={active:list};await rebuildRegistry();notify('reordered');return true;
  }
  function isActive(uuid,version){return projectConfig.active.some(x=>x.uuid===String(uuid||'').toLowerCase()&&(!version||x.version===String(version)));}
  function activeForUUID(uuid){return projectConfig.active.find(x=>x.uuid===String(uuid||'').toLowerCase())||null;}

  function ensureStyle(){if(document.getElementById('node2dAddonStyles'))return;const s=document.createElement('style');s.id='node2dAddonStyles';s.textContent=`
    .addon-manager-modal{width:min(760px,calc(100vw - 24px));display:flex;flex-direction:column;box-sizing:border-box;}
    .addon-manager-modal>.modal-header,.addon-manager-modal>.modal-actions{flex:0 0 auto;}
    .addon-manager-modal .modal-header>div:first-child{min-width:0;flex:1;}
    .addon-manager-modal .modal-header h3{line-height:1.3;overflow-wrap:anywhere;}
    .addon-manager-modal .modal-header p{line-height:1.45;overflow-wrap:anywhere;}
    .addon-manager-modal .modal-close{flex:0 0 28px;display:inline-grid;place-items:center;padding:0;margin:-2px -4px 0 0;}
    .addon-manager-modal .modal-close svg{width:16px;height:16px;}
    .addon-manager-modal>.modal-body{flex:1 1 auto;min-height:0;overflow:auto;padding:12px 14px;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
    .addon-manager-modal .modal-actions{flex-wrap:wrap;}
    .addon-manager-list{display:flex;flex-direction:column;gap:9px;min-height:0;overflow:visible;padding:0;}
    .addon-card{display:grid;grid-template-columns:52px minmax(0,1fr) auto;align-items:center;column-gap:12px;box-sizing:border-box;width:100%;min-width:0;padding:11px 12px;border:1px solid var(--border-color,#383838);border-radius:9px;background:var(--panel-bg,#171717);color:var(--text-primary,#eee);text-align:left;cursor:pointer;}
    .addon-card:hover{border-color:var(--text-muted,#777);}
    .addon-card:focus-visible{outline:2px solid var(--accent,#e8c84a);outline-offset:1px;}
    .addon-icon{width:52px;height:52px;border-radius:8px;object-fit:contain;background:#222;padding:4px;box-sizing:border-box;display:block;}
    .addon-card-main{min-width:0;display:flex;flex-direction:column;gap:4px;}
    .addon-card-title{font-size:13px;font-weight:650;line-height:1.3;overflow-wrap:anywhere;}
    .addon-card-description{font-size:12px;line-height:1.4;color:var(--text-muted,#999);overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}
    .addon-card-foot{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:11px;line-height:1.4;color:var(--text-muted,#999);min-width:0;}
    .addon-card-foot>span:first-child{min-width:0;flex:1 1 160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;}
    .addon-card-version{margin-left:auto;white-space:nowrap;font-variant-numeric:tabular-nums;}
    .addon-card-tools{display:grid;grid-template-columns:1fr 1fr;gap:4px;width:96px;align-self:center;}
    .addon-card-tools button{height:26px;min-width:0;padding:0;border:1px solid var(--border-color,#444);background:transparent;color:inherit;border-radius:5px;cursor:pointer;display:inline-grid;place-items:center;line-height:1;}
    .addon-card-tools button:hover:not(:disabled){background:#363636;}
    .addon-card-tools .addon-toggle{grid-column:1 / -1;width:100%;padding:0 6px;font-size:10px;white-space:nowrap;}
    .addon-card-tools button:disabled{opacity:.3;cursor:default;}
    .addon-tag{font-size:10px;line-height:1.3;border:1px solid var(--border-color,#444);border-radius:12px;padding:1px 7px;white-space:nowrap;}
    .addon-manager-note{font-size:12px;line-height:1.5;color:var(--text-muted,#999);margin:0;overflow-wrap:anywhere;}
    .addon-detail-grid{display:grid;grid-template-columns:72px minmax(0,1fr);gap:14px;align-items:start;}
    .addon-detail-grid .addon-icon{width:72px;height:72px;}
    .addon-detail-meta{font-size:12px;color:var(--text-muted,#999);overflow-wrap:anywhere;line-height:1.5;}
    .addon-log-list{max-height:240px;overflow:auto;border:1px solid var(--border-color,#333);border-radius:7px;padding:8px;display:flex;flex-direction:column;gap:7px;font:12px/1.4 ui-monospace,monospace;}
    .addon-log-row{overflow-wrap:anywhere;}.addon-log-row.warning{color:#e6be72;}.addon-log-row.error{color:#ef8888;}
    .addon-empty{padding:28px 12px;text-align:center;color:var(--text-muted,#999);border:1px dashed var(--border-color,#444);border-radius:8px;}
    .addon-package-warning{font-size:12px;color:var(--text-muted,#999);line-height:1.4;margin:0;}
    @media(max-width:520px){.addon-card{grid-template-columns:42px minmax(0,1fr);row-gap:8px;column-gap:8px;padding:9px}.addon-icon{width:42px;height:42px}.addon-card-tools{grid-column:1 / -1;width:100%;grid-template-columns:1fr 34px 34px}.addon-card-tools .addon-toggle{grid-column:auto}}
  `;document.head.append(s);}
  function showModal(modal){window.UIXApp?.showModal?.(modal);}
  function closeModal(modal){window.UIXApp?.closeModal?.(modal);}
  function status(message){window.UIXApp?.status?.(message);}
  function confirm(title,message,callback,ok='Continue'){if(window.UIXApp?.askConfirm){window.UIXApp.askConfirm(title,message,callback,ok);return;}if(window.confirm(message))callback();}
  async function packageDetails(){
    const records=await listRecords();
    const details=[];
    for(const r of records){try{details.push(await readRecordDetails(r));}catch(err){details.push({...r,icon:'',error:String(err?.message||err),registry:{scriptNodes:[],components:[]}});}}
    details.sort((a,b)=>String(a.manifest?.name||'').localeCompare(String(b.manifest?.name||''),undefined,{sensitivity:'base'})||compareVersions(b.manifest?.version,a.manifest?.version));
    return details;
  }
  async function openManagement(){
    await initialize();ensureStyle();
    let modal=document.getElementById('addonManagementModal');
    if(!modal){modal=document.createElement('section');modal.id='addonManagementModal';modal.className='modal addon-manager-modal';modal.dataset.closeOutside='true';document.body.append(modal);}
    const render=async()=>{
      const records=await packageDetails();
      const activeRank=new Map(projectConfig.active.map((x,i)=>[packageKey(x.uuid,x.version),i]));
      records.sort((a,b)=>{
        const ar=activeRank.has(a.key)?activeRank.get(a.key):Infinity,br=activeRank.has(b.key)?activeRank.get(b.key):Infinity;
        if(ar!==br)return ar-br;
        return String(a.manifest?.name||'').localeCompare(String(b.manifest?.name||''),undefined,{sensitivity:'base'})||compareVersions(b.manifest?.version,a.manifest?.version);
      });
      modal.innerHTML=`<div class="modal-header"><div><h3>Addon Management</h3><p>Installed Addons are stored on this device. Activation and order belong to the current project.</p></div><button class="modal-close" type="button" aria-label="Close">${window.UIXIcons?.get('close','ui-svg')||'×'}</button></div><div class="modal-body"><p class="addon-manager-note">Built-in ScriptNodes always take priority. Among Addons, the first active Addon in this list wins duplicate ScriptNode names. Deactivating an Addon may leave its placed ScriptNodes unresolved until it is activated again.</p><div class="addon-manager-list" data-addon-list></div></div><div class="modal-actions"><button class="btn" data-addon-import type="button">Import Addon</button><button class="btn" data-addon-template type="button">Download Template</button><button class="btn primary" data-addon-close type="button">Close</button></div>`;
      const list=modal.querySelector('[data-addon-list]');
      if(!records.length){const empty=document.createElement('div');empty.className='addon-empty';empty.textContent='No Addons installed yet.';list.append(empty);}
      const activeOrder=projectConfig.active;
      for(const record of records){
        const m=record.manifest||{},active=activeForUUID(m.uuid),isOn=!!active&&active.version===String(m.version),order=activeOrder.findIndex(x=>x.uuid===m.uuid);
        const card=document.createElement('div');card.className='addon-card';card.setAttribute('role','button');card.tabIndex=0;
        const img=document.createElement('img');img.className='addon-icon';img.alt='';img.src=record.icon||fallbackIcon;
        const main=document.createElement('div');main.className='addon-card-main';
        const title=document.createElement('div');title.className='addon-card-title';title.textContent=m.name||'Unnamed Addon';
        const desc=document.createElement('div');desc.className='addon-card-description';desc.textContent=m.description||'No description provided.';
        const foot=document.createElement('div');foot.className='addon-card-foot';
        const uuid=document.createElement('span');uuid.textContent=`${m.uuid||'Invalid UUID'}${record.error?' · Invalid package':''}`;
        const version=document.createElement('span');version.className='addon-card-version';version.textContent=`v${m.version||'—'}`;
        const tag=document.createElement('span');tag.className='addon-tag';tag.textContent=isOn?'Active':active?'Other version active':'Installed';
        foot.append(uuid,tag,version);main.append(title,desc,foot);
        const tools=document.createElement('div');tools.className='addon-card-tools';
        const toggle=document.createElement('button');toggle.type='button';toggle.className='addon-toggle';toggle.textContent=isOn?'Deactivate':active?'Switch':'Activate';toggle.title=isOn?'Deactivate this Addon for the current project':active?'Switch the active version for this project':'Activate this Addon for the current project';
        toggle.onclick=e=>{
          e.stopPropagation();
          if(isOn){
            confirm('Deactivate Addon',`Deactivate ${m.name}? Placed ScriptNodes from this Addon may stop working and will remain unresolved until the Addon is activated again.`,async()=>{await deactivate(m.uuid);status(`${m.name} deactivated`);await render();},'Deactivate');
            return;
          }
          const current=activeForUUID(m.uuid);
          const run=async()=>{try{await activate(m.uuid,m.version);status(`Activated ${m.name} v${m.version}`);await render();}catch(err){status(`Activation failed: ${err.message||err}`);}};
          if(current&&current.version!==String(m.version))confirm('Switch Addon Version',`Replace the active version ${current.version} with ${m.version} for this project? Both package versions will remain installed.`,run,'Switch');
          else void run();
        };
        const up=document.createElement('button');up.type='button';up.textContent='↑';up.title='Move Addon earlier';up.disabled=!isOn||order<=0;
        const down=document.createElement('button');down.type='button';down.textContent='↓';down.title='Move Addon later';down.disabled=!isOn||order<0||order>=activeOrder.length-1;
        up.onclick=async e=>{e.stopPropagation();await moveActive(m.uuid,-1);await render();};down.onclick=async e=>{e.stopPropagation();await moveActive(m.uuid,1);await render();};tools.append(toggle,up,down);
        card.append(img,main,tools);
        const open=()=>openDetails(record.key||packageKey(m.uuid,m.version));card.addEventListener('click',open);card.addEventListener('keydown',e=>{if(e.target!==card)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});
        list.append(card);
      }
      modal.querySelector('.modal-close').onclick=()=>closeModal(modal);
      modal.querySelector('[data-addon-close]').onclick=()=>closeModal(modal);
      modal.querySelector('[data-addon-import]').onclick=()=>chooseAddonImport();
      modal.querySelector('[data-addon-template]').onclick=downloadTemplate;
    };
    await render();showModal(modal);
    if(modal.dataset.addonRefreshListener!=='true'){
      modal.dataset.addonRefreshListener='true';
      window.addEventListener('node2d:addons-changed',()=>{if(!modal.hidden)void render();});
    }
  }
  async function openDetails(key){
    const record=await getRecord(key);if(!record)return status('Addon package was not found.');
    const detail=await readRecordDetails(record),m=detail.manifest,active=activeForUUID(m.uuid),isOn=isActive(m.uuid,m.version),logs=lastLogs.get(key)||[];
    let modal=document.getElementById('addonDetailsModal');
    if(!modal){modal=document.createElement('section');modal.id='addonDetailsModal';modal.className='modal addon-manager-modal';modal.dataset.closeOutside='true';document.body.append(modal);}
    const logHTML=logs.length?logs.map(x=>`<div class="addon-log-row ${esc(x.level)}">[${esc(String(x.level||'info').toUpperCase())}] ${esc(x.message)}</div>`).join(''):'<div class="addon-log-row">No activation logs for this Addon version.</div>';
    const compNote=detail.registry.components.length?`<p class="addon-package-warning">${detail.registry.components.length} component bundle(s) are declared, but component registration is not part of the v43.0.0 Addon API.</p>`:'';
    modal.innerHTML=`<div class="modal-header"><div><h3>${esc(m.name)}</h3><p>Addon details and registration log</p></div><button class="modal-close" type="button">${window.UIXIcons?.get('close','ui-svg')||'×'}</button></div><div class="modal-body"><div class="addon-detail-grid"><img class="addon-icon" alt="" src="${esc(detail.icon||fallbackIcon)}"><div><strong>${esc(m.name)}</strong><div class="addon-detail-meta">Version ${esc(m.version)}<br>UUID ${esc(m.uuid)}<br>${esc(m.description||'No description provided.')}</div></div></div><p class="addon-detail-meta">ScriptNode bundles: ${detail.registry.scriptNodes.length?detail.registry.scriptNodes.map(esc).join(', '):'None'}</p>${compNote}<h4>Registration logs</h4><div class="addon-log-list">${logHTML}</div></div><div class="modal-actions"><button class="btn" data-addon-detail-close type="button">Back</button>${isOn?'<button class="btn" data-addon-disable type="button">Deactivate</button>':`<button class="btn primary" data-addon-enable type="button">${active?'Switch Version':'Activate'}</button>`}</div>`;
    modal.querySelector('.modal-close').onclick=()=>closeModal(modal);modal.querySelector('[data-addon-detail-close]').onclick=()=>closeModal(modal);
    modal.querySelector('[data-addon-enable]')?.addEventListener('click',()=>{
      const current=activeForUUID(m.uuid);
      const run=async()=>{try{await activate(m.uuid,m.version);closeModal(modal);status(`Activated ${m.name} v${m.version}`);openManagement();}catch(err){status(`Activation failed: ${err.message||err}`);}};
      if(current&&current.version!==String(m.version))confirm('Switch Addon Version',`Replace the active version ${current.version} with ${m.version} for this project? Both package versions will remain installed.`,run,'Switch');else run();
    });
    modal.querySelector('[data-addon-disable]')?.addEventListener('click',()=>confirm('Deactivate Addon',`Deactivate ${m.name}? Placed ScriptNodes from this Addon may stop working and will remain unresolved until the Addon is activated again.`,async()=>{await deactivate(m.uuid);closeModal(modal);status(`${m.name} deactivated`);openManagement();},'Deactivate'));
    showModal(modal);
  }
  async function chooseAddonImport(){
    let input=document.getElementById('addonImportInput');
    if(!input){input=document.createElement('input');input.type='file';input.accept='.zip,application/zip';input.id='addonImportInput';input.hidden=true;document.body.append(input);input.addEventListener('change',async()=>{const file=input.files?.[0];input.value='';if(!file)return;try{const result=await importAddonPackage(new Uint8Array(await file.arrayBuffer()));const m=result.manifest;status(result.reused?`${m.name} v${m.version} is already installed`:`Installed ${m.name} v${m.version}. Activate it from Addon Management.`);await openManagement();}catch(err){status(`Addon import failed: ${err.message||err}`);window.UIXApp?.showInfo?.('Addon Import Failed',err.message||String(err));}});}
    confirm('Import Addon Package','Addon packages contain JavaScript that runs with Node2D editor/runtime privileges. Import only Addons from sources you trust.',()=>input.click(),'Choose ZIP');
  }
  function makeZip(files){
    const local=[],central=[];let offset=0;
    for(const file of files){const name=te.encode(file.name),data=file.bytes instanceof Uint8Array?file.bytes:te.encode(String(file.text??'')),crc=crc32(data),flags=0x0800;
      const lh=Uint8Array.from([0x50,0x4b,0x03,0x04,20,0,flags&255,(flags>>>8)&255,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0]);
      const ch=Uint8Array.from([0x50,0x4b,0x01,0x02,20,0,20,0,flags&255,(flags>>>8)&255,0,0,0,0,0,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(offset)]);
      local.push(lh,name,data);central.push(ch,name);offset+=lh.length+name.length+data.length;
    }
    const centralSize=central.reduce((n,p)=>n+p.length,0),end=Uint8Array.from([0x50,0x4b,0x05,0x06,0,0,0,0,...u16(files.length),...u16(files.length),...u32(centralSize),...u32(offset),0,0]);
    return concat([...local,...central,end]);
  }
  function downloadTemplate(){
    const uuid=crypto.randomUUID?.()||`${Date.now().toString(16).padStart(8,'0')}-0000-4000-8000-${Math.random().toString(16).slice(2,14).padEnd(12,'0')}`;
    const manifest={uuid,name:'My Node2D Addon',description:'A custom Addon for Node2D.',icon:'Addon.png',version:'1.0.0'};
    const files=[
      {name:'manifest.json',text:JSON.stringify(manifest,null,2)},
      {name:'Addon.png',bytes:Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACBklEQVR4nO2bq1YDMRCGUw7vgkAiiy8O0YPCIep4GhwCh+IgcOC7b4NBVoGanhCy2Uwyl4TMp7htMvPPP8l2ya7Ozi++3cCcaAegjQmgHYA2wwtwWnPxy9s7VRzV3FxfFV23wu4CLSU9B0YMVAv0kLxzuDizHRAbtNR2HJTGlyVAOHhLiYdgY11sgZ6Sd+5vfEvtkBSgt+QBjAizAvSaPJArQtYu0FvyQE7c6neC+2lSnT8qgG8Xzurvp8nd3t2ziuDHH2sDdQdooyYAVN85x+6CFOYAjUn96gNaLjAHSE8Yqz6g4YLhHVD1RAhLWP2P18dfv99sd0cXXK7XIjEN7wAxAVK9HyK5FpgDJCbBVB+QcoE5gHuCkuoDEi4wB3AOXlN9gNsF5gCugSmqD3C6wBzAMShl9QEuFwzvAPJPg5jqb7Y71NgcnxSHdwCpABy9H0K9Fog+EAnxH4hg24EKMgdgqx8+DQq/T0HpApU1YC5ZjAhUkAgg0fshVC6wXaB2gJLqzy14pfcFNag5IExWaxeo2gZB/eenh6LrP78Ox69Lx4A4Su8OqwSQ+ucFJ7YIxn64dKykJ5aO+5gDcv6oVxfkxD0rAPbIaWvkHvRMOqBXETCnXBdboDcRsEd87X0BzCszrVffJ7c4qG2wpYqnwMSJfmnKpyVHiL019t+wO0HtALQZXoAfzE/3r2jSnGEAAAAASUVORK5CYII='),c=>c.charCodeAt(0))},
      {name:'main.js',text:`(() => {\n  return {\n    registry: {\n      scriptNodes: ['utilities.js'],\n      components: []\n    }\n  };\n})();`},
      {name:'scriptNodes/utilities.js',text:`(() => {\n  return [\n    {\n      name: 'addonHello',\n      group: 'Actions',\n      receiver: true,\n      output: [{ id: 'out' }],\n      editor: [{ name: 'Message', type: 'str', value: 'Hello from the Addon' }],\n      func: (ctx, values) => {\n        ctx.pushOutput?.('Log', values.Message);\n        return { out: true };\n      }\n    },\n    {\n      name: 'addonSecondAction',\n      group: 'Actions',\n      receiver: true,\n      output: [{ id: 'out' }],\n      editor: [],\n      func: () => ({ out: true })\n    }\n  ];\n})();`}
    ];
    const zip=makeZip(files),blob=new Blob([zip],{type:'application/zip'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Node2D-Addon-Template.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);status('Addon template ZIP downloaded');
  }

  window.UIXAddons={
    initialize,inspectPackage,importAddonPackage,importEmbeddedPackages,restoreProject,
    getProjectConfig,getActivePackages,listPackages:packageDetails,activate,deactivate,moveActive,
    isActive,activeForUUID,openManagement,openDetails,rebuildRegistry,
    getLogs:key=>lastLogs.get(key)||[],getBuiltInScriptNodes:()=>baseScriptNodes.slice()
  };
})();
