(() => {
  'use strict';

  const { Assets } = window.UIXAssets;
  const KEYW = 56, RULER = 22, RH = 16, LO = 24, HI = 108;
  const COLORS = ['#e4ca4e','#6fb8e4','#e47f7f','#8fd18f','#c79be4','#e4a24e'];
  const NN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
  const $ = (id, root) => (root || document).getElementById ? (root || document).getElementById(id) : null;
  const safeName = value => String(value || 'MIDI').replace(/\.[^.]+$/, '').trim() || 'MIDI';
  const isBlack = p => [1,3,6,8,10].includes(p % 12);

  let seq = 0;
  let modal = null;
  let input = null;
  let activeShortcutHandler = null;

  const makeGrid = (state) => {
    const total = () => {
      let m = 0;
      state.notes.forEach(n => m = Math.max(m, n.t + n.l));
      return Math.max(64, Math.ceil((m + 1) / 16) * 16 + 16);
    };
    const clampView = () => {
      const h = state.H, w = state.W;
      const maxY = (HI - LO + 1) * RH - (h - RULER);
      state.sy = Math.max(0, Math.min(state.sy, Math.max(0, maxY)));
      state.sx = Math.max(0, Math.min(state.sx, Math.max(0, total() * state.zoom - (w - KEYW) + 80)));
    };
    return { total, clampView };
  };

  function openCreate() {
    openEditor({
      name: 'Song', bpm: 120, ppq: 480, sourceAsset: null,
      tracks: [{ name: 'Track 1', color: COLORS[0], wave: 'triangle', channel: 0 }],
      notes: []
    });
  }

  function midiLoadProgress(){
    let box=document.querySelector('.uix-midi-load-overlay');
    if(box)box.remove();
    box=document.createElement('div');box.className='uix-midi-load-overlay';
    box.innerHTML='<div class="uix-midi-load-card"><strong>Loading MIDI</strong><div class="uix-midi-load-text">Starting…</div><div class="uix-midi-load-track"><div></div></div><div class="uix-midi-load-percent">0%</div></div>';
    document.body.append(box);
    const bar=box.querySelector('.uix-midi-load-track>div'),text=box.querySelector('.uix-midi-load-text'),pct=box.querySelector('.uix-midi-load-percent');
    return {set(value,label){const p=Math.max(0,Math.min(100,Math.round(value)));bar.style.width=p+'%';pct.textContent=p+'%';if(label)text.textContent=label;},remove(){box.remove();}};
  }
  const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
  async function openEdit(asset) {
    const load=midiLoadProgress();
    try {
      load.set(8,'Reading MIDI data…');await nextPaint();
      const raw = String(asset?.value || '');
      const comma = raw.indexOf(',');
      const bytes = raw.startsWith('data:') && comma >= 0
        ? Uint8Array.from(atob(raw.slice(comma + 1)), c => c.charCodeAt(0))
        : null;
      if (!bytes) throw new Error('Invalid MIDI asset');
      load.set(18,`MIDI data loaded · ${Math.round(bytes.length/1024)} KB`);await nextPaint();
      load.set(28,'Parsing MIDI… large files may take a moment');await nextPaint();
      const song=window.UIXMIDIParser.parse(bytes);
      load.set(82,'Building MIDI editor…');await nextPaint();
      openParsedEditor(song, asset);
      load.set(100,'MIDI loaded');await new Promise(resolve=>setTimeout(resolve,180));
    } catch (e) {
      load.set(100,'Could not load MIDI');await new Promise(resolve=>setTimeout(resolve,350));
      window.UIXApp?.status?.('Could not read MIDI asset');
    } finally { load.remove(); }
  }

  function openParsedEditor(song, sourceAsset) {
    const notes = [], tracks = [];
    const importedTracks = song.tracks.filter(track => Array.isArray(track.notes) && track.notes.length);
    importedTracks.forEach((track, i) => {
      const index = tracks.length;
      tracks.push({ name: track.name || `Track ${i + 1}`, color: COLORS[index % COLORS.length], wave: 'triangle', channel: track.channel ?? index % 16 });
      track.notes.forEach(n => {
        const pitch = Math.max(0, Math.min(127, Number(n.pitch) || 0));
        notes.push({ t: Math.max(0, Math.round(n.tick * 4 / song.ppq)), l: Math.max(1, Math.round(n.duration * 4 / song.ppq)), p: pitch, tr: index, velocity: Math.max(1, Math.min(127, Number(n.velocity) || 100)), selected:false });
      });
    });
    openEditor({ name: safeName(sourceAsset?.name || 'Song'), bpm: Math.round(song.bpm || 120), ppq: song.ppq || 480, sourceAsset, tracks: tracks.length ? tracks : [{name:'Track 1',color:COLORS[0],wave:'triangle',channel:0}], notes });
  }

  function openEditor(config) {
    closeEditor();
    modal = document.createElement('section');
    modal.className = 'modal uix-midi-modal';
    modal.id = `uix-midi-modal-${++seq}`;
    modal.dataset.closeOutside = 'false';
    modal.innerHTML = `
      <div class="uix-midi-header">
        <div class="uix-midi-title"><strong>MIDI Editor</strong><span data-midi-name></span></div>
        <div class="uix-midi-actions"><button class="btn" data-midi-cancel type="button">Cancel</button><button class="btn primary" data-midi-save type="button">Save MIDI</button></div>
      </div>
      <div class="uix-midi-body">
        <div class="uix-midi-topbar">
          <div class="uix-midi-grp"><button class="uix-midi-tb" data-midi-play type="button">▶ <span>Play</span></button><button class="uix-midi-tb" data-midi-rew type="button">⏮</button><button class="uix-midi-tb" data-midi-loop type="button">⟲ <span>Loop</span></button></div>
          <div class="uix-midi-sep"></div>
          <div class="uix-midi-grp"><button class="uix-midi-tb active" data-midi-tool="draw" type="button">✎ <span>Draw</span></button><button class="uix-midi-tb" data-midi-tool="erase" type="button">⌫ <span>Erase</span></button><button class="uix-midi-tb" data-midi-tool="pan" type="button">✥ <span>Pan</span></button><button class="uix-midi-tb" data-midi-undo type="button" title="Undo (Ctrl+Z)" disabled>↶</button><button class="uix-midi-tb" data-midi-redo type="button" title="Redo (Ctrl+Y)" disabled>↷</button></div>
          <div class="uix-midi-sep"></div>
          <label class="uix-midi-lbl">BPM <input data-midi-bpm type="number" value="${config.bpm || 120}" min="30" max="300"></label>
          <label class="uix-midi-lbl">Snap <select data-midi-snap><option value="1">1/16</option><option value="2">1/8</option><option value="4" selected>1/4</option><option value="8">1/2</option><option value="16">Bar</option></select></label>
          <label class="uix-midi-lbl">Length <select data-midi-len><option value="1">1/16</option><option value="2" selected>1/8</option><option value="4">1/4</option><option value="8">1/2</option><option value="16">Bar</option></select></label>
          <label class="uix-midi-lbl">Wave <select data-midi-wave><option>triangle</option><option>sine</option><option>square</option><option>sawtooth</option></select></label>
          <div class="uix-midi-sep"></div>
          <div class="uix-midi-grp"><button class="btn" data-midi-import type="button">Import .mid</button><button class="btn primary" data-midi-export type="button">Export .mid</button><button class="uix-midi-tb" data-midi-clear type="button">🗑</button></div>
        </div>
        <div class="uix-midi-content">
          <aside class="uix-midi-tracks"><div class="uix-midi-ph">Tracks</div><div class="uix-midi-tlist" data-midi-tracks></div><div class="uix-midi-tfoot"><button class="btn" data-midi-add-track type="button">+ Add Track</button></div></aside>
          <div class="uix-midi-stage"><canvas data-midi-canvas></canvas><div class="uix-midi-status" data-midi-status></div></div>
        </div>
      </div>`;
    document.body.append(modal);
    window.UIXApp?.showModal?.(modal);

    const state = {
      name: config.name || 'Song', bpm: Number(config.bpm) || 120, ppq: Number(config.ppq) || 480,
      sourceAsset: config.sourceAsset || null, notes: (config.notes || []).map(n => ({...n,selected:!!n.selected})),
      tracks: (config.tracks || []).map(t => ({...t})), cur: 0, tool: 'draw', sx: 0,
      sy: (HI - 72) * RH, zoom: 22, start: 0, playing: false, loop: false, head: 0,
      W: 0, H: 0, dpr: 1, raf: 0, oscillators: [], audio: null, playTimer: 0, playToken: 0, scheduled: new Set(), startedAt: 0, fromStep: 0, history: [], redo: [], historyBusy: false, clipboard: [], noteAnchor: null, pasteTarget: null, selectionBox: null
    };
    if (!state.tracks.length) state.tracks.push({name:'Track 1',color:COLORS[0],wave:'triangle',channel:0});

    const canvas = modal.querySelector('[data-midi-canvas]'), g = canvas.getContext('2d');
    const view = makeGrid(state), total = view.total;
    const status = msg => { modal.querySelector('[data-midi-status]').textContent = msg || ''; };
    const snapshot = () => ({bpm:state.bpm,ppq:state.ppq,start:state.start,head:state.head,cur:state.cur,tool:state.tool,sx:state.sx,sy:state.sy,zoom:state.zoom,notes:state.notes.map(n=>({...n})),tracks:state.tracks.map(t=>({...t}))});
    const sameSnapshot=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    function updateHistoryUI(){const u=modal.querySelector('[data-midi-undo]'),r=modal.querySelector('[data-midi-redo]');if(u)u.disabled=!state.history.length;if(r)r.disabled=!state.redo.length;}
    function pushHistory(before){if(state.historyBusy||!before)return;state.history.push(before);if(state.history.length>100)state.history.shift();state.redo=[];updateHistoryUI();}
    function restoreSnapshot(s){if(!s)return;stop();state.bpm=s.bpm;state.ppq=s.ppq;state.start=s.start;state.head=s.head;state.cur=Math.max(0,Math.min(s.cur,s.tracks.length-1));state.tool=s.tool;state.sx=s.sx;state.sy=s.sy;state.zoom=s.zoom;state.notes=s.notes.map(n=>({...n}));state.tracks=s.tracks.map(t=>({...t}));if(!state.tracks.length)state.tracks.push({name:'Track 1',color:COLORS[0],wave:'triangle',channel:0});modal.querySelector('[data-midi-bpm]').value=state.bpm;modal.querySelector('[data-midi-wave]').value=state.tracks[state.cur]?.wave||'triangle';renderTracks();view.clampView();draw();}
    function undo(){if(!state.history.length)return;const current=snapshot(),prev=state.history.pop();state.historyBusy=true;state.redo.push(current);restoreSnapshot(prev);state.historyBusy=false;updateHistoryUI();status('Undo');}
    function redo(){if(!state.redo.length)return;const current=snapshot(),next=state.redo.pop();state.historyBusy=true;state.history.push(current);restoreSnapshot(next);state.historyBusy=false;updateHistoryUI();status('Redo');}
    const beginHistory=()=>snapshot();

    function addTrack(){const before=beginHistory(),i=state.tracks.length;state.tracks.push({name:`Track ${i+1}`,color:COLORS[i%COLORS.length],wave:'triangle',channel:i%16});state.cur=i;pushHistory(before);renderTracks();draw();}
    function renderTracks(){const host=modal.querySelector('[data-midi-tracks]');host.innerHTML='';state.tracks.forEach((t,i)=>{const row=document.createElement('div');row.className='uix-midi-track-row'+(i===state.cur?' sel':'');row.innerHTML=`<i class="dot" style="background:${t.color}"></i><span></span><button type="button">✕</button>`;row.querySelector('span').textContent=t.name;row.onclick=()=>{state.cur=i;modal.querySelector('[data-midi-wave]').value=t.wave||'triangle';renderTracks();draw();};row.querySelector('button').onclick=e=>{e.stopPropagation();if(state.tracks.length<2)return;const before=beginHistory();state.notes=state.notes.filter(n=>n.tr!==i).map(n=>({...n,tr:n.tr>i?n.tr-1:n.tr}));state.tracks.splice(i,1);state.cur=Math.min(state.cur,state.tracks.length-1);pushHistory(before);renderTracks();draw();};host.append(row)});}
    function resize(){const r=modal.querySelector('.uix-midi-stage').getBoundingClientRect();state.dpr=window.devicePixelRatio||1;state.W=r.width;state.H=r.height;canvas.width=state.W*state.dpr;canvas.height=state.H*state.dpr;view.clampView();draw();}
    function draw(){
      g.setTransform(state.dpr,0,0,state.dpr,0,0);
      g.fillStyle='#202020';g.fillRect(0,0,state.W,state.H);
      g.save();
      g.beginPath();g.rect(KEYW,RULER,state.W-KEYW,state.H-RULER);g.clip();
      for(let p=HI;p>=LO;p--){
        const y=RULER+(HI-p)*RH-state.sy;if(y>state.H||y<RULER-RH)continue;
        g.fillStyle=isBlack(p)?'#242424':'#2a2a2a';g.fillRect(KEYW,y,state.W-KEYW,RH);
        g.fillStyle='#333';g.fillRect(KEYW,y+RH-1,state.W-KEYW,1);
      }
      const T=total();
      for(let ss=0;ss<=T;ss++){
        const x=KEYW+ss*state.zoom-state.sx;if(x<KEYW||x>state.W)continue;
        g.fillStyle=ss%16===0?'#5a5a5a':ss%4===0?'#404040':'#2f2f2f';g.fillRect(x,RULER,1,state.H);
      }
      state.notes.forEach(n=>{
        const t=state.tracks[n.tr];if(!t)return;
        const x=KEYW+n.t*state.zoom-state.sx,y=RULER+(HI-n.p)*RH-state.sy;
        if(x+n.l*state.zoom<KEYW||x>state.W||y>state.H||y<RULER-RH)return;
        const selected=!!n.selected;
        g.globalAlpha=n.tr===state.cur?1:.35;
        g.fillStyle=selected?'#e4ca4e':(t.color||COLORS[0]);
        g.fillRect(x+1,y+1,Math.max(3,n.l*state.zoom-2),RH-2);
        if(selected){
          g.strokeStyle='#fff';g.lineWidth=1;g.strokeRect(x+.5,y+.5,Math.max(3,n.l*state.zoom-1),RH-1);
        }else{
          g.fillStyle='rgba(0,0,0,.35)';g.fillRect(x+Math.max(3,n.l*state.zoom-2)-3,y+1,3,RH-2);
        }
        g.globalAlpha=1;
      });
      if(state.selectionBox){
        const a=state.selectionBox.a,b=state.selectionBox.b;
        const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y);
        g.fillStyle='rgba(228,202,78,.08)';g.fillRect(x,y,w,h);
        g.strokeStyle='rgba(228,202,78,.95)';g.lineWidth=1;g.setLineDash([4,3]);g.strokeRect(x+.5,y+.5,w,h);g.setLineDash([]);
      }
      const hx=KEYW+state.head*state.zoom-state.sx;g.fillStyle='#e4ca4e';g.fillRect(hx,RULER,1.5,state.H);
      const sx0=KEYW+state.start*state.zoom-state.sx;g.fillStyle='rgba(228,202,78,.5)';g.fillRect(sx0,RULER,1,state.H);
      g.restore();
      g.fillStyle='#222';g.fillRect(KEYW,0,state.W-KEYW,RULER);g.fillStyle='#3b3b3b';g.fillRect(0,RULER-1,state.W,1);
      g.fillStyle='#8c8c8c';g.font='10px system-ui';g.textBaseline='middle';
      for(let ss=0;ss<=T;ss+=4){
        const x=KEYW+ss*state.zoom-state.sx;if(x<KEYW||x>state.W)continue;
        g.fillStyle=ss%16===0?'#bbb':'#666';g.fillRect(x,ss%16===0?4:12,1,RULER);
        if(ss%16===0){g.fillStyle='#aaa';g.fillText(ss/16+1,x+4,10);}
      }
      g.save();g.beginPath();g.rect(0,RULER,KEYW,state.H-RULER);g.clip();
      for(let pp=HI;pp>=LO;pp--){
        const y=RULER+(HI-pp)*RH-state.sy;if(y>state.H||y<RULER-RH)continue;
        g.fillStyle=isBlack(pp)?'#1d1d1d':'#e1e1e1';g.fillRect(0,y,isBlack(pp)?KEYW*.62:KEYW-1,RH-1);
        if(pp%12===0){g.fillStyle='#333';g.fillText('C'+(pp/12-1),KEYW-24,y+RH/2);}
      }
      g.restore();g.fillStyle='#292929';g.fillRect(0,0,KEYW,RULER);g.fillStyle='#414141';g.fillRect(KEYW-1,0,1,state.H);
    }
    const snap=()=>+modal.querySelector('[data-midi-snap]').value;
    const cell=e=>{const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;return{x,y,step:(x-KEYW+state.sx)/state.zoom,p:HI-Math.floor((y-RULER+state.sy)/RH)}};
    const hit=c=>{for(let i=state.notes.length-1;i>=0;i--){const n=state.notes[i];if(n.tr===state.cur&&n.p===c.p&&c.step>=n.t&&c.step<n.t+n.l)return n;}return null;};
    function audio(){if(!state.audio)state.audio=new (window.AudioContext||window.webkitAudioContext)();if(state.audio.state==='suspended')state.audio.resume();return state.audio;}
    function tone(p,t,d,wave,vol=.16){const a=audio(),o=a.createOscillator(),gn=a.createGain();o.type=wave;o.frequency.value=440*Math.pow(2,(p-69)/12);const start=Math.max(t,a.currentTime+0.005),dur=Math.max(0.02,d),level=Math.max(0.01,vol);gn.gain.setValueAtTime(0,start);gn.gain.linearRampToValueAtTime(level,start+0.008);gn.gain.setValueAtTime(level,start+Math.max(0.012,dur-0.02));gn.gain.linearRampToValueAtTime(0,start+dur);o.connect(gn).connect(a.destination);o.start(start);o.stop(start+dur+.02);state.oscillators.push(o);return o;}
    const preview=p=>tone(p,audio().currentTime,.2,state.tracks[state.cur]?.wave||'triangle');
    canvas.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();showMidiContextMenu(e.clientX,e.clientY);});
    function clearMidiSelection(){state.notes.forEach(n=>n.selected=false);state.noteAnchor=null;}
    function currentTrackNotes(){return state.notes.filter(n=>n.tr===state.cur).slice().sort((a,b)=>a.t-b.t||b.p-a.p);}
    function selectMidiNote(n,e){
      const list=currentTrackNotes();
      if(e.shiftKey&&state.noteAnchor){
        const a=list.indexOf(state.noteAnchor),b=list.indexOf(n);
        if(a>=0&&b>=0){
          const lo=Math.min(a,b),hi=Math.max(a,b);
          if(!e.ctrlKey&&!e.metaKey)clearMidiSelection();
          list.slice(lo,hi+1).forEach(x=>x.selected=true);
        }else{
          if(!e.ctrlKey&&!e.metaKey)clearMidiSelection();n.selected=true;
        }
      }else if(e.ctrlKey||e.metaKey){
        n.selected=!n.selected;
      }else{
        clearMidiSelection();n.selected=true;
      }
      state.noteAnchor=n;draw();
    }
    function selectedMidiNotes(){return state.notes.filter(n=>n.selected);}
    function noteSelectionBounds(notes){
      if(!notes.length)return null;
      return {minT:Math.min(...notes.map(n=>n.t)),maxP:Math.max(...notes.map(n=>n.p)),maxT:Math.max(...notes.map(n=>n.t+n.l)),minP:Math.min(...notes.map(n=>n.p))};
    }
    function copyMidi(){
      const s=selectedMidiNotes();if(!s.length)return status('Nothing selected to copy');
      const b=noteSelectionBounds(s);
      state.clipboard=s.map(n=>({dt:n.t-b.minT,dp:b.maxP-n.p,l:n.l,p:n.p,velocity:n.velocity}));
      state.pasteTarget={step:b.minT,p:b.maxP};
      status(`${s.length} MIDI note${s.length===1?'':'s'} copied`);draw();
    }
    function cutMidi(){
      const s=selectedMidiNotes();if(!s.length)return status('Nothing selected to cut');
      copyMidi();const before=beginHistory();state.notes=state.notes.filter(n=>!n.selected);clearMidiSelection();pushHistory(before);draw();
    }
    function addMidiNoteAt(c){
      const t=Math.max(0,Math.floor(c.step/snap())*snap());
      const p=Math.max(LO,Math.min(HI,Math.round(c.p)));
      const before=beginHistory();
      clearMidiSelection();
      const nn={t,l:+modal.querySelector('[data-midi-len]').value||2,p,tr:state.cur,velocity:100,selected:true};
      state.notes.push(nn);state.noteAnchor=nn;state.pasteTarget={step:t,p};pushHistory(before);preview(p);draw();
    }
    function pasteMidi(target){
      if(!state.clipboard.length)return status('Nothing to paste');
      const t=target||state.pasteTarget||{step:state.head||0,p:72};
      const baseT=Math.max(0,Math.floor(Math.max(0,t.step)/snap())*snap());
      const baseP=Math.max(LO,Math.min(HI,Math.round(t.p)));
      let pasted=state.clipboard.map(n=>({t:baseT+n.dt,l:n.l,p:baseP-n.dp,tr:state.cur,velocity:n.velocity||100,selected:true}));
      const minP=Math.min(...pasted.map(n=>n.p)),maxP=Math.max(...pasted.map(n=>n.p));
      let dp=0;if(minP<LO)dp=LO-minP;if(maxP+dp>HI)dp=HI-maxP;
      pasted=pasted.map(n=>({...n,p:n.p+dp}));
      const before=beginHistory();clearMidiSelection();state.notes.push(...pasted);state.noteAnchor=pasted.at(-1)||null;state.pasteTarget={step:baseT,p:baseP};pushHistory(before);draw();
      status(`${pasted.length} MIDI note${pasted.length===1?'':'s'} pasted at ${baseT}, ${baseP}`);
    }
    function duplicateMidi(){const s=selectedMidiNotes();if(!s.length)return status('Nothing selected to duplicate');copyMidi();const target={step:(noteSelectionBounds(s)?.maxT||0)+snap(),p:noteSelectionBounds(s)?.maxP||72};pasteMidi(target);}
    function deleteMidiNow(){const s=selectedMidiNotes();if(!s.length)return;const before=beginHistory();state.notes=state.notes.filter(n=>!n.selected);clearMidiSelection();pushHistory(before);draw();}
    function deleteMidi(){const s=selectedMidiNotes();if(!s.length)return status('Nothing selected');const count=s.length;const ask=window.UIXApp?.askConfirm;if(ask)ask('Delete MIDI Notes',`Delete ${count} selected MIDI note${count===1?'':'s'}?`,deleteMidiNow,'Delete');else if(confirm(`Delete ${count} selected MIDI note${count===1?'':'s'}?`))deleteMidiNow();}
    function midiSelectAll(){state.notes.filter(n=>n.tr===state.cur).forEach(n=>n.selected=true);state.noteAnchor=state.notes.find(n=>n.selected)||null;draw();}
    function midiDeselectAll(){clearMidiSelection();state.selectionBox=null;draw();}
    function selectInBox(rect,e,baseSelected){
      const cr=canvas.getBoundingClientRect(),x1=Math.min(rect.x1,rect.x2)-cr.left,x2=Math.max(rect.x1,rect.x2)-cr.left,y1=Math.min(rect.y1,rect.y2)-cr.top,y2=Math.max(rect.y1,rect.y2)-cr.top;
      const base=baseSelected||new Set();
      state.notes.filter(n=>n.tr===state.cur).forEach(n=>{
        const nx1=KEYW+n.t*state.zoom-state.sx,nx2=KEYW+(n.t+n.l)*state.zoom-state.sx;
        const ny1=RULER+(HI-n.p)*RH-state.sy,ny2=ny1+RH;
        const inside=nx1<=x2&&nx2>=x1&&ny1<=y2&&ny2>=y1;
        if(e.ctrlKey||e.metaKey)n.selected=base.has(n)?!inside:inside;
        else if(e.shiftKey)n.selected=base.has(n)||inside;
        else n.selected=inside;
      });
      state.noteAnchor=selectedMidiNotes().at(-1)||state.noteAnchor;draw();
    }
    function showMidiContextMenu(x,y){
      const target=state.pasteTarget||{step:state.head||0,p:72};
      window.UIXApp?.showContextMenu?.([
        {label:'Copy',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('copy','midi'),disabled:!selectedMidiNotes().length,action:copyMidi},
        {label:'Paste',icon:'▣',shortcut:window.UIXKeyBinds?.shortcutFor('paste','midi'),disabled:!state.clipboard.length,action:()=>pasteMidi(target)},
        {label:'Delete',icon:'×',shortcut:window.UIXKeyBinds?.shortcutFor('delete','midi'),disabled:!selectedMidiNotes().length,action:deleteMidi}
      ],x,y);
    }
    let drag=null;
    let longPressTimer=0,longPressPointer=null,longPressFired=false,longPressStart=null;
    const cancelMidiLongPress=()=>{if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=0;}longPressPointer=null;longPressStart=null;};
    canvas.addEventListener('contextmenu',e=>{if(longPressFired){e.preventDefault();e.stopPropagation();return;}const c=cell(e);if(c.x>=KEYW&&c.y>=RULER)state.pasteTarget={step:Math.max(0,c.step),p:Math.max(LO,Math.min(HI,c.p))};e.preventDefault();e.stopPropagation();showMidiContextMenu(e.clientX,e.clientY);});
    canvas.addEventListener('pointerdown',e=>{
      if(e.button===2){e.preventDefault();e.stopPropagation();const c=cell(e);state.pasteTarget={step:Math.max(0,c.step),p:Math.max(LO,Math.min(HI,c.p))};return;}
      longPressFired=false;cancelMidiLongPress();
      if(e.pointerType==='touch'){longPressStart={x:e.clientX,y:e.clientY};longPressPointer=e.pointerId;longPressTimer=setTimeout(()=>{longPressTimer=0;longPressFired=true;drag=null;state.selectionBox=null;const c=cell(e);state.pasteTarget={step:Math.max(0,c.step),p:Math.max(LO,Math.min(HI,c.p))};showMidiContextMenu(e.clientX,e.clientY);},550);}
      canvas.setPointerCapture?.(e.pointerId);
      const c=cell(e);state.pasteTarget={step:Math.max(0,c.step),p:Math.max(LO,Math.min(HI,c.p))};
      if(c.x<KEYW&&c.y>RULER){if(c.p>=LO&&c.p<=HI)preview(c.p);return;}
      if(c.y<RULER){const before=beginHistory();state.start=Math.max(0,Math.round(c.step));state.head=state.start;if(state.playing)play(true);if(!sameSnapshot(before,snapshot()))pushHistory(before);draw();return;}
      if(state.tool==='pan'||e.button===1){drag={k:'pan',x:e.clientX,y:e.clientY,sx:state.sx,sy:state.sy};return;}
      const n=hit(c);
      if(state.tool==='erase'){if(n){const ask=window.UIXApp?.askConfirm;const remove=()=>{const before=beginHistory();state.notes.splice(state.notes.indexOf(n),1);pushHistory(before);draw();};if(ask)ask('Delete MIDI Note',`Delete note ${NN[n.p%12]}${Math.floor(n.p/12)-1}?`,remove,'Delete');else if(confirm('Delete this MIDI note?'))remove();}return;}
      if(n){
        if(e.shiftKey||e.ctrlKey||e.metaKey)selectMidiNote(n,e);else if(!n.selected){clearMidiSelection();n.selected=true;state.noteAnchor=n;draw();}
        const edge=(n.t+n.l)*state.zoom-(c.step*state.zoom)<8;
        drag={k:edge?'resize':'move',n,off:c.step-n.t,changed:false,before:beginHistory(),startX:e.clientX,startY:e.clientY};
        preview(n.p);return;
      }
      drag={k:'pending',x:e.clientX,y:e.clientY,c0:c,changed:false,before:null,mod:e.shiftKey||e.ctrlKey||e.metaKey};
    });
    canvas.addEventListener('pointermove',e=>{
      if(longPressTimer&&longPressPointer===e.pointerId&&e.pointerType==='touch'){if(Math.hypot(e.clientX-(longPressStart?.x||e.clientX),e.clientY-(longPressStart?.y||e.clientY))>8)cancelMidiLongPress();}
      const c=cell(e);state.pasteTarget={step:Math.max(0,c.step),p:Math.max(LO,Math.min(HI,c.p))};
      if(!drag){status((c.p>=LO&&c.p<=HI?NN[c.p%12]+(Math.floor(c.p/12)-1)+' ('+c.p+') ':'')+'step '+Math.max(0,Math.floor(c.step))+' notes '+state.notes.length);draw();return;}
      if(drag.k==='pan'){state.sx=drag.sx-(e.clientX-drag.x);state.sy=drag.sy-(e.clientY-drag.y);view.clampView();draw();return;}
      if(drag.k==='pending'){
        const moved=Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4;
        if(moved){drag.k='marquee';drag.before=beginHistory();drag.baseSelected=new Set(selectedMidiNotes());drag.box={x1:drag.x,y1:drag.y,x2:e.clientX,y2:e.clientY};}
        else return;
      }
      if(drag.k==='marquee'){drag.box.x2=e.clientX;drag.box.y2=e.clientY;state.selectionBox={a:{x:drag.box.x1-canvas.getBoundingClientRect().left,y:drag.box.y1-canvas.getBoundingClientRect().top},b:{x:drag.box.x2-canvas.getBoundingClientRect().left,y:drag.box.y2-canvas.getBoundingClientRect().top}};selectInBox(drag.box,e,drag.baseSelected);return;}
      if(drag.k==='move'){
        const n=drag.n,nt=Math.max(0,Math.round((c.step-drag.off)/snap())*snap()),np=Math.max(LO,Math.min(HI,c.p));
        const dt=nt-n.t,dp=np-n.p;if(dt!==0||dp!==0)drag.changed=true;
        selectedMidiNotes().forEach(x=>{x.t=Math.max(0,x.t+dt);x.p=Math.max(LO,Math.min(HI,x.p+dp));});
        state.noteAnchor=n;draw();return;
      }
      if(drag.k==='resize'){
        const n=drag.n,nl=Math.max(1,Math.round((c.step-n.t)/snap())*snap()||1);if(nl!==n.l)drag.changed=true;n.l=nl;draw();return;
      }
      status((c.p>=LO&&c.p<=HI?NN[c.p%12]+(Math.floor(c.p/12)-1)+' ('+c.p+') ':'')+'step '+Math.max(0,Math.floor(c.step))+' notes '+state.notes.length);
    });
    canvas.addEventListener('pointerup',e=>{
      if(e.pointerType==='touch'){const fired=longPressFired;cancelMidiLongPress();longPressFired=false;if(fired){drag=null;state.selectionBox=null;draw();return;}}
      if(!drag)return;
      if(drag.k==='pending'){addMidiNoteAt(drag.c0);drag=null;return;}
      if(drag.k==='marquee'){
        const r=drag.box;selectInBox(r,e,drag.baseSelected);state.selectionBox=null;drag=null;updateHistoryUI();draw();return;
      }
      if(drag.before&&drag.changed)pushHistory(drag.before);
      drag=null;updateHistoryUI();draw();
    });
    canvas.addEventListener('pointercancel',()=>{cancelMidiLongPress();longPressFired=false;drag=null;state.selectionBox=null;updateHistoryUI();draw();});
    canvas.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey)state.zoom=Math.max(6,Math.min(80,state.zoom*(e.deltaY<0?1.1:.9)));else if(e.shiftKey)state.sx+=e.deltaY;else{state.sy+=e.deltaY;state.sx+=e.deltaX;}view.clampView();draw();},{passive:false});


    function stopOscs(){state.oscillators.forEach(o=>{try{o.stop();}catch{}});state.oscillators=[];}
    const stepSec=()=>60/(Number(modal.querySelector('[data-midi-bpm]').value)||120)/4;
    function clearScheduler(){if(state.playTimer){clearInterval(state.playTimer);state.playTimer=0;}state.scheduled.clear();}
    function stop(){state.playing=false;state.playToken++;clearScheduler();stopOscs();cancelAnimationFrame(state.raf);state.head=state.start;modal.querySelector('[data-midi-play]').innerHTML='▶ <span>Play</span>';modal.querySelector('[data-midi-play]').classList.remove('active');draw();}
    function play(restart){
      try {
        const a=audio();
        stopOscs();clearScheduler();cancelAnimationFrame(state.raf);
        const ss=stepSec(),from=restart?state.start:state.head,end=Math.max(...state.notes.map(n=>n.t+n.l),0);
        if(!state.notes.length){state.head=state.start;status('No notes to play');draw();return;}
        state.playing=true;state.fromStep=from;state.startedAt=a.currentTime-from*ss;
        const token=++state.playToken,lookAhead=.4,pollMs=40;
        const schedule=()=>{
          if(!state.playing||token!==state.playToken)return;
          const nowStep=Math.max(from,(a.currentTime-state.startedAt)/ss);
          const horizon=nowStep+lookAhead/ss;
          for(let i=0;i<state.notes.length;i++){
            const n=state.notes[i],key=i;
            if(state.scheduled.has(key)||n.t>horizon)continue;
            if(n.t+n.l<=from)continue;
            const st=Math.max(n.t,nowStep),dur=Math.max(.03,(n.l-(st-n.t))*ss),vel=.16*Math.max(.02,Math.min(1,(Number(n.velocity)||100)/127));
            tone(n.p,state.startedAt+st*ss,dur,state.tracks[n.tr]?.wave||'triangle',vel);state.scheduled.add(key);
          }
        };
        schedule();state.playTimer=setInterval(schedule,pollMs);
        modal.querySelector('[data-midi-play]').innerHTML='■ <span>Stop</span>';modal.querySelector('[data-midi-play]').classList.add('active');
        (function tick(){
          if(!state.playing||token!==state.playToken)return;
          state.head=(a.currentTime-state.startedAt)/ss;
          if(state.head>=end){if(state.loop){state.playing=false;clearScheduler();state.head=state.start;return play(true);}return stop();}
          const x=state.head*state.zoom-state.sx;if(x>state.W-KEYW-20)state.sx=state.head*state.zoom-40;draw();state.raf=requestAnimationFrame(tick);
        })();
      } catch(err) {state.playing=false;clearScheduler();window.UIXApp?.status?.('MIDI playback error: '+(err?.message||'Audio unavailable'));}
    }
    const bytes=()=>window.UIXMIDIParser.encode({ppq:state.ppq,bpm:Number(modal.querySelector('[data-midi-bpm]').value)||120,tracks:state.tracks.map((t,i)=>({name:t.name,channel:t.channel,notes:state.notes.filter(n=>n.tr===i)}))});
    function download(bytesData,name='song.mid'){const blob=new Blob([bytesData],{type:'audio/midi'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
    function save(){const name=state.name||'Song', data=window.UIXMIDIParser.bytesToDataURL(bytes()), existing=state.sourceAsset;const list=Assets.MIDI||(Assets.MIDI=[]);if(existing&&list.includes(existing)){existing.name=name;existing.filename=`${name}.mid`;existing.value=data;existing.type='audio/midi';existing.kind='MIDI';existing.editable=true;}else{let finalName=name,i=2;while(list.some(a=>a.name===finalName))finalName=`${name} ${i++}`;list.push({name:finalName,filename:`${finalName}.mid`,value:data,type:'audio/midi',kind:'MIDI',editable:true});}window.UIXApp?.refreshAssets?.();window.UIXApp?.status?.('MIDI saved');closeEditor();}
    function importFile(file){const reader=new FileReader();reader.onload=()=>{try{const song=window.UIXMIDIParser.parse(new Uint8Array(reader.result));stop();const nextNotes=[],nextTracks=[];const importedTracks=song.tracks.filter(track=>Array.isArray(track.notes)&&track.notes.length);importedTracks.forEach((track,i)=>{const index=nextTracks.length;nextTracks.push({name:track.name||`Track ${i+1}`,color:COLORS[index%COLORS.length],wave:'triangle',channel:track.channel??index%16});track.notes.forEach(n=>{nextNotes.push({t:Math.max(0,Math.round(n.tick*4/song.ppq)),l:Math.max(1,Math.round(n.duration*4/song.ppq)),p:Math.max(0,Math.min(127,Number(n.pitch)||0)),tr:index,velocity:Math.max(1,Math.min(127,Number(n.velocity)||100)),selected:false});});});const before=beginHistory();state.ppq=song.ppq||480;state.bpm=Math.round(song.bpm||120);state.notes=nextNotes;state.tracks=nextTracks.length?nextTracks:[{name:'Track 1',color:COLORS[0],wave:'triangle',channel:0}];pushHistory(before);state.cur=0;state.sx=0;state.sy=Math.max(0,Math.min((HI-72)*RH,Math.max(0,((HI-LO+1)*RH-state.H)*0.5)));modal.querySelector('[data-midi-bpm]').value=state.bpm;renderTracks();view.clampView();draw();state.name=safeName(file.name);modal.querySelector('[data-midi-name]').textContent=`${state.name}`;}catch{window.UIXApp?.status?.('Could not read MIDI file');}};reader.readAsArrayBuffer(file);}
    const midiNameEl=modal.querySelector('[data-midi-name]');
    midiNameEl.textContent=state.name;
    const beginMidiNameEdit=()=>{
      if(midiNameEl.contentEditable==='true')return;
      midiNameEl.contentEditable='true';
      midiNameEl.spellcheck=false;
      midiNameEl.classList.add('editing');
      midiNameEl.focus();
      const range=document.createRange();range.selectNodeContents(midiNameEl);
      const sel=window.getSelection();sel?.removeAllRanges();sel?.addRange(range);
    };
    const finishMidiNameEdit=commit=>{
      if(midiNameEl.contentEditable!=='true')return;
      const next=safeName(commit?midiNameEl.textContent:state.name);
      midiNameEl.contentEditable='false';
      midiNameEl.classList.remove('editing');
      state.name=next;
      midiNameEl.textContent=next;
    };
    midiNameEl.addEventListener('dblclick',e=>{e.stopPropagation();beginMidiNameEdit();});
    midiNameEl.addEventListener('keydown',e=>{
      if(midiNameEl.contentEditable!=='true')return;
      if(e.key==='Enter'){e.preventDefault();e.stopPropagation();finishMidiNameEdit(true);midiNameEl.blur();}
      else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finishMidiNameEdit(false);midiNameEl.blur();}
    });
    midiNameEl.addEventListener('blur',()=>finishMidiNameEdit(true));
    modal.querySelector('[data-midi-bpm]').addEventListener('change',e=>{const before=beginHistory(),next=clamp(Number(e.target.value)||120,30,300);if(next!==state.bpm){state.bpm=next;pushHistory(before);}});
    modal.querySelector('[data-midi-wave]').addEventListener('change',e=>{if(state.tracks[state.cur]&&state.tracks[state.cur].wave!==e.target.value){const before=beginHistory();state.tracks[state.cur].wave=e.target.value;pushHistory(before);}});
    modal.querySelector('[data-midi-add-track]').onclick=addTrack;
    modal.querySelector('[data-midi-loop]').onclick=e=>{state.loop=!state.loop;e.currentTarget.classList.toggle('active',state.loop);};
    modal.querySelector('[data-midi-clear]').onclick=()=>{if(confirm('Clear all notes?')){const before=beginHistory();if(state.notes.length){state.notes=[];state.noteAnchor=null;pushHistory(before);draw();}}};
    modal.querySelector('[data-midi-play]').onclick=()=>state.playing?stop():play(true);
    modal.querySelector('[data-midi-rew]').onclick=()=>{state.start=0;state.sx=0;if(state.playing)play(true);else{state.head=0;draw();}};
    modal.querySelectorAll('[data-midi-tool]').forEach(b=>b.onclick=()=>{state.tool=b.dataset.midiTool;modal.querySelectorAll('[data-midi-tool]').forEach(x=>x.classList.toggle('active',x===b));});
    modal.querySelector('[data-midi-export]').onclick=()=>download(bytes(),`${safeName(state.name)}.mid`);
    modal.querySelector('[data-midi-save]').onclick=save;
    modal.querySelector('[data-midi-import]').onclick=()=>{input=document.createElement('input');input.type='file';input.accept='.mid,.midi,audio/midi,audio/x-midi';input.onchange=e=>{const file=e.target.files?.[0];if(file)importFile(file);input=null;};input.click();};
    const confirmMidiCancel=()=>window.UIXApp?.askConfirm?.('Cancel MIDI Editing','Cancel MIDI editing? Any unsaved changes will be lost.',closeEditor,'Cancel Editing');
    modal.querySelector('[data-midi-cancel]').onclick=confirmMidiCancel;
    modal.querySelector('[data-midi-undo]').onclick=undo;
    modal.querySelector('[data-midi-redo]').onclick=redo;
    modal.tabIndex=0;modal.focus();
    activeShortcutHandler=command=>{
      switch(command){
        case'copy':copyMidi();break;case'cut':cutMidi();break;case'paste':pasteMidi();break;
        case'delete':deleteMidi();break;case'duplicate':duplicateMidi();break;case'selectAll':midiSelectAll();break;case'deselectAll':midiDeselectAll();break;
        case'undo':undo();break;case'redo':redo();break;case'saveMIDI':save();break;
        case'exportMIDI':download(bytes(),`${safeName(state.name)}.mid`);break;case'importMIDI':modal.querySelector('[data-midi-import]')?.click();break;
        case'play':state.playing?stop():play(true);break;case'stop':stop();break;case'escape':confirmMidiCancel();break;
        case'contextMenu':{const r=canvas.getBoundingClientRect();showMidiContextMenu(r.left+r.width/2,r.top+r.height/2);break;}
      }
    };
    renderTracks();resize();updateHistoryUI();
  }

  function closeEditor(){if(!modal){activeShortcutHandler=null;return;}const m=modal;modal=null;activeShortcutHandler=null;try{window.UIXApp?.closeModal?.(m);}catch{}m.remove();}

  function handleShortcut(command){return activeShortcutHandler?.(command);}
  window.UIXMIDIEditor = { openCreate, openEdit, close: closeEditor, handleShortcut };
})();
