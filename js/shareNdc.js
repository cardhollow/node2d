(function(){
  'use strict';

  const CHUNK_SIZE = 64 * 1024;
  const MAX_BUFFERED = 4 * 1024 * 1024;
  const STYLE_ID = 'uixShareNdcStyles';
  const MODAL_ID = 'shareNdcModal';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $ = id => document.getElementById(id);
  const clamp = (n,a=0,b=100) => Math.max(a, Math.min(b, Number(n)||0));

  const state = {
    peer: null,
    connection: null,
    role: null,
    hostCode: '',
    sendSource: null,
    received: null,
    receivedBytes: 0,
    receivedName: '',
    accepted: false,
    sending: false,
    destroyed: false
  };

  function injectStyles(){
    if($(STYLE_ID)) return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      .share-ndc-modal{width:min(560px,calc(100vw - 24px));max-height:min(720px,calc(100vh - 24px));}
      .share-ndc-topbar{display:flex;align-items:stretch;border-bottom:1px solid var(--border-color,#333);}
      .share-ndc-tab{flex:1;border:0;background:transparent;color:var(--text-muted,#999);padding:11px 14px;font:inherit;cursor:pointer;border-bottom:2px solid transparent;}
      .share-ndc-tab.active{color:var(--text-primary,#fff);border-bottom-color:var(--text-primary,#fff);}
      .share-ndc-panel{padding:16px;overflow:auto;max-height:calc(100vh - 190px);}
      .share-ndc-field{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end;margin-bottom:14px;}
      .share-ndc-field.single{grid-template-columns:1fr;}
      .share-ndc-label{display:block;font-size:12px;color:var(--text-muted,#999);margin-bottom:6px;}
      .share-ndc-input,.share-ndc-select{box-sizing:border-box;width:100%;min-height:38px;border:1px solid var(--border-color,#3a3a3a);background:var(--input-bg,#181818);color:var(--text-primary,#fff);border-radius:6px;padding:8px 10px;}
      .share-ndc-input:focus,.share-ndc-select:focus{outline:1px solid var(--text-primary,#fff);}
      .share-ndc-status{min-height:40px;padding:10px 11px;border:1px solid var(--border-color,#333);background:var(--panel-bg,#151515);border-radius:6px;line-height:1.35;margin-top:10px;font-size:13px;}
      .share-ndc-status.error{border-color:#884444;}
      .share-ndc-progress{margin-top:12px;}
      .share-ndc-progress-head{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--text-muted,#999);margin-bottom:6px;}
      .share-ndc-progress-track{height:7px;border-radius:4px;overflow:hidden;background:#2a2a2a;}
      .share-ndc-progress-bar{height:100%;width:0;background:#ddd;transition:width .08s linear;}
      .share-ndc-note{font-size:12px;color:var(--text-muted,#999);line-height:1.4;margin-top:10px;}
      .share-ndc-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.02em;}
      .share-ndc-modal .modal-actions{justify-content:flex-end;}
      .share-ndc-row{margin-bottom:14px;}
      @media(max-width:520px){.share-ndc-field{grid-template-columns:1fr;}.share-ndc-field .btn{width:100%;}}
    `;
    document.head.appendChild(style);
  }

  function ensureModal(){
    let modal=$(MODAL_ID);
    if(modal) return modal;
    injectStyles();
    modal=document.createElement('section');
    modal.id=MODAL_ID;
    modal.className='modal share-ndc-modal';
    modal.dataset.closeOutside='true';
    modal.hidden=true;
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.innerHTML=`
      <div class="modal-header">
        <div><h3>Share NDC</h3><p>Send a Node2D project directly to another editor.</p></div>
        <button class="modal-close" id="shareNdcClose" type="button">×</button>
      </div>
      <div class="share-ndc-topbar">
        <button class="share-ndc-tab active" id="shareNdcSendTab" type="button">Send</button>
        <button class="share-ndc-tab" id="shareNdcReceiveTab" type="button">Received</button>
      </div>
      <div id="shareNdcSendPanel" class="share-ndc-panel">
        <div class="share-ndc-row">
          <label class="share-ndc-label" for="shareNdcHostCode">Share Code</label>
          <div class="share-ndc-field">
            <input id="shareNdcHostCode" class="share-ndc-input share-ndc-code" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Write a code to start sharing">
            <button id="shareNdcHostButton" class="btn primary" type="button">Host</button>
          </div>
        </div>
        <div class="share-ndc-row">
          <label class="share-ndc-label" for="shareNdcSource">NDC</label>
          <select id="shareNdcSource" class="share-ndc-select"></select>
        </div>
        <div class="share-ndc-field">
          <div id="shareNdcSendStatus" class="share-ndc-status">Enter a share code, then press Host.</div>
          <button id="shareNdcSendButton" class="btn primary" type="button" disabled>Send NDC</button>
        </div>
        <div id="shareNdcSendProgress" class="share-ndc-progress" hidden>
          <div class="share-ndc-progress-head"><span id="shareNdcSendProgressText">Preparing…</span><span id="shareNdcSendProgressPct">0%</span></div>
          <div class="share-ndc-progress-track"><div id="shareNdcSendProgressBar" class="share-ndc-progress-bar"></div></div>
        </div>
        <div class="share-ndc-note">The share code is used by PeerJS to connect the two browsers. The NDC is sent through the peer-to-peer data connection.</div>
      </div>
      <div id="shareNdcReceivePanel" class="share-ndc-panel" hidden>
        <div class="share-ndc-row">
          <label class="share-ndc-label" for="shareNdcReceiveCode">Share Code</label>
          <div class="share-ndc-field">
            <input id="shareNdcReceiveCode" class="share-ndc-input share-ndc-code" type="text" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Write the share code from the sender">
            <button id="shareNdcConnectButton" class="btn primary" type="button">Connect</button>
          </div>
        </div>
        <div class="share-ndc-field">
          <div id="shareNdcReceiveStatus" class="share-ndc-status">Enter the sender's share code, then press Connect.</div>
          <button id="shareNdcAcceptButton" class="btn primary" type="button" disabled>Accept</button>
        </div>
        <div id="shareNdcReceiveProgress" class="share-ndc-progress" hidden>
          <div class="share-ndc-progress-head"><span id="shareNdcReceiveProgressText">Receiving…</span><span id="shareNdcReceiveProgressPct">0%</span></div>
          <div class="share-ndc-progress-track"><div id="shareNdcReceiveProgressBar" class="share-ndc-progress-bar"></div></div>
        </div>
        <div class="share-ndc-note">After the full NDC arrives, press Accept to pass it into Node2D's normal project import path.</div>
      </div>
      <div class="modal-actions"><button id="shareNdcDoneButton" class="btn" type="button">Close</button></div>
    `;
    document.body.appendChild(modal);
    bindModal(modal);
    return modal;
  }

  function setTab(which){
    const send=which==='send';
    $('shareNdcSendTab')?.classList.toggle('active',send);
    $('shareNdcReceiveTab')?.classList.toggle('active',!send);
    if($('shareNdcSendPanel'))$('shareNdcSendPanel').hidden=!send;
    if($('shareNdcReceivePanel'))$('shareNdcReceivePanel').hidden=send;
  }

  function setStatus(id,text,error=false){
    const el=$(id);if(!el)return;
    el.textContent=text||'';el.classList.toggle('error',!!error);
  }

  function setProgress(prefix,pct,text,show=true){
    const box=$(prefix+'Progress'),bar=$(prefix+'ProgressBar'),num=$(prefix+'ProgressPct'),label=$(prefix+'ProgressText');
    if(box)box.hidden=!show;
    const p=clamp(pct);
    if(bar)bar.style.width=p+'%';
    if(num)num.textContent=Math.round(p)+'%';
    if(label)label.textContent=text||'';
  }

  function normalizeCode(value){
    return String(value||'').trim();
  }

  function validPeerId(value){
    return /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$/.test(value);
  }

  function peerAvailable(){return typeof window.Peer==='function';}

  function cleanupConnection(){
    try{state.connection?.close();}catch{}
    state.connection=null;
    state.sending=false;
    updateButtons();
  }

  function destroyPeer(){
    cleanupConnection();
    try{state.peer?.destroy();}catch{}
    state.peer=null;
    state.role=null;
    state.hostCode='';
  }

  function sourceLabel(source){
    if(source?.type==='current')return `Current Project — ${source.name}`;
    return `Local NDC — ${source.name}`;
  }

  async function refreshSources(){
    const select=$('shareNdcSource');
    if(!select)return;
    const previous=select.value;
    select.innerHTML='';
    if(window.UIXApp?.hasLoadedProject?.()){
      const name=String(window.UIXApp.getCurrentProjectName?.()||'Current Project');
      const option=document.createElement('option');option.value='current';option.textContent=sourceLabel({type:'current',name});select.appendChild(option);
    }
    try{
      const list=await window.UIXNDCCodec?.listLocal?.()||[];
      list.sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));
      list.forEach(record=>{
        const option=document.createElement('option');option.value='local:'+String(record.id);option.textContent=sourceLabel({type:'local',name:String(record.name||'Untitled Node2D')});select.appendChild(option);
      });
    }catch(err){console.warn('Share NDC: unable to list local projects',err);}
    if([...select.options].some(o=>o.value===previous))select.value=previous;
    updateButtons();
  }

  function getSelectedSource(){
    const value=$('shareNdcSource')?.value||'';
    if(value==='current')return {type:'current',name:String(window.UIXApp?.getCurrentProjectName?.()||'Untitled Node2D')};
    if(value.startsWith('local:')){
      const id=value.slice(6);
      const text=$('shareNdcSource')?.selectedOptions?.[0]?.textContent||'Local NDC';
      return {type:'local',id,name:text.replace(/^Local NDC\s+—\s*/,'')||'Local NDC'};
    }
    return null;
  }

  async function readSelectedNdc(){
    const source=getSelectedSource();
    if(!source)throw new Error('Select an NDC or Current Project first');
    if(source.type==='current'){
      if(!window.UIXApp?.buildProjectNDC)throw new Error('Node2D project export is unavailable');
      return {bytes:new Uint8Array(await window.UIXApp.buildProjectNDC()),name:source.name};
    }
    const saved=await window.UIXNDCCodec?.loadLocal?.(source.id);
    if(!saved)throw new Error('Selected Local NDC was not found');
    return {bytes:new Uint8Array(saved.bytes),name:String(saved.name||source.name||'Node2D Project')};
  }

  function updateButtons(){
    const connected=!!state.connection?.open;
    const hasCode=!!normalizeCode($('shareNdcHostCode')?.value);
    const hasSource=!!getSelectedSource();
    if($('shareNdcHostButton'))$('shareNdcHostButton').disabled=!peerAvailable()||!hasCode||!!state.peer;
    if($('shareNdcSendButton'))$('shareNdcSendButton').disabled=!connected||!hasSource||state.sending;
    if($('shareNdcConnectButton'))$('shareNdcConnectButton').disabled=!peerAvailable()||!!state.peer;
    if($('shareNdcAcceptButton'))$('shareNdcAcceptButton').disabled=!state.received?.complete||state.accepted;
  }

  function handlePeerError(err,role){
    const message=String(err?.type||err?.message||err||'Unknown PeerJS error');
    const friendly={
      'unavailable-id':'That share code is already in use. Choose another code.',
      'invalid-id':'That share code is not a valid PeerJS ID.',
      'peer-unavailable':'The sender could not be found. Check the share code.',
      'network':'PeerJS could not reach its signaling server.',
      'server-error':'The PeerJS signaling server reported an error.',
      'socket-error':'The PeerJS connection to the signaling server failed.'
    }[message]||`PeerJS error: ${message}`;
    if(role==='receive')setStatus('shareNdcReceiveStatus',friendly,true);else setStatus('shareNdcSendStatus',friendly,true);
    if(role==='send')setProgress('shareNdcSend',0,'',false);
    if(role==='receive')setProgress('shareNdcReceive',0,'',false);
    updateButtons();
  }

  function createPeer(id,role,onOpen){
    destroyPeer();
    if(!peerAvailable())throw new Error('PeerJS is not loaded. Check the PeerJS script in index.html.');
    state.role=role;
    state.peer=new window.Peer(id);
    state.peer.on('open',peerId=>{
      state.hostCode=peerId;
      onOpen?.(peerId);
      updateButtons();
    });
    state.peer.on('error',err=>{
      handlePeerError(err,role);
      if(['unavailable-id','invalid-id','network','server-error','socket-error'].includes(String(err?.type||''))){
        try{state.peer?.destroy();}catch{}
        state.peer=null;
        state.role=null;
        updateButtons();
      }
    });
    state.peer.on('disconnected',()=>{
      if(role==='send')setStatus('shareNdcSendStatus','PeerJS signaling disconnected. The existing data connection may still work.',true);
      else setStatus('shareNdcReceiveStatus','PeerJS signaling disconnected. The existing data connection may still work.',true);
    });
    state.peer.on('close',()=>{state.peer=null;state.connection=null;updateButtons();});
    if(role==='send'){
      state.peer.on('connection',conn=>{
        if(state.connection){try{conn.close();}catch{};return;}
        attachHostConnection(conn);
      });
    }
    return state.peer;
  }

  function attachHostConnection(conn){
    state.connection=conn;
    setStatus('shareNdcSendStatus','Recipient connected; Start sharing NDC.');
    conn.on('open',()=>{
      setStatus('shareNdcSendStatus','Recipient connected; Start sharing NDC.');
      updateButtons();
    });
    conn.on('close',()=>{if(state.connection===conn){state.connection=null;state.sending=false;setStatus('shareNdcSendStatus','Recipient disconnected.');updateButtons();}});
    conn.on('error',err=>{if(state.connection===conn){setStatus('shareNdcSendStatus',`Connection error: ${err?.message||err}`,true);state.connection=null;updateButtons();}});
  }

  async function host(){
    const code=normalizeCode($('shareNdcHostCode')?.value);
    if(!code)return setStatus('shareNdcSendStatus','Write a share code first.',true);
    if(!validPeerId(code))return setStatus('shareNdcSendStatus','Use letters/numbers, with - or _ only in the middle of the code.',true);
    try{
      setStatus('shareNdcSendStatus','Starting host…');
      const peer=createPeer(code,'send',peerId=>{
        state.hostCode=peerId;
        $('shareNdcHostCode').value=peerId;
        setStatus('shareNdcSendStatus','Host has been initiated. Connect the recipient.');
      });
      peer.on('open',()=>updateButtons());
    }catch(err){setStatus('shareNdcSendStatus',err.message||String(err),true);}
  }

  function connect(){
    const code=normalizeCode($('shareNdcReceiveCode')?.value);
    if(!code)return setStatus('shareNdcReceiveStatus','Write the sender\'s share code first.',true);
    if(!validPeerId(code))return setStatus('shareNdcReceiveStatus','That share code is not a valid PeerJS ID.',true);
    try{
      setStatus('shareNdcReceiveStatus','Connecting to sender…');
      const peer=createPeer(undefined,'receive',peerId=>{
        state.hostCode=code;
        setStatus('shareNdcReceiveStatus',`Connected as ${peerId}. Waiting for the sender to start sharing.`);
      });
      const conn=peer.connect(code,{reliable:true,metadata:{node2d:'share-ndc',version:1}});
      state.connection=conn;
      conn.on('open',()=>{
        setStatus('shareNdcReceiveStatus','Recipient connected; waiting for NDC.');
        updateButtons();
      });
      conn.on('data',handleReceiveData);
      conn.on('close',()=>{state.connection=null;setStatus('shareNdcReceiveStatus','Sender disconnected.');updateButtons();});
      conn.on('error',err=>{state.connection=null;setStatus('shareNdcReceiveStatus',`Connection error: ${err?.message||err}`,true);updateButtons();});
    }catch(err){setStatus('shareNdcReceiveStatus',err.message||String(err),true);}
  }

  async function waitForSendBuffer(conn){
    const dc=conn?.dataChannel;
    if(!dc)return;
    while((dc.bufferedAmount||0)>MAX_BUFFERED){
      await new Promise(resolve=>setTimeout(resolve,12));
    }
  }

  async function sendNdc(){
    if(!state.connection?.open)return setStatus('shareNdcSendStatus','Connect a recipient first.',true);
    if(state.sending)return;
    state.sending=true;
    updateButtons();
    setProgress('shareNdcSend',0,'Preparing NDC…',true);
    try{
      const {bytes,name}=await readSelectedNdc();
      const total=bytes.byteLength;
      if(!total)throw new Error('The selected NDC is empty');
      const conn=state.connection;
      conn.send({type:'ndc-start',name,size:total,chunkSize:CHUNK_SIZE});
      let sent=0;
      while(sent<total){
        if(state.connection!==conn||!conn.open)throw new Error('Recipient disconnected');
        const end=Math.min(total,sent+CHUNK_SIZE);
        const chunk=bytes.buffer.slice(bytes.byteOffset+sent,bytes.byteOffset+end);
        await waitForSendBuffer(conn);
        conn.send(chunk);
        sent=end;
        const p=sent/total*100;
        setProgress('shareNdcSend',p,`Sending ${name}…`,true);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      await waitForSendBuffer(conn);
      conn.send({type:'ndc-end'});
      setProgress('shareNdcSend',100,'NDC sent. Waiting for recipient to accept.',true);
      setStatus('shareNdcSendStatus','Sender is sending NDC; the recipient can press Accept when it finishes.');
    }catch(err){
      setProgress('shareNdcSend',0,'',false);
      setStatus('shareNdcSendStatus',`Send failed: ${err.message||err}`,true);
    }finally{state.sending=false;updateButtons();}
  }

  function beginReceive(meta){
    state.received={name:String(meta?.name||'Shared Node2D Project'),size:Number(meta?.size)||0,chunks:[],complete:false};
    state.receivedBytes=0;
    state.receivedName=state.received.name;
    state.accepted=false;
    setProgress('shareNdcReceive',0,`Receiving ${state.received.name}…`,true);
    setStatus('shareNdcReceiveStatus','Sender is sending NDC…');
    updateButtons();
  }

  async function handleReceiveData(data){
    if(!data)return;
    try{
      if(data?.type==='ndc-start'){beginReceive(data);return;}
      if(data?.type==='ndc-end'){
        if(!state.received)return setStatus('shareNdcReceiveStatus','Received an incomplete NDC.',true);
        if(state.receivedBytes!==state.received.size)return setStatus('shareNdcReceiveStatus',`NDC size mismatch (${state.receivedBytes}/${state.received.size} bytes).`,true);
        state.received.complete=true;
        setProgress('shareNdcReceive',100,'NDC received. Press Accept.',true);
        setStatus('shareNdcReceiveStatus','Sender is finished. Press Accept to import the received NDC.');
        updateButtons();
        return;
      }
      if(!state.received)return;
      let bytes=null;
      if(data instanceof ArrayBuffer)bytes=new Uint8Array(data);
      else if(data instanceof Uint8Array)bytes=data;
      else if(typeof Blob!=='undefined'&&data instanceof Blob)bytes=new Uint8Array(await data.arrayBuffer());
      if(!bytes?.byteLength)return;
      state.received.chunks.push(bytes.slice());
      state.receivedBytes+=bytes.byteLength;
      const p=state.received.size?state.receivedBytes/state.received.size*100:0;
      setProgress('shareNdcReceive',p,`Receiving ${state.received.name}…`,true);
    }catch(err){setStatus('shareNdcReceiveStatus',`Receive failed: ${err.message||err}`,true);}
  }

  function combineReceived(){
    const total=state.received?.size||0;
    const out=new Uint8Array(total);
    let offset=0;
    for(const chunk of state.received?.chunks||[]){out.set(chunk,offset);offset+=chunk.byteLength;}
    if(offset!==total)throw new Error('Received NDC is incomplete');
    return out;
  }

  async function accept(){
    if(!state.received?.complete||state.accepted)return;
    state.accepted=true;
    updateButtons();
    try{
      const bytes=combineReceived();
      setStatus('shareNdcReceiveStatus','Importing received project into Node2D…');
      setProgress('shareNdcReceive',100,'Importing project…',true);
      if(!window.UIXApp?.loadProjectBytes)throw new Error('Node2D import channel is unavailable');
      window.UIXApp.loadProjectBytes(bytes,state.receivedName||'Shared Node2D Project',{localNdcId:null});
      setStatus('shareNdcReceiveStatus','Project sent to the Node2D import channel.');
      setTimeout(()=>{destroyPeer();closeShareModal();},250);
    }catch(err){
      state.accepted=false;updateButtons();
      setStatus('shareNdcReceiveStatus',`Import failed: ${err.message||err}`,true);
    }
  }

  function closeShareModal(){
    destroyPeer();
    const modal=$(MODAL_ID);
    if(modal&&window.UIXApp?.closeModal)window.UIXApp.closeModal(modal);else if(modal)modal.hidden=true;
  }

  async function openShareModal(){
    const modal=ensureModal();
    state.destroyed=false;
    setTab('send');
    await refreshSources();
    if(window.UIXApp?.showModal)window.UIXApp.showModal(modal);else modal.hidden=false;
    updateButtons();
  }

  function bindModal(modal){
    $('shareNdcSendTab').onclick=()=>setTab('send');
    $('shareNdcReceiveTab').onclick=()=>setTab('receive');
    $('shareNdcHostButton').onclick=host;
    $('shareNdcConnectButton').onclick=connect;
    $('shareNdcSendButton').onclick=sendNdc;
    $('shareNdcAcceptButton').onclick=accept;
    $('shareNdcDoneButton').onclick=closeShareModal;
    $('shareNdcClose').onclick=closeShareModal;
    $('shareNdcHostCode').addEventListener('input',updateButtons);
    $('shareNdcSource').addEventListener('change',updateButtons);
    $('shareNdcReceiveCode').addEventListener('input',updateButtons);
    const observer=new MutationObserver(()=>{
      if(modal.hidden && (state.peer||state.connection))destroyPeer();
    });
    observer.observe(modal,{attributes:true,attributeFilter:['hidden']});
  }

  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-action="share-ndc"]');
    if(!button)return;
    e.preventDefault();
    e.stopPropagation();
    openShareModal();
  });

  window.UIXShareNDC={open:openShareModal,close:closeShareModal,destroy:destroyPeer};
})();
