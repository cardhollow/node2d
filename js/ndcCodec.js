(() => {
  'use strict';

  const te = new TextEncoder();
  const td = new TextDecoder();
  const MAGIC = [0x4e,0x44,0x43,0x31]; // NDC1 — keep this version stable.
  const PKG = [0x4e,0x44,0x50,0x31];   // NDP1
  const TEXT = [0x4e,0x44,0x46,0x31];  // NDF1
  const MAX_DICT = 254;                 // 0xFF is reserved by the text stream.
  const MAX_PHRASE_TOKENS = 10;
  const MAX_LZ_PASSES = 8;
  const WINDOW = 65535;
  const MAX_MATCH = 258;
  const DB_NAME = 'uix-ndc-projects-v1';
  const DB_VERSION = 1;
  const STORE = 'projects';
  const CURRENT_KEY = 'current';
  const LOCAL_PREFIX = 'local:';

  const clone = v => {
    if (!v || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(clone);
    const o = {};
    for (const k of Object.keys(v)) o[k] = clone(v[k]);
    return o;
  };
  const u32 = v => [(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255];
  const r32 = (b,i) => (((b[i]<<24)>>>0)|(b[i+1]<<16)|(b[i+2]<<8)|b[i+3])>>>0;
  const cat = parts => { let n=0; for(const p of parts)n+=p.length; const out=new Uint8Array(n); let at=0; for(const p of parts){out.set(p,at);at+=p.length;} return out; };
  const utf8 = s => te.encode(String(s ?? ''));
  const text = b => td.decode(b);
  const sameBytes = (a,b) => a.length===b.length && a.every((v,i)=>v===b[i]);
  const uvar = n => { const out=[]; let v=Number(n)>>>0; while(v>=128){out.push((v&127)|128);v>>>=7;} out.push(v); return out; };
  function readUvar(b,s){ let v=0,shift=0; while(s.i<b.length){const x=b[s.i++];v|=(x&127)<<shift;if(!(x&128))return v>>>0;shift+=7;} throw Error('Invalid NDC varint'); }

  function parseDataURL(value){
    const s=String(value||'');
    const m=s.match(/^data:([^;,]*)(?:;charset=[^;,]*)?(;base64)?,([\s\S]*)$/i);
    if(!m)return null;
    const mime=m[1]||'application/octet-stream';
    if(m[2]){
      const raw=atob(m[3].replace(/\s+/g,''));
      const bytes=new Uint8Array(raw.length);
      for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      return {mime,valueKind:'binary',bytes};
    }
    let valueText=m[3]; try{valueText=decodeURIComponent(valueText);}catch{}
    return {mime,valueKind:'text',bytes:utf8(valueText),text:valueText};
  }
  function bytesToDataURL(mime,bytes){
    let raw='';
    for(let i=0;i<bytes.length;i+=0x8000)raw+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return `data:${mime||'application/octet-stream'};base64,${btoa(raw)}`;
  }

  // Text dictionary: words, phrases and repeated sentence/line-sized strings all compete
  // against each other. The score is actual estimated byte savings, so a frequent sentence
  // can beat several shorter words when it removes more bytes overall.
  function tokenize(s){return String(s??'').match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu)||[];}
  function buildTextDictionary(texts){
    const counts=new Map();
    const add=(s)=>{if(!s)return;counts.set(s,(counts.get(s)||0)+1);};
    for(const source of texts){
      const s=String(source??'');
      const toks=tokenize(s);
      for(const t of toks)if(t.length>=2)add(t);
      for(let i=0;i<toks.length;i++){
        let phrase='';
        for(let n=1;n<=MAX_PHRASE_TOKENS&&i+n<=toks.length;n++){
          phrase+=toks[i+n-1];
          if(n>=2&&phrase.length>=4&&phrase.length<=192)add(phrase);
        }
      }
      for(const line of s.split(/\r?\n/))if(line.length>=8&&line.length<=384)add(line);
      const sentences=s.match(/[^.!?\n]{8,384}[.!?](?=\s|$)/g)||[]; sentences.forEach(add);
    }
    const scored=[];
    for(const [s,freq] of counts){
      if(freq<2)continue;
      const bytes=utf8(s).length;
      const gain=freq*(bytes-1)-(bytes+4);
      if(gain>0)scored.push({s,freq,bytes,gain});
    }
    scored.sort((a,b)=>b.gain-a.gain||b.bytes-a.bytes||b.freq-a.freq);
    return scored.slice(0,MAX_DICT).map(x=>x.s);
  }
  function encodeText(s,dict){
    const toks=tokenize(s),byFirst=new Map();
    dict.forEach((entry,id0)=>{const ts=tokenize(entry);if(!ts.length)return;const a=ts[0];const list=byFirst.get(a)||[];list.push({id:id0+1,ts});byFirst.set(a,list);});
    for(const list of byFirst.values())list.sort((a,b)=>b.ts.length-a.ts.length||b.ts.join('').length-a.ts.join('').length);
    const out=[];
    for(let i=0;i<toks.length;){
      const list=byFirst.get(toks[i]); let match=null;
      if(list)for(const c of list){if(i+c.ts.length>toks.length)continue;let ok=true;for(let j=0;j<c.ts.length;j++)if(toks[i+j]!==c.ts[j]){ok=false;break;}if(ok){match=c;break;}}
      if(match){out.push(match.id);i+=match.ts.length;continue;}
      const raw=utf8(toks[i]); out.push(0xFF,...uvar(raw.length),...raw); i++;
    }
    return Uint8Array.from(out);
  }
  function decodeText(bytes,dict){
    const out=[];const s={i:0};
    while(s.i<bytes.length){
      const id=bytes[s.i++];
      if(id===0xFF){const len=readUvar(bytes,s);if(s.i+len>bytes.length)throw Error('Invalid NDC text literal');out.push(text(bytes.subarray(s.i,s.i+len)));s.i+=len;}
      else {if(id===0)throw Error('Invalid NDC dictionary id');const d=dict[id-1];if(d===undefined)throw Error('Invalid NDC dictionary id');out.push(d);}
    }
    return out.join('');
  }

  function hashBytes(bytes){let h=2166136261>>>0;for(const b of bytes){h^=b;h=Math.imul(h,16777619)>>>0;}return `${bytes.length}:${h.toString(16)}`;}

  // Stable NDP1 package. Plaintext assets are dictionary-compressed together with the
  // project manifest; binary assets are kept as raw bytes and deduplicated exactly.
  function buildPackage1(project){
    const source=clone(project||{});
    const assets=source.assets&&typeof source.assets==='object'?source.assets:{};
    const table=Object.create(null),texts=[],textIndex=new Map(),blobs=[],blobBuckets=new Map();
    const addText=s=>{const k=String(s??'');if(textIndex.has(k))return textIndex.get(k);const i=texts.length;texts.push(k);textIndex.set(k,i);return i;};
    const addBlob=b=>{const key=hashBytes(b),bucket=blobBuckets.get(key)||[];for(const i of bucket)if(sameBytes(blobs[i],b))return i;const i=blobs.length;blobs.push(b.slice());bucket.push(i);blobBuckets.set(key,bucket);return i;};
    for(const [category,list] of Object.entries(assets)){
      if(!Array.isArray(list))continue;const rows=[];table[category]=rows;
      for(const a of list){
        const p=parseDataURL(a?.value); const v=p||{mime:a?.type||'application/octet-stream',valueKind:'text',bytes:utf8(a?.value||''),text:String(a?.value||'')};
        const isText=v.valueKind==='text'; const ref=isText?addText(v.text??text(v.bytes)):addBlob(v.bytes);
        rows.push([a?.id||'',a?.name||'',a?.filename||'',a?.type||v.mime||'application/octet-stream',a?.kind||category,a?.editable!==false?1:0,isText?0:1,ref]);
      }
    }
    source.assets=table; delete source.localNdcId; source.__ndc=1;
    const manifestText=JSON.stringify(source),dict=buildTextDictionary([manifestText,...texts]);
    const encManifest=encodeText(manifestText,dict), parts=[Uint8Array.from(PKG),Uint8Array.from(TEXT),Uint8Array.from(u32(dict.length))];
    for(const d of dict){const b=utf8(d);parts.push(Uint8Array.from(u32(b.length)),b);}
    const manifestRaw=utf8(manifestText);parts.push(Uint8Array.from(u32(manifestRaw.length)),Uint8Array.from(u32(encManifest.length)),encManifest);
    parts.push(Uint8Array.from(u32(texts.length)));
    for(const s of texts){const raw=utf8(s),enc=encodeText(s,dict);parts.push(Uint8Array.from(u32(raw.length)),Uint8Array.from(u32(enc.length)),enc);}
    parts.push(Uint8Array.from(u32(blobs.length)));
    for(const b of blobs)parts.push(Uint8Array.from(u32(b.length)),b);
    return cat(parts);
  }

  function readPackage1(bytes){
    let at=0; const take=()=>{if(at+4>bytes.length)throw Error('Truncated NDC');const v=r32(bytes,at);at+=4;return v;};
    if(bytes.length<8||!PKG.every((v,i)=>bytes[i]===v)||!TEXT.every((v,i)=>bytes[i+4]===v))throw Error('Invalid NDC1 package'); at=8;
    const count=take();if(count>MAX_DICT)throw Error('Unsupported NDC dictionary size');const dict=[];
    for(let i=0;i<count;i++){const len=take();if(at+len>bytes.length)throw Error('Invalid NDC dictionary');dict.push(text(bytes.subarray(at,at+len)));at+=len;}
    const rawLen=take(),encLen=take();if(at+encLen>bytes.length)throw Error('Invalid NDC manifest');const manifestText=decodeText(bytes.subarray(at,at+encLen),dict);at+=encLen;if(utf8(manifestText).length!==rawLen)throw Error('NDC manifest size mismatch');const manifest=JSON.parse(manifestText);
    const textCount=take(),texts=[];for(let i=0;i<textCount;i++){const rl=take(),el=take();if(at+el>bytes.length)throw Error('Invalid NDC text data');const s=decodeText(bytes.subarray(at,at+el),dict);at+=el;if(utf8(s).length!==rl)throw Error('NDC text size mismatch');texts.push(s);}
    const blobCount=take(),blobs=[];for(let i=0;i<blobCount;i++){const len=take();if(at+len>bytes.length)throw Error('Invalid NDC binary asset');blobs.push(bytes.slice(at,at+len));at+=len;}
    if(at!==bytes.length)throw Error('Unexpected data after NDC package');
    const table=manifest.assets&&typeof manifest.assets==='object'?manifest.assets:{};manifest.assets=Object.create(null);
    for(const [catName,rows] of Object.entries(table)){const list=manifest.assets[catName]=[];for(const row of Array.isArray(rows)?rows:[]){const [id,name,filename,type,kind,editable,valueKind,ref]=row;let value;if(Number(valueKind)===0){value=texts[Number(ref)];if(value===undefined)throw Error('Invalid NDC text reference');}else{const data=blobs[Number(ref)];if(!data)throw Error('Invalid NDC binary reference');value=bytesToDataURL(type,data);}list.push({id,name,filename,type,kind,editable:!!editable,value});}}
    delete manifest.__ndc;return manifest;
  }

  // Very old raw package compatibility.
  function readLegacyPackage(bytes){
    let at=bytes.slice(0,4).every((v,i)=>v===PKG[i])?4:0;
    const take=()=>{if(at+4>bytes.length)throw Error('Invalid NDC package');const v=r32(bytes,at);at+=4;return v;};
    const ml=take();if(at+ml>bytes.length)throw Error('Invalid legacy NDC manifest');const project=JSON.parse(text(bytes.subarray(at,at+ml)));at+=ml;const count=take();project.assets=Object.create(null);
    for(let i=0;i<count;i++){const mlen=take();if(at+mlen>bytes.length)throw Error('Invalid legacy NDC metadata');const meta=JSON.parse(text(bytes.subarray(at,at+mlen)));at+=mlen;const dl=take();if(at+dl>bytes.length)throw Error('Invalid legacy NDC data');const data=bytes.slice(at,at+dl);at+=dl;const list=project.assets[meta.category]||(project.assets[meta.category]=[]);list.push({...meta,value:meta.valueKind==='text'?text(data):bytesToDataURL(meta.mime||meta.type,data)});}
    if(at!==bytes.length)throw Error('Unexpected data after legacy NDC package');return project;
  }
  function decompressLegacy(payload){
    if(!payload.length)throw Error('Invalid legacy NDC payload');const passes=payload[0];if(passes>32)throw Error('Unsupported legacy NDC compression depth');let at=1;const ds=[];
    const rv=s=>{let v=0;while(s.i<payload.length){const b=payload[s.i++];v=v*128+(b&127);if(!(b&128))return v>>>0;}throw Error('Invalid legacy varint');};
    for(let p=0;p<passes;p++){if(at+2>payload.length)throw Error('Invalid legacy dictionary');const count=(payload[at]<<8)|payload[at+1];at+=2;const pairs=[];for(let i=0;i<count;i++){const s={i:at};const a=rv(s),b=rv(s);at=s.i;pairs.push([a,b]);}ds.push(pairs);}
    if(at+4>payload.length)throw Error('Invalid legacy stream');const len=r32(payload,at);at+=4;if(at+len>payload.length)throw Error('Invalid legacy stream');const s={i:at},tok=[];while(s.i<at+len)tok.push(rv(s));let base=256,bases=[];for(const d of ds){bases.push(base);base+=d.length;}for(let p=ds.length-1;p>=0;p--){const d=ds[p],start=bases[p],out=[];for(const t of tok){if(t>=start&&t<start+d.length)out.push(...d[t-start]);else out.push(t);}tok.splice(0,tok.length,...out);}const out=new Uint8Array(tok.length);for(let i=0;i<tok.length;i++){if(tok[i]>255)throw Error('Invalid legacy token');out[i]=tok[i];}return out;
  }

  function compressLZ(input){
    const out=[],map=new Map();let i=0,ctrlPos=0,mask=1,ctrl=0;out.push(0);
    const begin=()=>{ctrlPos=out.length;out.push(0);mask=1;ctrl=0;};
    while(i<input.length){let best=0,bestOff=0;if(i+2<input.length){const key=(input[i]<<16)|(input[i+1]<<8)|input[i+2],p=map.get(key);if(p!==undefined){const off=i-p;if(off>0&&off<=WINDOW){let len=0;const max=Math.min(MAX_MATCH,input.length-i);while(len<max&&input[p+len]===input[i+len])len++;if(len>=4){best=len;bestOff=off;}}}}
      if(best>=4){ctrl|=mask;out.push(bestOff&255,(bestOff>>>8)&255,best-3);for(let j=0;j<best;j++)if(i+j+2<input.length)map.set((input[i+j]<<16)|(input[i+j+1]<<8)|input[i+j+2],i+j);i+=best;}
      else {out.push(input[i]);if(i+2<input.length)map.set((input[i]<<16)|(input[i+1]<<8)|input[i+2],i);i++;}
      if(mask===128){out[ctrlPos]=ctrl;begin();}else mask<<=1;
    }
    out[ctrlPos]=ctrl;return Uint8Array.from(out);
  }
  function decompressLZ(input){
    const out=[];let i=0;while(i<input.length){const ctrl=input[i++];for(let bit=1;bit<=128&&i<input.length;bit<<=1){if(ctrl&bit){if(i+2>=input.length)throw Error('Invalid NDC match');const off=input[i]|(input[i+1]<<8),len=input[i+2]+3;i+=3;if(!off||off>out.length)throw Error('Invalid NDC offset');const start=out.length-off;for(let j=0;j<len;j++)out.push(out[start+j]);}else out.push(input[i++]);}}return Uint8Array.from(out);
  }
  function compress(raw){let cur=raw,passes=0;for(let i=0;i<MAX_LZ_PASSES;i++){const next=compressLZ(cur);if(next.length>=cur.length)break;cur=next;passes++;}return passes&&cur.length+1<raw.length?{compressed:true,payload:cat([Uint8Array.from([passes]),cur])}:{compressed:false,payload:raw};}
  function decompressCurrent(payload){const passes=payload[0];if(passes>MAX_LZ_PASSES)throw Error('Unsupported NDC compression depth');let cur=payload.slice(1);for(let i=0;i<passes;i++)cur=decompressLZ(cur);return cur;}

  function encode(project){
    const raw=buildPackage1(project), c=compress(raw), flags=(c.compressed?1:0)|2; // bit 1 = stable NDP1 package.
    return cat([Uint8Array.from(MAGIC),Uint8Array.from([1,flags,0,0]),Uint8Array.from(u32(raw.length)),Uint8Array.from(u32(c.payload.length)),c.payload]);
  }

  function decode(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if(bytes.length>=8&&PKG.every((v,i)=>bytes[i]===v)&&TEXT.every((v,i)=>bytes[i+4]===v))return readPackage1(bytes);
    if(bytes.length>=4&&PKG.every((v,i)=>bytes[i]===v))return readLegacyPackage(bytes);
    if(bytes.length<16||!MAGIC.every((v,i)=>bytes[i]===v))throw Error('Invalid .ndc file');
    const flags=bytes[5],rawLen=r32(bytes,8),payloadLen=r32(bytes,12);if(16+payloadLen>bytes.length)throw Error('Truncated .ndc file');
    let raw=(flags&1)?decompressCurrent(bytes.slice(16,16+payloadLen)):bytes.slice(16,16+payloadLen);if(raw.length!==rawLen)throw Error('NDC size validation failed');
    if(PKG.every((v,i)=>raw[i]===v)&&TEXT.every((v,i)=>raw[i+4]===v))return readPackage1(raw);
    return readLegacyPackage(raw);
  }

  function openDB(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(Error('IndexedDB is unavailable'));const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Could not open IndexedDB'));});}
  const makeId=()=>`ndc-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  async function saveCurrent(bytes,name,id=null){const localId=id||makeId(),rec={id:localId,name:name||'Untitled Node2D',bytes:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),savedAt:Date.now()},db=await openDB();await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite'),s=tx.objectStore(STORE);s.put(rec,CURRENT_KEY);s.put(rec,LOCAL_PREFIX+localId);tx.oncomplete=res;tx.onerror=()=>rej(tx.error||Error('Could not save project'));});db.close();return{id:localId,name:rec.name,savedAt:rec.savedAt};}
  async function loadCurrent(){const db=await openDB(),r=await new Promise((res,rej)=>{const q=db.transaction(STORE,'readonly').objectStore(STORE).get(CURRENT_KEY);q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error||Error('Could not load project'));});db.close();return r?{id:r.id,name:r.name,savedAt:r.savedAt,bytes:new Uint8Array(r.bytes)}:null;}
  async function listLocal(){const db=await openDB();const arr=await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readonly'),s=tx.objectStore(STORE),q=s.getAllKeys();q.onsuccess=async()=>{try{const records=[];for(const key of q.result.filter(k=>typeof k==='string'&&k.startsWith(LOCAL_PREFIX))){const r=await new Promise((a,b)=>{const x=s.get(key);x.onsuccess=()=>a(x.result||null);x.onerror=()=>b(x.error||Error('Could not read local project'));});if(r)records.push({id:r.id||String(key).slice(LOCAL_PREFIX.length),name:r.name||'Untitled Node2D',savedAt:r.savedAt||0});}if(records.length){res(records);return;}const c=await new Promise((a,b)=>{const x=s.get(CURRENT_KEY);x.onsuccess=()=>a(x.result||null);x.onerror=()=>b(x.error||Error('Could not read current project'));});res(c?[{id:c.id||'current',name:c.name||'Untitled Node2D',savedAt:c.savedAt||0}]:[]);}catch(e){rej(e);}};q.onerror=()=>rej(q.error||Error('Could not list local projects'));});db.close();return arr;}
  async function loadLocal(id){if(id==='current')return loadCurrent();const db=await openDB(),r=await new Promise((res,rej)=>{const q=db.transaction(STORE,'readonly').objectStore(STORE).get(LOCAL_PREFIX+id);q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error||Error('Could not load local NDC'));});db.close();return r?{id:r.id||id,name:r.name,savedAt:r.savedAt,bytes:new Uint8Array(r.bytes)}:null;}
  async function renameLocal(id,name){const db=await openDB();await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite'),s=tx.objectStore(STORE);const q=s.get(LOCAL_PREFIX+id);q.onsuccess=()=>{const r=q.result;if(!r){rej(Error('Local NDC was not found'));return;}r.name=name;r.savedAt=Date.now();s.put(r,LOCAL_PREFIX+id);const c=s.get(CURRENT_KEY);c.onsuccess=()=>{if(c.result?.id===id)s.put(r,CURRENT_KEY);};};q.onerror=()=>rej(q.error||Error('Could not rename local NDC'));tx.oncomplete=res;tx.onerror=()=>rej(tx.error||Error('Could not rename local NDC'));});db.close();}
  async function deleteLocal(id){const db=await openDB();await new Promise((res,rej)=>{const tx=db.transaction(STORE,'readwrite'),s=tx.objectStore(STORE);s.delete(LOCAL_PREFIX+id);const c=s.get(CURRENT_KEY);c.onsuccess=()=>{if(c.result?.id===id)s.delete(CURRENT_KEY);};tx.oncomplete=res;tx.onerror=()=>rej(tx.error||Error('Could not delete local NDC'));});db.close();}

  window.UIXNDCCodec={encode,decode,saveCurrent,loadCurrent,listLocal,loadLocal,renameLocal,deleteLocal};
})();
