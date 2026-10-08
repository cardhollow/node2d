(() => {
  'use strict';

  const { Assets } = window.UIXAssets;
  const KEYW = 76, RULER = 22, RH = 16;
  const COLORS = ['#e4ca4e','#6fb8e4','#e47f7f','#8fd18f','#c79be4','#e4a24e'];
  const NN = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const NOTE_TYPES = ['track','sine','triangle','square','sawtooth'];
  const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
  const MIDI_NOTE_LAYOUT_KEY = 'node2d.midi.customNotes.v2';
  const MIDI_NOTE_DEFS_KEY = 'node2d.midi.customNoteDefs.v1';
  const noteName = p => NN[(p % 12 + 12) % 12] + (Math.floor(p / 12) - 1);
  const midiFrequency = p => 440 * Math.pow(2, (validMidiPitch(p) - 69) / 12);
  const validMidiPitch = value => {
    const p = Math.round(Number(value));
    return Number.isFinite(p) ? clamp(p, 0, 127) : 60;
  };
  const defaultNoteLayout = () => {
    const out=[];
    for(let p=127;p>=0;p--) out.push(p);
    return out;
  };
  const normalizeNoteDef = (value, pitch) => {
    const p=validMidiPitch(pitch);
    const source=value&&typeof value==='object'?value:{};
    const frequency=Number(source.frequency);
    const amplitude=Number(source.amplitude);
    const type=NOTE_TYPES.includes(String(source.type))?String(source.type):'track';
    return {
      pitch:p,
      name:String(source.name ?? noteName(p)).trim() || noteName(p),
      frequency:Number.isFinite(frequency)&&frequency>0?frequency:midiFrequency(p),
      amplitude:Number.isFinite(amplitude)?clamp(amplitude,0,1):0.16,
      type
    };
  };
  const normalizeNoteLayout = values => {
    const seen=new Set(),out=[];
    for(const value of Array.isArray(values)?values:[]){
      const p=Math.round(Number(value));
      if(!Number.isFinite(p)||p<0||p>127||seen.has(p))continue;
      seen.add(p);out.push(p);
    }
    return out.length?out:defaultNoteLayout();
  };
  const loadNoteLayout = () => {
    try { return normalizeNoteLayout(JSON.parse(localStorage.getItem(MIDI_NOTE_LAYOUT_KEY)||'null')); }
    catch { return defaultNoteLayout(); }
  };
  const saveNoteLayout = layout => {
    try { localStorage.setItem(MIDI_NOTE_LAYOUT_KEY,JSON.stringify(normalizeNoteLayout(layout))); } catch {}
  };
  const loadNoteDefs = () => {
    try {
      const raw=JSON.parse(localStorage.getItem(MIDI_NOTE_DEFS_KEY)||'null');
      return raw&&typeof raw==='object'?raw:{};
    } catch { return {}; }
  };
  const saveNoteDefs = defs => {
    try { localStorage.setItem(MIDI_NOTE_DEFS_KEY,JSON.stringify(defs||{})); } catch {}
  };
  const cloneNoteDefs = defs => {
    const out={};
    for(const [k,v] of Object.entries(defs&&typeof defs==='object'?defs:{})) out[k]={...v};
    return out;
  };
  const ensureNoteDefs = (defs,pitches) => {
    const out=defs&&typeof defs==='object'?defs:{};
    for(const value of pitches||[]){
      const p=validMidiPitch(value);
      const key=String(p);
      out[key]=normalizeNoteDef(out[key],p);
    }
    return out;
  };
  const ensureNotePitches = (layout,pitches) => {
    const out=normalizeNoteLayout(layout);
    for(const value of pitches||[]){
      const p=validMidiPitch(value);
      if(out.includes(p))continue;
      let inserted=false;
      for(let i=0;i<out.length;i++){
        if(p>out[i]){out.splice(i,0,p);inserted=true;break;}
      }
      if(!inserted)out.push(p);
    }
    return out;
  };
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
    const refreshRows = () => {
      state.noteLayout = normalizeNoteLayout(state.noteLayout);
      state.noteRowByPitch = new Map(state.noteLayout.map((p,i)=>[p,i]));
    };
    const rowForPitch = p => state.noteRowByPitch.get(validMidiPitch(p));
    const clampView = () => {
      refreshRows();
      const h = state.H, w = state.W;
      const maxY = state.noteLayout.length * RH - (h - RULER);
      state.sy = Math.max(0, Math.min(state.sy, Math.max(0, maxY)));
      state.sx = Math.max(0, Math.min(state.sx, Math.max(0, total() * state.zoom - (w - KEYW) + 80)));
    };
    refreshRows();
    return { total, clampView, refreshRows, rowForPitch };
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
    const notes = [], tracks = [], importedPitches = [];
    const importedTracks = song.tracks.filter(track => Array.isArray(track.notes) && track.notes.length);
    importedTracks.forEach((track, i) => {
      const index = tracks.length;
      tracks.push({ name: track.name || `Track ${i + 1}`, color: COLORS[index % COLORS.length], wave: 'triangle', channel: track.channel ?? index % 16 });
      track.notes.forEach(n => {
        importedPitches.push(validMidiPitch(n.pitch));
        notes.push({
          t: Math.max(0, Math.round(n.tick * 4 / song.ppq)),
          l: Math.max(1, Math.round(n.duration * 4 / song.ppq)),
          p: validMidiPitch(n.pitch),
          tr: index,
          velocity: 100,
          selected: false
        });
      });
    });
    const layout=ensureNotePitches(loadNoteLayout(), importedPitches);
    const noteDefs=ensureNoteDefs(loadNoteDefs(), importedPitches);
    saveNoteLayout(layout);saveNoteDefs(noteDefs);
    openEditor({ name: safeName(sourceAsset?.name || 'Song'), bpm: Math.round(song.bpm || 120), ppq: song.ppq || 480, sourceAsset, tracks: tracks.length ? tracks : [{name:'Track 1',color:COLORS[0],wave:'triangle',channel:0}], notes, noteLayout: layout, noteDefs });
  }

  function openCustomNotesEditor(state, refresh) {
    const modal2=document.createElement('section');
    modal2.className='modal uix-midi-notes-modal';
    modal2.innerHTML=`
      <div class="uix-midi-notes-header">
        <div><strong>Customize Notes</strong><small>Add, edit, remove, and arrange the notes available to the editor.</small></div>
        <button class="btn" data-notes-close type="button">Done</button>
      </div>
      <div class="uix-midi-notes-toolbar">
        <button class="btn primary" data-note-add-btn type="button">+ Add Note</button>
        <button class="btn" data-note-reset type="button">Reset Default</button>
        <span data-note-count></span>
      </div>
      <div class="uix-midi-notes-editor" data-note-editor hidden>
        <div class="uix-midi-note-editor-title"><span data-note-editor-mode>Add Note</span> <span data-note-editor-pitch></span></div>
        <div class="uix-midi-note-fields">
          <label>Note / Name<input data-note-name type="text" autocomplete="off"></label>
          <label>MIDI<input data-note-pitch type="number" min="0" max="127"></label>
          <label>Frequency (Hz)<input data-note-frequency type="number" min="0.01" step="0.01"></label>
          <label>Amplitude<input data-note-amplitude type="number" min="0" max="1" step="0.01"></label>
          <label>Type<select data-note-type><option value="track">Use Track Wave</option><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="square">Square</option><option value="sawtooth">Sawtooth</option></select></label>
        </div>
        <div class="uix-midi-note-editor-actions">
          <button class="btn" data-note-cancel-editor type="button">Cancel</button>
          <button class="btn primary" data-note-done-editor type="button">Done</button>
          <button class="btn danger" data-note-delete type="button">Remove Note</button>
        </div>
      </div>
      <div class="uix-midi-notes-list" data-note-list></div>`;
    document.body.append(modal2);
    window.UIXApp?.showModal?.(modal2);
    const list=modal2.querySelector('[data-note-list]');
    const editor=modal2.querySelector('[data-note-editor]');
    let selectedPitch=state.noteLayout[0]??60;
    let editMode='edit';
    let editPitch=selectedPitch;
    const close=()=>{try{window.UIXApp?.closeModal?.(modal2);}catch{}modal2.remove();};
    const persist=()=>{state.noteLayout=normalizeNoteLayout(state.noteLayout);state.noteDefs=ensureNoteDefs(state.noteDefs||{},state.noteLayout);saveNoteLayout(state.noteLayout);saveNoteDefs(state.noteDefs);refresh();};
    const setEditor=(mode,p)=>{
      editMode=mode;editPitch=validMidiPitch(p);selectedPitch=editPitch;editor.hidden=false;
      modal2.querySelector('[data-note-editor-mode]').textContent=mode==='add'?'Add Note':'Edit Note';
      const d=normalizeNoteDef((state.noteDefs||{})[String(editPitch)],editPitch);
      modal2.querySelector('[data-note-editor-pitch]').textContent=`MIDI ${editPitch}`;
      modal2.querySelector('[data-note-name]').value=d.name;
      modal2.querySelector('[data-note-pitch]').value=editPitch;
      modal2.querySelector('[data-note-frequency]').value=d.frequency;
      modal2.querySelector('[data-note-amplitude]').value=d.amplitude;
      modal2.querySelector('[data-note-type]').value=d.type;
      modal2.querySelector('[data-note-delete]').hidden=mode==='add';
    };
    const finishEditor=()=>{
      const oldPitch=editPitch;
      const newPitch=validMidiPitch(modal2.querySelector('[data-note-pitch]').value);
      const base=normalizeNoteDef((state.noteDefs||{})[String(oldPitch)],oldPitch);
      const next={
        pitch:newPitch,
        name:String(modal2.querySelector('[data-note-name]').value||noteName(newPitch)).trim()||noteName(newPitch),
        frequency:Math.max(0.01,Number(modal2.querySelector('[data-note-frequency]').value)||midiFrequency(newPitch)),
        amplitude:clamp(Number(modal2.querySelector('[data-note-amplitude]').value)||0,0,1),
        type:NOTE_TYPES.includes(modal2.querySelector('[data-note-type]').value)?modal2.querySelector('[data-note-type]').value:'track'
      };
      if(editMode==='add'){
        if(state.noteLayout.includes(newPitch)){window.UIXApp?.status?.('That MIDI note is already in the layout');return;}
        state.noteLayout=ensureNotePitches(state.noteLayout,[newPitch]);
        state.noteDefs[String(newPitch)]=normalizeNoteDef(next,newPitch);
        selectedPitch=newPitch;persist();editor.hidden=true;render();return;
      }
      if(newPitch!==oldPitch && state.noteLayout.includes(newPitch)){window.UIXApp?.status?.('That MIDI note is already in the layout');return;}
      if(newPitch!==oldPitch){
        const i=state.noteLayout.indexOf(oldPitch);if(i>=0)state.noteLayout[i]=newPitch;
        state.notes.forEach(n=>{if(n.p===oldPitch)n.p=newPitch;});
        delete state.noteDefs[String(oldPitch)];
      }
      state.noteDefs[String(newPitch)]=normalizeNoteDef({...base,...next},newPitch);
      selectedPitch=newPitch;persist();editor.hidden=true;render();
    };
    const cancelEditor=()=>{editor.hidden=true;render();};
    const removeCurrent=()=>{
      const p=editPitch,i=state.noteLayout.indexOf(p);
      if(i<0||state.noteLayout.length<=1)return;
      state.noteLayout.splice(i,1);delete state.noteDefs[String(p)];
      persist();editor.hidden=true;selectedPitch=state.noteLayout[Math.min(i,state.noteLayout.length-1)]??60;render();
    };
    const render=()=>{
      state.noteLayout=normalizeNoteLayout(state.noteLayout);state.noteDefs=ensureNoteDefs(state.noteDefs||{},state.noteLayout);
      list.innerHTML='';modal2.querySelector('[data-note-count]').textContent=`${state.noteLayout.length} notes`;
      state.noteLayout.forEach((p,i)=>{
        const d=state.noteDefs[String(p)]||normalizeNoteDef(null,p);
        const row=document.createElement('div');row.className='uix-midi-note-row'+(p===selectedPitch?' selected':'');row.draggable=true;row.dataset.pitch=p;
        row.innerHTML=`<div class="uix-midi-note-key"></div><div class="uix-midi-note-info"><strong></strong><span></span></div><button class="btn" data-edit type="button">Edit</button><button class="btn" data-up type="button">↑</button><button class="btn" data-down type="button">↓</button><button class="btn danger" data-remove type="button">×</button>`;
        row.querySelector('.uix-midi-note-key').textContent=d.name;
        row.querySelector('.uix-midi-note-info strong').textContent=`MIDI ${p} · ${Number(d.frequency).toFixed(2)} Hz`;
        row.querySelector('.uix-midi-note-info span').textContent=`Amplitude ${Number(d.amplitude).toFixed(2)} · ${d.type}`;
        row.querySelector('[data-up]').disabled=i===0;row.querySelector('[data-down]').disabled=i===state.noteLayout.length-1;
        row.onclick=e=>{if(e.target.closest('button'))return;selectedPitch=p;render();};
        row.querySelector('[data-edit]').onclick=e=>{e.stopPropagation();setEditor('edit',p);render();};
        row.querySelector('[data-up]').onclick=e=>{e.stopPropagation();const v=state.noteLayout[i];state.noteLayout.splice(i,1);state.noteLayout.splice(i-1,0,v);persist();render();};
        row.querySelector('[data-down]').onclick=e=>{e.stopPropagation();const v=state.noteLayout[i];state.noteLayout.splice(i,1);state.noteLayout.splice(i+1,0,v);persist();render();};
        row.querySelector('[data-remove]').onclick=e=>{e.stopPropagation();if(state.noteLayout.length<=1)return;state.noteLayout.splice(i,1);delete state.noteDefs[String(p)];persist();if(editPitch===p)editor.hidden=true;render();};
        row.addEventListener('dragstart',e=>{e.dataTransfer?.setData('text/plain',String(p));row.dataset.dragPitch=String(p);});
        row.addEventListener('dragover',e=>e.preventDefault());
        row.addEventListener('drop',e=>{e.preventDefault();const from=state.noteLayout.indexOf(p);const raw=e.dataTransfer?.getData('text/plain')||row.dataset.dragPitch;const source=validMidiPitch(raw);const a=state.noteLayout.indexOf(source);if(a<0||from<0||a===from)return;state.noteLayout.splice(a,1);state.noteLayout.splice(from,0,source);persist();render();});
        list.append(row);
      });
    };
    modal2.querySelector('[data-note-add-btn]').onclick=()=>{let p=60;for(let d=0;d<128&&state.noteLayout.includes(p);d++)p=(60+d)%128;if(state.noteLayout.includes(p)){for(p=0;p<128&&state.noteLayout.includes(p);p++);}if(p>127)return;setEditor('add',p);render();};
    modal2.querySelector('[data-note-reset]').onclick=()=>{state.noteLayout=defaultNoteLayout();state.noteDefs=ensureNoteDefs({},state.noteLayout);persist();selectedPitch=60;editor.hidden=true;render();};
    modal2.querySelector('[data-note-done-editor]').onclick=finishEditor;
    modal2.querySelector('[data-note-cancel-editor]').onclick=cancelEditor;
    modal2.querySelector('[data-note-delete]').onclick=removeCurrent;
    modal2.querySelector('[data-notes-close]').onclick=close;
    render();
  }


  function openRecordNoteModal(mainState, seedNotes=null, editMode=false){
    const modal3=document.createElement('section');
    modal3.className='modal uix-midi-record-modal';
    const layout=normalizeNoteLayout(mainState.noteLayout||loadNoteLayout());
    const notesSeed=Array.isArray(seedNotes)?seedNotes.map(n=>({...n,selected:false})):[];
    const initialCount=notesSeed.length;
    const rs={
      notes:notesSeed,selected:new Set(),playing:false,recording:false,raf:0,playToken:0,playSources:new Set(),
      rangeStart:layout[Math.max(0,layout.length-1)]??60,rangeEnd:layout[0]??72,
      threshold:.045,minMs:90,tolerance:70,wave:mainState.tracks?.[mainState.cur]?.wave||'triangle',
      audio:null,analyser:null,mic:null,buffer:null,freqBuffer:null,recordTimer:0,lastPitch:null,lastPitchAt:0,lastRms:0,lastOnsetAt:-Infinity,pitchHistory:[],pitchConfidence:0,pendingPitch:null,pendingSince:0,
      currentStart:null,recordStartAt:0,recordStartStep:Math.max(0,Number(mainState.head)||0),changed:false,head:Math.max(0,Number(mainState.head)||0)
    };
    const pitchRows=[...layout];
    modal3.innerHTML=`
      <div class="uix-midi-record-head">
        <div><strong>RECORD NOTE</strong><small>${editMode?'Edit the selected notes using microphone/reference input.':'Record a new melody into an empty note stage.'}</small></div>
        <div class="uix-midi-record-head-actions"><button class="btn" data-rec-record>● Start Record</button><button class="btn" data-rec-play>▶ Play</button></div>
      </div>
      <div class="uix-midi-record-controls">
        <label>Start Note<select data-rec-start>${pitchRows.map(p=>`<option value="${p}">${noteName(p)} (${p})</option>`).join('')}</select></label>
        <label>End Note<select data-rec-end>${pitchRows.map(p=>`<option value="${p}">${noteName(p)} (${p})</option>`).join('')}</select></label>
        <label>Threshold<input data-rec-threshold type="number" min="0.001" max="1" step="0.001" value="0.008"></label>
        <label>Min Note (ms)<input data-rec-min type="number" min="30" max="1000" value="80"></label>
        <label>Tolerance (cents)<input data-rec-tolerance type="number" min="1" max="300" value="90"></label>
        <label>Onset Sensitivity<input data-rec-onset type="number" min="0.01" max="2" step="0.01" value="0.18"></label>
        <label>Input<select data-rec-mode><option value="auto">Voice + Whistle + Tap</option><option value="pitched">Voice + Whistle</option><option value="tap">Tap / Percussive</option></select></label>
        <label>Wave<select data-rec-wave><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="square">Square</option><option value="sawtooth">Sawtooth</option></select></label>
      </div>
      <div class="uix-midi-record-body">
        <aside class="uix-midi-record-tools"><button class="btn" data-rec-select-all>Select All</button><button class="btn" data-rec-clear-selection>Clear Selection</button><div class="uix-midi-record-hint">Tap notes to select. Use the context menu for Copy, Paste, Paste Origin, Delete, and Select All.</div></aside>
        <div class="uix-midi-record-stage"><canvas data-rec-canvas></canvas><div class="uix-midi-record-status" data-rec-status></div></div>
      </div>
      <div class="uix-midi-record-foot"><span data-rec-message></span><button class="btn primary" data-rec-copy>Copy</button><button class="btn" data-rec-cancel>Cancel</button></div>`;
    document.body.append(modal3);window.UIXApp?.showModal?.(modal3);
    const c=modal3.querySelector('[data-rec-canvas]'),g=c.getContext('2d'),host=modal3.querySelector('[data-rec-status]');
    modal3.querySelector('[data-rec-start]').value=String(rs.rangeStart);modal3.querySelector('[data-rec-end]').value=String(rs.rangeEnd);
    const orderedRange=()=>{const a=validMidiPitch(modal3.querySelector('[data-rec-start]').value),b=validMidiPitch(modal3.querySelector('[data-rec-end]').value);return [Math.min(a,b),Math.max(a,b)];};
    const inRange=p=>{const [lo,hi]=orderedRange();return p>=lo&&p<=hi;};
    let W=0,H=0,dpr=1,sx=0,sy=0,zoom=Math.max(14,Number(mainState.zoom)||22),drag=null,box=null;const active=new Map();let two=null;
    const rowH=16,rowFor=p=>layout.indexOf(validMidiPitch(p));
    const total=()=>{let m=64;for(const n of rs.notes)m=Math.max(m,n.t+n.l);return Math.max(64,Math.ceil((m+17)/16)*16);};
    const clampRecordView=()=>{const maxT=total(),maxX=Math.max(0,maxT*zoom-(W-KEYW)),maxY=Math.max(0,layout.length*rowH-(H-RULER));sx=Math.max(0,Math.min(sx,maxX));sy=Math.max(0,Math.min(sy,maxY));};
    const followPosition=(step,p)=>{const rp=rowFor(p),targetX=KEYW+step*zoom-sx,targetY=RULER+(rp<0?Math.floor(layout.length/2):rp)*rowH-sy;if(targetX>W-40)sx=step*zoom-W+KEYW+40;else if(targetX<KEYW+20)sx=Math.max(0,step*zoom-20);if(rp>=0){if(targetY>H-rowH*2)sy=Math.max(0,rp*rowH-(H-RULER)+rowH*2);else if(targetY<RULER+rowH)sy=Math.max(0,rp*rowH);}clampRecordView();};
    const resize=()=>{const r=c.parentElement.getBoundingClientRect();W=r.width;H=r.height;dpr=window.devicePixelRatio||1;c.width=W*dpr;c.height=H*dpr;clampRecordView();draw();};
    const autoPan=()=>followPosition(rs.head,rs.lastPitch==null?layout[Math.floor(layout.length/2)]??60:rs.lastPitch);
    const draw=()=>{
      g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle='#202020';g.fillRect(0,0,W,H);
      g.fillStyle='#292929';g.fillRect(0,0,W,RULER);g.strokeStyle='#424242';g.beginPath();for(let ss=0;ss<=total();ss+=4){const x=KEYW+ss*zoom-sx; if(x>=KEYW&&x<=W){g.moveTo(x,RULER);g.lineTo(x,0);if(ss%16===0){g.fillStyle='#9a9a9a';g.font='8px system-ui';g.textBaseline='top';g.fillText(String(ss),x+3,3);g.fillStyle='#292929';}}}g.stroke();
      const [lo,hi]=orderedRange();
      g.save();g.beginPath();g.rect(KEYW,0,W-KEYW,H);g.clip();
      for(let i=0;i<layout.length;i++){const p=layout[i],y=RULER+i*rowH-sy;if(y>H||y+rowH<RULER)continue;g.fillStyle=p>=lo&&p<=hi?'#2a2a2a':'#181818';g.fillRect(KEYW,y,W-KEYW,rowH-1);g.fillStyle='#333';g.fillRect(KEYW,y+rowH-1,W-KEYW,1);}
      for(let ss=0;ss<=total();ss+=4){const x=KEYW+ss*zoom-sx;if(x<KEYW||x>W)continue;g.fillStyle=ss%16===0?'#505050':'#303030';g.fillRect(x,RULER,1,H-RULER);}
      for(let i=0;i<rs.notes.length;i++){const n=rs.notes[i],r=rowFor(n.p);if(r<0)continue;const x=KEYW+n.t*zoom-sx,y=RULER+r*rowH-sy,w=Math.max(4,n.l*zoom-2),sel=rs.selected.has(i),disabled=!inRange(n.p),playing=rs.playing&&rs.head>=n.t&&rs.head<n.t+n.l;if(x+w<KEYW||x>W||y+rowH<RULER||y>H)continue;g.globalAlpha=disabled?.25:1;const col=mainState.tracks?.[n.tr]?.color||COLORS[(Number(n.tr)||0)%COLORS.length];g.fillStyle=sel?'#e4ca4e':col;if(playing){g.save();g.shadowColor=col;g.shadowBlur=10;g.fillRect(x+1,y+1,w,rowH-2);g.restore();}else g.fillRect(x+1,y+1,w,rowH-2);g.globalAlpha=1;}
      if(box){const x=Math.min(box.x1,box.x2),y=Math.min(box.y1,box.y2),w=Math.abs(box.x2-box.x1),h=Math.abs(box.y2-box.y1);g.fillStyle='rgba(228,202,78,.08)';g.fillRect(x,y,w,h);g.strokeStyle='#e4ca4e';g.strokeRect(x+.5,y+.5,w,h);}
      const hx=KEYW+rs.head*zoom-sx;g.fillStyle='#e4ca4e';g.fillRect(hx,RULER,1.5,H-RULER);g.restore();
      g.fillStyle='#222';g.fillRect(0,0,KEYW,H);
      for(let i=0;i<layout.length;i++){const p=layout[i],y=RULER+i*rowH-sy;if(y>H||y+rowH<RULER)continue;const disabled=!inRange(p),playing=rs.playing&&rs.notes.some(n=>n.p===p&&rs.head>=n.t&&rs.head<n.t+n.l);g.fillStyle=playing?'#050505':(disabled?'#080808':'#e7e7e7');g.fillRect(0,y,KEYW-1,rowH-1);g.fillStyle=playing||disabled?'#fff':(isBlack(p)?'#666':'#222');g.fillText(noteName(p),4,y+rowH/2);}
      g.fillStyle='#292929';g.fillRect(0,0,KEYW,RULER);
      host.textContent=rs.recording?'Listening…':rs.playing?'Playing…':'';
    };
    const hit=(x,y)=>{const step=(x-KEYW+sx)/zoom,row=Math.floor((y-RULER+sy)/rowH),p=layout[row];if(p===undefined)return null;for(let i=rs.notes.length-1;i>=0;i--){const n=rs.notes[i];if(n.p===p&&step>=n.t&&step<n.t+n.l)return i;}return null;};
    const snapshot=()=>rs.notes.map(n=>({...n}));
    function recAudio(){
      const AudioContextCtor=window.AudioContext||window.webkitAudioContext;
      if(!AudioContextCtor)throw new Error('Web Audio is unavailable');
      if(!rs.audio || rs.audio.state==='closed')rs.audio=new AudioContextCtor({latencyHint:'interactive'});
      return rs.audio;
    }
    function recTone(n,a,t,d){
      const p=validMidiPitch(n.p),def=mainState.noteDefs?.[String(p)]||normalizeNoteDef(null,p),wave=rs.wave==='track'?(mainState.tracks?.[n.tr]?.wave||'triangle'):rs.wave;
      const o=a.createOscillator(),gain=a.createGain();
      o.type=NOTE_TYPES.includes(wave)?wave:'triangle';
      o.frequency.value=Number(def.frequency)||midiFrequency(p);
      const st=Math.max(t,a.currentTime+.01),dur=Math.max(.03,d),amp=clamp(Number(def.amplitude)||.16,0,1);
      gain.gain.setValueAtTime(0,st);
      gain.gain.linearRampToValueAtTime(amp,st+.008);
      gain.gain.setValueAtTime(amp,st+Math.max(.012,dur-.02));
      gain.gain.linearRampToValueAtTime(0,st+dur);
      o.connect(gain).connect(a.destination);
      o.start(st);o.stop(st+dur+.03);
      const source={o,gain};
      rs.playSources.add(source);
      const cleanup=()=>{rs.playSources.delete(source);try{o.disconnect();}catch{}try{gain.disconnect();}catch{}};
      o.addEventListener('ended',cleanup,{once:true});
      return source;
    }
    const stopRecordPlayback=()=>{
      rs.playing=false;rs.playToken++;cancelAnimationFrame(rs.raf);rs.raf=0;
      for(const source of rs.playSources){try{source.o.stop();}catch{}try{source.o.disconnect();}catch{}try{source.gain.disconnect();}catch{}}
      rs.playSources.clear();
      modal3.querySelector('[data-rec-play]').textContent='▶ Play';
    };
    const recordPlay=async()=>{
      if(rs.playing){stopRecordPlayback();draw();return;}
      if(!rs.notes.length)return;
      const a=recAudio();
      try{if(a.state==='suspended'||a.state==='interrupted')await a.resume();}catch{}
      if(rs.playing)return;
      const ss=60/(Number(mainState.bpm)||120)/4;
      let start=Infinity,end=0;
      for(const n of rs.notes){start=Math.min(start,n.t);end=Math.max(end,n.t+n.l);}
      if(!Number.isFinite(start))return;
      const token=++rs.playToken;
      rs.playing=true;rs.head=start;
      modal3.querySelector('[data-rec-play]').textContent='■ Stop';
      const started=a.currentTime+.03;
      for(const n of rs.notes){
        const when=started+Math.max(0,n.t-start)*ss;
        recTone(n,a,when,n.l*ss);
      }
      const tick=()=>{
        if(!rs.playing||token!==rs.playToken)return;
        rs.head=start+(a.currentTime-started)/ss;
        let followPitch=null;
        for(const n of rs.notes){if(rs.head>=n.t&&rs.head<n.t+n.l){followPitch=n.p;break;}}
        followPosition(rs.head,followPitch==null?layout[Math.floor(layout.length/2)]??60:followPitch);
        draw();
        if(rs.head>=end+.25/ss){stopRecordPlayback();rs.head=end;draw();return;}
        rs.raf=requestAnimationFrame(tick);
      };
      tick();
    };
    const detectorSettings=()=>({
      threshold:clamp(Number(modal3.querySelector('[data-rec-threshold]')?.value)||.025,.001,1),
      minMs:Math.max(30,Number(modal3.querySelector('[data-rec-min]')?.value)||90),
      tolerance:Math.max(1,Number(modal3.querySelector('[data-rec-tolerance]')?.value)||70),
      onset:clamp(Number(modal3.querySelector('[data-rec-onset]')?.value)||.18,.01,2),
      mode:String(modal3.querySelector('[data-rec-mode]')?.value||'auto')
    });
    const pitchFromFreq=(hz)=>{
      if(!Number.isFinite(hz)||hz<40||hz>5000)return null;
      const [lo,hi]=orderedRange();
      let bestP=null,bestC=Infinity;
      for(const p of layout){
        if(p<lo||p>hi)continue;
        const def=mainState.noteDefs?.[String(p)]||normalizeNoteDef(null,p);
        const cents=Math.abs(1200*Math.log2(hz/Math.max(.01,Number(def.frequency)||midiFrequency(p))));
        if(cents<bestC){bestC=cents;bestP=p;}
      }
      return bestP==null||bestC>detectorSettings().tolerance?null:bestP;
    };
    const spectralPeak=(freqBuf,sr)=>{
      if(!freqBuf||!freqBuf.length)return null;
      let best=-Infinity,bestI=-1;
      const nyq=sr/2,binHz=nyq/freqBuf.length;
      const loI=Math.max(1,Math.floor(45/binHz)),hiI=Math.min(freqBuf.length-2,Math.ceil(5000/binHz));
      for(let i=loI;i<=hiI;i++){const db=freqBuf[i];if(db>best){best=db;bestI=i;}}
      if(bestI<0||!Number.isFinite(best))return null;
      const a=Math.pow(10,(freqBuf[bestI-1]||best)/20),b=Math.pow(10,best/20),c=Math.pow(10,(freqBuf[bestI+1]||best)/20);
      const den=a-2*b+c;
      const delta=Math.abs(den)>1e-9?clamp(.5*(a-c)/den,-.5,.5):0;
      return (bestI+delta)*binHz;
    };
    const yinPitch=(buf,sr)=>{
      const n=buf.length;
      if(n<1024)return {pitch:null,rms:0,frequency:null,confidence:0};
      const cfg=detectorSettings();
      let mean=0;for(let i=0;i<n;i++)mean+=buf[i];mean/=n;
      const ds=2, m=Math.floor(n/ds), x=new Float32Array(m);let energy=0;
      for(let i=0;i<m;i++){const v=buf[i*ds]-mean;x[i]=v;energy+=v*v;}
      const rms=Math.sqrt(energy/m);
      if(rms<cfg.threshold)return {pitch:null,rms,confidence:0};
      const sr2=sr/ds,minHz=55,maxHz=4200;
      const minTau=Math.max(2,Math.floor(sr2/maxHz)),maxTau=Math.min(Math.floor(sr2/minHz),Math.floor(m/2));
      if(maxTau<=minTau+4)return {pitch:null,rms,confidence:0};
      const diff=new Float32Array(maxTau+1),cmnd=new Float32Array(maxTau+1);
      let running=0;
      for(let tau=1;tau<=maxTau;tau++){
        let sum=0;
        const lim=m-tau;
        for(let i=0;i<lim;i++){const d=x[i]-x[i+tau];sum+=d*d;}
        diff[tau]=sum;running+=sum;cmnd[tau]=running>1e-12?(sum*tau)/running:1;
      }
      const yinThreshold=.28;
      let tau=-1;
      for(let t=minTau;t<maxTau-1;t++){
        if(cmnd[t]<yinThreshold){while(t+1<maxTau&&cmnd[t+1]<cmnd[t])t++;tau=t;break;}
      }
      if(tau<0){let best=Infinity;for(let t=minTau;t<maxTau;t++){if(cmnd[t]<best){best=cmnd[t];tau=t;}}}
      if(tau<1)return {pitch:null,rms,confidence:0};
      const y1=cmnd[tau-1],y2=cmnd[tau],y3=cmnd[Math.min(maxTau,tau+1)],den=y1-2*y2+y3;
      const shift=Math.abs(den)>1e-9?clamp(.5*(y1-y3)/den,-.5,.5):0;
      const frequency=sr2/(tau+shift),confidence=clamp(1-cmnd[tau],0,1);
      if(!Number.isFinite(frequency)||frequency<minHz||frequency>maxHz||confidence<.15)return {pitch:null,rms,frequency,confidence};
      return {pitch:pitchFromFreq(frequency),rms,frequency,confidence};
    };
    const detectAudio=(buf,sr,freqBuf)=>{
      const cfg=detectorSettings();
      const result=yinPitch(buf,sr);
      const now=performance.now();
      const rms=result?.rms||0;
      const rise=rms-Math.max(0,rs.lastRms);
      const onset=Math.max(rise,0)/(Math.max(rs.lastRms,.004));
      const strongOnset=onset>=cfg.onset&&now-rs.lastOnsetAt>=cfg.minMs*.45;
      let pitch=result?.pitch??null;
      let confidence=result?.confidence||0;
      if(pitch!=null){
        rs.pitchHistory.push({p:pitch,c:confidence});
        if(rs.pitchHistory.length>7)rs.pitchHistory.shift();
        const votes=new Map();
        for(const h of rs.pitchHistory){const w=Math.max(.1,h.c);votes.set(h.p,(votes.get(h.p)||0)+w);}
        let stable=pitch,score=-1;for(const [pp,sc] of votes){if(sc>score){score=sc;stable=pp;}}
        pitch=stable;rs.pitchConfidence=confidence;
      }else if((cfg.mode==='auto'||cfg.mode==='pitched'||cfg.mode==='tap')&&(strongOnset||rms>=cfg.threshold*1.8)){
        const peakHz=spectralPeak(freqBuf,sr);
        const fallback=pitchFromFreq(peakHz);
        if(fallback!=null){pitch=fallback;confidence=Math.max(confidence,.42);if(strongOnset)rs.lastOnsetAt=now;}
      }
      rs.lastRms=rms;
      if(strongOnset)rs.lastOnsetAt=now;
      return {pitch,rms,confidence,onset,frequency:result?.frequency||null,strongOnset};
    };
    const finishDetected=at=>{
      if(rs.lastPitch==null||rs.currentStart==null)return;
      const stepSec=60/(Number(mainState.bpm)||120)/4;
      const rawStart=rs.recordStartStep+Math.max(0,(rs.currentStart-rs.recordStartAt)/1000/stepSec);
      const rawDur=Math.max(1,(at-rs.currentStart)/1000/stepSec);
      const t=Math.max(0,Math.round(rawStart)),l=Math.max(1,Math.round(rawDur));
      if(l*stepSec*1000<Number(modal3.querySelector('[data-rec-min]').value||90))return;
      const createdPitch=rs.lastPitch;
      if(!inRange(createdPitch))return;
      rs.notes.push({t,l,p:createdPitch,tr:mainState.cur||0,velocity:100,selected:false});
      rs.head=t+l;rs.changed=true;followPosition(t,createdPitch);
    };
    const recordTick=()=>{
      if(!rs.recording)return;
      const analyser=rs.analyser;if(!analyser)return;
      analyser.getFloatTimeDomainData(rs.buffer);analyser.getFloatFrequencyData(rs.freqBuffer);
      const detected=detectAudio(rs.buffer,rs.audio.sampleRate,rs.freqBuffer),p=detected.pitch,now=performance.now(),minMs=detectorSettings().minMs;
      if(p!==null){
        if(rs.lastPitch==null){
          rs.lastPitch=p;rs.currentStart=now;rs.lastPitchAt=now;rs.pendingPitch=null;
        }else if(rs.lastPitch===p){
          rs.lastPitchAt=now;rs.pendingPitch=null;
        }else{
          if(rs.pendingPitch!==p){rs.pendingPitch=p;rs.pendingSince=now;}
          else if(now-rs.pendingSince>=Math.max(45,minMs*.45)){
            finishDetected(rs.pendingSince);rs.lastPitch=p;rs.currentStart=rs.pendingSince;rs.lastPitchAt=now;rs.pendingPitch=null;
          }
        }
      }else if(rs.lastPitch!=null&&now-rs.lastPitchAt>minMs){
        finishDetected(rs.lastPitchAt);rs.lastPitch=null;rs.currentStart=null;rs.pendingPitch=null;rs.pitchHistory.length=0;
      }
      rs.head=rs.recordStartStep+Math.max(0,(now-rs.recordStartAt)/1000/(60/(Number(mainState.bpm)||120)/4));
      autoPan();draw();rs.recordTimer=setTimeout(recordTick,20);
    };
    const stopRecord=()=>{if(!rs.recording)return;rs.recording=false;clearTimeout(rs.recordTimer);finishDetected(performance.now());rs.lastPitch=null;rs.currentStart=null;try{rs.mic?.getTracks().forEach(t=>t.stop());}catch{}rs.mic=null;rs.analyser=null;modal3.querySelector('[data-rec-record]').textContent='● Start Record';draw();};
    const startRecord=async()=>{if(rs.recording){stopRecord();return;}try{const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});const a=recAudio(),src=a.createMediaStreamSource(stream),an=a.createAnalyser();an.fftSize=4096;an.smoothingTimeConstant=0;an.minDecibels=-100;an.maxDecibels=-10;src.connect(an);rs.mic=stream;rs.analyser=an;rs.audio=a;rs.buffer=new Float32Array(an.fftSize);rs.freqBuffer=new Float32Array(an.frequencyBinCount);rs.recording=true;rs.lastPitch=null;rs.currentStart=null;rs.pendingPitch=null;rs.pendingSince=0;rs.lastPitchAt=performance.now();rs.lastRms=0;rs.lastOnsetAt=-Infinity;rs.pitchHistory.length=0;rs.recordStartAt=performance.now();rs.recordStartStep=Math.max(0,Math.round(Number(rs.head)||Number(mainState.head)||0));rs.head=rs.recordStartStep;modal3.querySelector('[data-rec-record]').textContent='■ Stop Record';autoPan();draw();recordTick();}catch(err){window.UIXApp?.status?.(`Could not start microphone: ${err.message||err}`);}};
    const copyBack=()=>{
      const chosen=[...rs.selected].map(i=>rs.notes[i]).filter(Boolean);
      if(!chosen.length){
        modal3.querySelector('[data-rec-message]').textContent='Select at least one note.';
        window.UIXApp?.status?.('Select at least one Record Note to copy');
        return;
      }
      let minT=Infinity,maxP=-Infinity;
      for(const n of chosen){minT=Math.min(minT,n.t);maxP=Math.max(maxP,n.p);}
      mainState.clipboard=chosen.map(n=>({dt:n.t-minT,dp:maxP-n.p,l:n.l,p:n.p,op:n.p,velocity:n.velocity||100}));
      mainState.pasteTarget={step:minT,p:maxP};
      const message=`${chosen.length} note${chosen.length===1?'':'s'} copied to clipboard. Use Paste in the MIDI Editor.`;
      modal3.querySelector('[data-rec-message]').textContent=message;
      window.UIXApp?.status?.(message);
    };
    const deleteSelected=()=>{if(!rs.selected.size)return;rs.notes=rs.notes.filter((n,i)=>!rs.selected.has(i));rs.selected.clear();rs.changed=true;draw();};
    c.addEventListener('contextmenu',e=>{e.preventDefault();const r=c.getBoundingClientRect(),i=hit(e.clientX-r.left,e.clientY-r.top);if(i!=null)rs.selected.has(i)||rs.selected.add(i);window.UIXApp?.showContextMenu?.([{label:'Copy',icon:'⧉',disabled:rs.selected.size===0,action:()=>{const s=[...rs.selected].map(i=>rs.notes[i]).filter(Boolean);if(!s.length)return;let minT=Infinity,maxP=-Infinity;for(const n of s){minT=Math.min(minT,n.t);maxP=Math.max(maxP,n.p);}mainState.clipboard=s.map(n=>({dt:n.t-minT,dp:maxP-n.p,l:n.l,p:n.p,op:n.p,velocity:100}));mainState.pasteTarget={step:minT,p:maxP};host.textContent='Note copied.';}},{label:'Paste',icon:'▣',disabled:!mainState.clipboard?.length,action:()=>{const t=Math.max(0,Math.round(mainState.pasteTarget?.step||rs.head));const p=validMidiPitch(mainState.pasteTarget?.p??72);rs.notes.push(...mainState.clipboard.map(n=>({t:t+n.dt,l:n.l,p:validMidiPitch(p-n.dp),tr:mainState.cur||0,velocity:100,selected:false})));rs.changed=true;draw();}},{label:'Paste Origin Note',icon:'↥',disabled:!mainState.clipboard?.length,action:()=>{const t=Math.max(0,Math.round(mainState.pasteTarget?.step||rs.head));rs.notes.push(...mainState.clipboard.map(n=>({t:t+n.dt,l:n.l,p:validMidiPitch(n.op??n.p),tr:mainState.cur||0,velocity:100,selected:false})));rs.changed=true;draw();}},{label:'Delete',icon:'×',disabled:rs.selected.size===0,action:deleteSelected},{label:'Select All',icon:'☑',action:()=>{rs.notes.forEach((n,i)=>rs.selected.add(i));draw();}}],e.clientX,e.clientY);});
    c.addEventListener('pointerdown',e=>{active.set(e.pointerId,{x:e.clientX,y:e.clientY});c.setPointerCapture?.(e.pointerId);if(active.size>=2){drag=null;box=null;const pts=[...active.values()];two={last:{x:pts.reduce((a,p)=>a+p.x,0)/pts.length,y:pts.reduce((a,p)=>a+p.y,0)/pts.length}};return;}const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;if(y<RULER&&x>=KEYW){rs.head=Math.max(0,Math.round(((x-KEYW+sx)/zoom)));rs.recordStartStep=rs.head;followPosition(rs.head,layout[Math.floor(layout.length/2)]??60);draw();return;}const i=hit(x,y);if(i!=null){if(e.ctrlKey||e.metaKey){rs.selected.has(i)?rs.selected.delete(i):rs.selected.add(i);}else{rs.selected.clear();rs.selected.add(i);}draw();}});
    c.addEventListener('pointermove',e=>{if(!active.has(e.pointerId))return;active.set(e.pointerId,{x:e.clientX,y:e.clientY});if(active.size>=2){const pts=[...active.values()],m={x:pts.reduce((a,p)=>a+p.x,0)/pts.length,y:pts.reduce((a,p)=>a+p.y,0)/pts.length};if(two){sx-=m.x-two.last.x;sy-=m.y-two.last.y;clampRecordView();two.last=m;draw();}return;}if(box){box.x2=e.clientX-c.getBoundingClientRect().left;box.y2=e.clientY-c.getBoundingClientRect().top;draw();}});
    c.addEventListener('pointerup',e=>{active.delete(e.pointerId);if(active.size<2&&two){two=null;draw();}});c.addEventListener('pointercancel',e=>{active.delete(e.pointerId);if(active.size<2)two=null;});c.addEventListener('wheel',e=>{e.preventDefault();sx+=e.deltaX;sy+=e.deltaY;clampRecordView();draw();},{passive:false});
    modal3.querySelector('[data-rec-record]').onclick=startRecord;modal3.querySelector('[data-rec-play]').onclick=recordPlay;modal3.querySelector('[data-rec-copy]').onclick=copyBack;modal3.querySelector('[data-rec-select-all]').onclick=()=>{rs.notes.forEach((n,i)=>rs.selected.add(i));draw();};modal3.querySelector('[data-rec-clear-selection]').onclick=()=>{rs.selected.clear();draw();};
    ['start','end','threshold','min','tolerance','onset','mode','wave'].forEach(k=>modal3.querySelector(`[data-rec-${k}]`).addEventListener('change',draw));
    const close=()=>{stopRecord();stopRecordPlayback();try{rs.audio?.suspend?.();}catch{}window.removeEventListener('resize',resize);try{window.UIXApp?.closeModal?.(modal3);}catch{}modal3.remove();};
    modal3.querySelector('[data-rec-cancel]').onclick=()=>{const changed=rs.changed||rs.notes.length!==initialCount;if(changed&&window.UIXApp?.askConfirm)window.UIXApp.askConfirm('Cancel Record Note','Discard Record Note changes?',close,'Cancel Record');else close();};
    window.addEventListener('resize',resize);resize();
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
          <div class="uix-midi-grp"><button class="uix-midi-tb active" data-midi-tool="draw" type="button">✎ <span>Draw</span></button><button class="uix-midi-tb" data-midi-tool="select" type="button">▦ <span>Select</span></button><button class="uix-midi-tb" data-midi-tool="erase" type="button">⌫ <span>Erase</span></button><button class="uix-midi-tb" data-midi-tool="pan" type="button">✥ <span>Pan</span></button><button class="uix-midi-tb" data-midi-undo type="button" title="Undo (Ctrl+Z)" disabled>↶</button><button class="uix-midi-tb" data-midi-redo type="button" title="Redo (Ctrl+Y)" disabled>↷</button></div>
          <div class="uix-midi-sep"></div>
          <label class="uix-midi-lbl">BPM <input data-midi-bpm type="number" value="${config.bpm || 120}" min="30" max="300"></label>
          <label class="uix-midi-lbl">Snap <select data-midi-snap><option value="1" selected>1/16</option><option value="2">1/8</option><option value="4">1/4</option><option value="8">1/2</option><option value="16">Bar</option></select></label>
          <label class="uix-midi-lbl">Length <select data-midi-len><option value="1">1/16</option><option value="2" selected>1/8</option><option value="4">1/4</option><option value="8">1/2</option><option value="16">Bar</option></select></label>
          <label class="uix-midi-lbl">Wave <select data-midi-wave><option>triangle</option><option>sine</option><option>square</option><option>sawtooth</option></select></label>
          <button class="uix-midi-tb uix-midi-icon-only" data-midi-custom-notes type="button" title="Customize Notes" aria-label="Customize Notes">⚙</button><button class="uix-midi-tb uix-midi-icon-only" data-midi-copy-local type="button" title="Copy Local Notes" aria-label="Copy Local Notes">⧉</button><button class="uix-midi-tb uix-midi-icon-only" data-midi-note-selector type="button" title="Note Selector" aria-label="Note Selector">▦</button><button class="uix-midi-tb uix-midi-icon-only" data-midi-record-note type="button" title="Record Note" aria-label="Record Note">●</button>
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
      sy: Math.max(0, (defaultNoteLayout().indexOf(72)) * RH - 120), zoom: 22, start: 0, playing: false, loop: false, head: 0,
      W: 0, H: 0, dpr: 1, raf: 0, oscillators: [], audio: null, playTimer: 0, playToken: 0, scheduled: new Set(), startedAt: 0, fromStep: 0, history: [], redo: [], historyBusy: false, clipboard: [], noteAnchor: null, pasteTarget: null, selectionBox: null, noteLayout: normalizeNoteLayout(config.noteLayout || loadNoteLayout()), noteDefs: ensureNoteDefs(cloneNoteDefs(config.noteDefs || loadNoteDefs()), normalizeNoteLayout(config.noteLayout || loadNoteLayout())), noteRowByPitch: new Map(), previewNote: null, trackLevels: [], trackLoudness: []
    };
    if (!state.tracks.length) state.tracks.push({name:'Track 1',color:COLORS[0],wave:'triangle',channel:0});

    const canvas = modal.querySelector('[data-midi-canvas]'), g = canvas.getContext('2d'); canvas.style.touchAction='none'; canvas.style.webkitUserSelect='none';
    const view = makeGrid(state), total = view.total;
    const refreshNoteLayout = () => { view.refreshRows(); view.clampView(); draw(); };
    const status = msg => { modal.querySelector('[data-midi-status]').textContent = msg || ''; };
    const snapshot = () => ({bpm:state.bpm,ppq:state.ppq,start:state.start,head:state.head,cur:state.cur,tool:state.tool,sx:state.sx,sy:state.sy,zoom:state.zoom,notes:state.notes.map(n=>({...n})),tracks:state.tracks.map(t=>({...t})),noteLayout:state.noteLayout.slice(),noteDefs:cloneNoteDefs(state.noteDefs)});
    const sameSnapshot=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    function updateHistoryUI(){const u=modal.querySelector('[data-midi-undo]'),r=modal.querySelector('[data-midi-redo]');if(u)u.disabled=!state.history.length;if(r)r.disabled=!state.redo.length;}
    function pushHistory(before){if(state.historyBusy||!before)return;state.history.push(before);if(state.history.length>100)state.history.shift();state.redo=[];updateHistoryUI();}
    function restoreSnapshot(s){if(!s)return;stop();state.bpm=s.bpm;state.ppq=s.ppq;state.start=s.start;state.head=s.head;state.cur=Math.max(0,Math.min(s.cur,s.tracks.length-1));state.tool=s.tool;state.sx=s.sx;state.sy=s.sy;state.zoom=s.zoom;state.notes=s.notes.map(n=>({...n}));state.tracks=s.tracks.map(t=>({...t}));state.noteLayout=normalizeNoteLayout(s.noteLayout||state.noteLayout);state.noteDefs=ensureNoteDefs(cloneNoteDefs(s.noteDefs||state.noteDefs),state.noteLayout);if(!state.tracks.length)state.tracks.push({name:'Track 1',color:COLORS[0],wave:'triangle',channel:0});modal.querySelector('[data-midi-bpm]').value=state.bpm;modal.querySelector('[data-midi-wave]').value=state.tracks[state.cur]?.wave||'triangle';renderTracks();view.clampView();draw();}
    function undo(){if(!state.history.length)return;const current=snapshot(),prev=state.history.pop();state.historyBusy=true;state.redo.push(current);restoreSnapshot(prev);state.historyBusy=false;updateHistoryUI();status('Undo');}
    function redo(){if(!state.redo.length)return;const current=snapshot(),next=state.redo.pop();state.historyBusy=true;state.history.push(current);restoreSnapshot(next);state.historyBusy=false;updateHistoryUI();status('Redo');}
    const beginHistory=()=>snapshot();

    function addTrack(){const before=beginHistory(),i=state.tracks.length;state.tracks.push({name:`Track ${i+1}`,color:COLORS[i%COLORS.length],wave:'triangle',channel:i%16});state.cur=i;pushHistory(before);renderTracks();draw();}
    function renderTracks(){const host=modal.querySelector('[data-midi-tracks]');host.innerHTML='';state.trackLevels=state.trackLevels||[];state.trackLoudness=state.trackLoudness||[];state.tracks.forEach((t,i)=>{const row=document.createElement('div');row.className='uix-midi-track-row'+(i===state.cur?' sel':'');row.innerHTML=`<i class="dot" style="background:${t.color}"></i><span></span><i class="uix-midi-track-meter duo"><b data-meter-level></b><b data-meter-loudness></b></i><button type="button">✕</button>`;row.querySelector('span').textContent=t.name;row.onclick=()=>{state.cur=i;modal.querySelector('[data-midi-wave]').value=t.wave||'triangle';renderTracks();draw();};row.querySelector('button').onclick=e=>{e.stopPropagation();if(state.tracks.length<2)return;const before=beginHistory();state.notes=state.notes.filter(n=>n.tr!==i).map(n=>({...n,tr:n.tr>i?n.tr-1:n.tr}));state.tracks.splice(i,1);state.trackLevels.splice(i,1);state.trackLoudness.splice(i,1);state.cur=Math.min(state.cur,state.tracks.length-1);pushHistory(before);renderTracks();draw();};host.append(row);});}
    function resize(){const r=modal.querySelector('.uix-midi-stage').getBoundingClientRect();state.dpr=window.devicePixelRatio||1;state.W=r.width;state.H=r.height;canvas.width=state.W*state.dpr;canvas.height=state.H*state.dpr;view.clampView();draw();}
    function draw(){
      g.setTransform(state.dpr,0,0,state.dpr,0,0);
      g.fillStyle='#202020';g.fillRect(0,0,state.W,state.H);
      g.save();
      g.beginPath();g.rect(KEYW,RULER,state.W-KEYW,state.H-RULER);g.clip();
      for(let i=0;i<state.noteLayout.length;i++){
        const y=RULER+i*RH-state.sy;if(y>state.H||y<RULER-RH)continue;
        g.fillStyle=isBlack(state.noteLayout[i])?'#292929':'#2a2a2a';g.fillRect(KEYW,y,state.W-KEYW,RH);
        g.fillStyle='#333';g.fillRect(KEYW,y+RH-1,state.W-KEYW,1);
      }
      const T=total();
      for(let ss=0;ss<=T;ss++){
        const x=KEYW+ss*state.zoom-state.sx;if(x<KEYW||x>state.W)continue;
        g.fillStyle=ss%16===0?'#5a5a5a':ss%4===0?'#404040':'#2f2f2f';g.fillRect(x,RULER,1,state.H);
      }
      state.notes.forEach(n=>{
        const t=state.tracks[n.tr];if(!t)return;
        const row=view.rowForPitch(n.p);if(row===undefined)return;
        const x=KEYW+n.t*state.zoom-state.sx,y=RULER+row*RH-state.sy;
        if(x+n.l*state.zoom<KEYW||x>state.W||y>state.H||y<RULER-RH)return;
        const selected=!!n.selected;
        const previewActive=state.previewNote&&state.previewNote.until>performance.now()&&state.previewNote.p===n.p&&state.previewNote.tr===n.tr;
        const playingActive=state.playing&&state.head>=n.t&&state.head<n.t+n.l;
        const active=!!previewActive||playingActive;
        g.globalAlpha=n.tr===state.cur?1:.35;
        const noteColor=selected?'#e4ca4e':(t.color||COLORS[0]);
        g.fillStyle=noteColor;
        if(active){
          g.save();g.shadowColor=noteColor;g.shadowBlur=10;g.fillRect(x+1,y+1,Math.max(3,n.l*state.zoom-2),RH-2);g.restore();
        }else g.fillRect(x+1,y+1,Math.max(3,n.l*state.zoom-2),RH-2);
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
      const meterRows=modal.querySelectorAll('[data-midi-tracks] .uix-midi-track-row');meterRows.forEach((row,i)=>{const a=row.querySelector('[data-meter-level]'),b=row.querySelector('[data-meter-loudness]');if(a)a.style.transform=`scaleY(${clamp(Number(state.trackLevels?.[i]||0),0,1)})`;if(b)b.style.transform=`scaleY(${clamp(Number(state.trackLoudness?.[i]||0),0,1)})`;});
      g.restore();
      g.fillStyle='#222';g.fillRect(KEYW,0,state.W-KEYW,RULER);g.fillStyle='#3b3b3b';g.fillRect(0,RULER-1,state.W,1);
      g.fillStyle='#8c8c8c';g.font='10px system-ui';g.textBaseline='middle';
      for(let ss=0;ss<=T;ss+=4){
        const x=KEYW+ss*state.zoom-state.sx;if(x<KEYW||x>state.W)continue;
        g.fillStyle=ss%16===0?'#bbb':'#666';g.fillRect(x,ss%16===0?4:12,1,RULER);
        if(ss%16===0){g.fillStyle='#aaa';g.fillText(ss/16+1,x+4,10);}
      }
      g.save();g.beginPath();g.rect(0,RULER,KEYW,state.H-RULER);g.clip();
      for(let i=0;i<state.noteLayout.length;i++){
        const pp=state.noteLayout[i],y=RULER+i*RH-state.sy;if(y>state.H||y<RULER-RH)continue;
        const keyPreview=state.previewNote&&state.previewNote.until>performance.now()&&state.previewNote.p===pp;
        const keyPlaying=state.playing&&state.notes.some(n=>n.p===pp&&state.head>=n.t&&state.head<n.t+n.l);
        const keyActive=!!keyPreview||!!keyPlaying;
        g.fillStyle=keyActive?'#050505':'#e7e7e7';g.fillRect(0,y,KEYW-1,RH-1);
        g.fillStyle=keyActive?'#fff':(isBlack(pp)?'#666':'#222');g.fillText(noteName(pp),4,y+RH/2);
      }
      g.restore();g.fillStyle='#292929';g.fillRect(0,0,KEYW,RULER);g.fillStyle='#414141';g.fillRect(KEYW-1,0,1,state.H);
    }
    const snap=()=>+modal.querySelector('[data-midi-snap]').value;
    const cell=e=>{const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;const row=Math.floor((y-RULER+state.sy)/RH);const p=state.noteLayout[clamp(row,0,Math.max(0,state.noteLayout.length-1))]??60;return{x,y,step:(x-KEYW+state.sx)/state.zoom,p,row}};
    const hit=c=>{for(let i=state.notes.length-1;i>=0;i--){const n=state.notes[i];if(n.tr===state.cur&&n.p===c.p&&c.step>=n.t&&c.step<n.t+n.l)return n;}return null;};
    function audio(){if(!state.audio)state.audio=new (window.AudioContext||window.webkitAudioContext)();if(state.audio.state==='suspended')state.audio.resume();return state.audio;}
    function tone(note,t,d,trackWave,vol=.16){const p=typeof note==='object'?validMidiPitch(note.p):validMidiPitch(note),def=state.noteDefs?.[String(p)]||normalizeNoteDef(null,p),wave=def.type==='track'?(trackWave||'triangle'):(NOTE_TYPES.includes(def.type)&&def.type!=='track'?def.type:'triangle');const a=audio(),o=a.createOscillator(),gn=a.createGain();o.type=wave;o.frequency.value=Math.max(.01,Number(def.frequency)||midiFrequency(p));const start=Math.max(t,a.currentTime+0.005),dur=Math.max(0.02,d),level=clamp((Number(def.amplitude)||0)*Math.max(0,Math.min(1,Number(vol)||0)),0,1);gn.gain.setValueAtTime(0,start);gn.gain.linearRampToValueAtTime(level,start+0.008);gn.gain.setValueAtTime(level,start+Math.max(0.012,dur-0.02));gn.gain.linearRampToValueAtTime(0,start+dur);o.connect(gn).connect(a.destination);o.start(start);o.stop(start+dur+.02);state.oscillators.push(o);return o;}
    const preview=p=>{state.previewNote={p:validMidiPitch(p),tr:state.cur,until:performance.now()+220};state.trackLevels=state.trackLevels||[];state.trackLevels[state.cur]=1;tone(p,audio().currentTime,.2,state.tracks[state.cur]?.wave||'triangle',1);draw();setTimeout(()=>{if(state.previewNote&&state.previewNote.until<=performance.now()){state.previewNote=null;draw();}},235);};
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
      let minT=Infinity,maxP=-Infinity,maxT=-Infinity,minP=Infinity;for(const n of notes){minT=Math.min(minT,n.t);maxP=Math.max(maxP,n.p);maxT=Math.max(maxT,n.t+n.l);minP=Math.min(minP,n.p);}return {minT,maxP,maxT,minP};
    }
    function copyMidi(){
      const s=selectedMidiNotes();if(!s.length)return status('Nothing selected to copy');
      const b=noteSelectionBounds(s);
      state.clipboard=s.map(n=>({dt:n.t-b.minT,dp:b.maxP-n.p,l:n.l,p:n.p,op:n.p,velocity:n.velocity}));
      state.pasteTarget={step:b.minT,p:b.maxP};
      status(`${s.length} MIDI note${s.length===1?'':'s'} copied`);draw();
    }
    function openNoteSelectorFromNotes(sourceNotes, sourceName='MIDI'){
      const copyModal=document.createElement('section');
      copyModal.className='modal uix-midi-copy-local-modal';
      copyModal.innerHTML=`
        <div class="uix-midi-copy-local-head"><div><strong>NOTE SELECTOR</strong><small>${safeName(sourceName)} · select notes without modifying the MIDI.</small></div></div>
        <div class="uix-midi-copy-local-body">
          <aside class="uix-midi-copy-local-pitches"><div class="uix-midi-copy-local-title">NOTES</div><div data-local-note-pitches></div></aside>
          <div class="uix-midi-copy-local-stage"><canvas data-local-note-canvas></canvas><div class="uix-midi-copy-local-help">Tap to select · drag for box · two fingers to pan</div></div>
        </div>
        <div class="uix-midi-copy-local-foot"><span data-local-copy-status></span><button class="btn primary" data-local-copy>Copy</button><button class="btn" data-local-cancel>Cancel</button></div>`;
      document.body.append(copyModal);window.UIXApp?.showModal?.(copyModal);
      const c=copyModal.querySelector('[data-local-note-canvas]'),g=c.getContext('2d'),listHost=copyModal.querySelector('[data-local-note-pitches]');
      const selected=new Set();
      const notes=(sourceNotes||[]).map((n,i)=>({...n,_copyIndex:i}));
      const pitches=ensureNotePitches(state.noteLayout,notes.map(n=>validMidiPitch(n.p)));
      const v={sx:0,sy:0,zoom:Math.max(10,state.zoom),dpr:window.devicePixelRatio||1};
      let W=0,H=0;const activePointers=new Map();let twoPan=null;let box=null;
      const bounds=()=>{let maxT=64;for(const n of notes)maxT=Math.max(maxT,n.t+n.l);return {t:Math.max(64,maxT)};};
      const resize=()=>{const r=c.parentElement.getBoundingClientRect();W=r.width;H=r.height;v.dpr=window.devicePixelRatio||1;c.width=W*v.dpr;c.height=H*v.dpr;clampView();drawStage();};
      const rowHeight=18;
      const clampView=()=>{const b=bounds(),maxX=Math.max(0,b.t*v.zoom-(W-KEYW)),maxY=Math.max(0,pitches.length*rowHeight-(H-RULER));v.sx=Math.max(0,Math.min(v.sx,maxX));v.sy=Math.max(0,Math.min(v.sy,maxY));};
      const rowPitchAt=y=>{const row=Math.floor((y-RULER+v.sy)/rowHeight);return pitches[row]??null;};
      const yFor=p=>RULER+pitches.indexOf(p)*rowHeight-v.sy;
      const renderList=()=>{listHost.innerHTML='';pitches.forEach(p=>{const b=document.createElement('button');b.type='button';b.className='uix-midi-copy-pitch'+(selected.size&&notes.some((n,i)=>n.p===p&&selected.has(i))?' selected':'');b.textContent=`${noteName(p)}  (${p})`;b.onclick=()=>{notes.forEach((n,i)=>{if(n.p===p){if(selected.has(i))selected.delete(i);else selected.add(i);}});renderList();drawStage();};listHost.append(b);});};
      const hitNote=(x,y)=>{for(let i=notes.length-1;i>=0;i--){const n=notes[i],row=pitches.indexOf(n.p);if(row<0)continue;const nx=KEYW+n.t*v.zoom-v.sx,nw=Math.max(4,n.l*v.zoom),ny=RULER+row*rowHeight-v.sy;if(x>=nx&&x<=nx+nw&&y>=ny&&y<=ny+rowHeight)return i;}return -1;};
      const drawStage=()=>{clampView();g.setTransform(v.dpr,0,0,v.dpr,0,0);g.clearRect(0,0,W,H);g.fillStyle='#202020';g.fillRect(0,0,W,H);const b=bounds();g.save();g.beginPath();g.rect(KEYW,0,W-KEYW,H);g.clip();for(let i=0;i<pitches.length;i++){const y=yFor(pitches[i]);if(y>H||y+rowHeight<RULER)continue;g.fillStyle=isBlack(pitches[i])?'#292929':'#2a2a2a';g.fillRect(KEYW,y,W-KEYW,rowHeight);g.fillStyle='#333';g.fillRect(KEYW,y+rowHeight-1,W-KEYW,1);}for(let ss=0;ss<=b.t;ss+=4){const x=KEYW+ss*v.zoom-v.sx;if(x<KEYW||x>W)continue;g.fillStyle=ss%16===0?'#505050':'#2f2f2f';g.fillRect(x,RULER,1,H-RULER);}for(const [i,n] of notes.entries()){const row=pitches.indexOf(n.p);if(row<0)continue;const x=KEYW+n.t*v.zoom-v.sx,y=yFor(n.p),w=Math.max(4,n.l*v.zoom-2);if(x+w<KEYW||x>W||y+rowHeight<RULER||y>H)continue;const on=selected.has(i),col=COLORS[(Number(n.tr)||0)%COLORS.length];g.fillStyle=on?'#e4ca4e':col;if(on){g.save();g.shadowColor='#e4ca4e';g.shadowBlur=8;g.fillRect(x+1,y+1,w,rowHeight-2);g.restore();}else g.fillRect(x+1,y+1,w,rowHeight-2);}if(box){const x=Math.min(box.x1,box.x2),y=Math.min(box.y1,box.y2),w=Math.abs(box.x2-box.x1),h=Math.abs(box.y2-box.y1);g.fillStyle='rgba(228,202,78,.08)';g.fillRect(x,y,w,h);g.strokeStyle='#e4ca4e';g.strokeRect(x+.5,y+.5,w,h);}g.restore();g.fillStyle='#222';g.fillRect(0,0,KEYW,H);g.font='10px system-ui';g.textBaseline='middle';for(let i=0;i<pitches.length;i++){const p=pitches[i],y=yFor(p);if(y>H||y+rowHeight<RULER)continue;const present=notes.some(n=>n.p===p),active=notes.some((n,j)=>selected.has(j)&&n.p===p);g.fillStyle=active?'#050505':present?'#e7e7e7':'#bfbfbf';g.fillRect(0,y,KEYW-1,rowHeight-1);g.fillStyle=active?'#fff':(isBlack(p)?'#555':'#222');g.fillText(noteName(p),4,y+rowHeight/2);}};
      const selectBox=()=>{if(!box)return;const x1=Math.min(box.x1,box.x2),x2=Math.max(box.x1,box.x2),y1=Math.min(box.y1,box.y2),y2=Math.max(box.y1,box.y2);notes.forEach((n,i)=>{const row=pitches.indexOf(n.p);if(row<0)return;const nx=KEYW+n.t*v.zoom-v.sx,nx2=KEYW+(n.t+n.l)*v.zoom-v.sx,ny=yFor(n.p),ny2=ny+rowHeight;if(nx<=x2&&nx2>=x1&&ny<=y2&&ny2>=y1)selected.add(i);});};
      const close=()=>{window.removeEventListener('resize',resize);try{window.UIXApp?.closeModal?.(copyModal);}catch{}copyModal.remove();};
      c.addEventListener('pointerdown',e=>{activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});c.setPointerCapture?.(e.pointerId);if(activePointers.size>=2){box=null;const pts=[...activePointers.values()];twoPan={last:{x:pts.reduce((a,p)=>a+p.x,0)/pts.length,y:pts.reduce((a,p)=>a+p.y,0)/pts.length}};return;}const r=c.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;if(x<KEYW&&y>=RULER){const p=rowPitchAt(y);if(p!=null){selected.clear();notes.forEach((n,i)=>{if(n.p===p)selected.add(i);});renderList();drawStage();}return;}const i=hitNote(x,y);if(i>=0){if(selected.has(i))selected.delete(i);else selected.add(i);renderList();drawStage();}else box={x1:x,y1:y,x2:x,y2:y};});
      c.addEventListener('pointermove',e=>{if(!activePointers.has(e.pointerId))return;activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(activePointers.size>=2){const pts=[...activePointers.values()],mid={x:pts.reduce((a,p)=>a+p.x,0)/pts.length,y:pts.reduce((a,p)=>a+p.y,0)/pts.length};if(twoPan){v.sx-=mid.x-twoPan.last.x;v.sy-=mid.y-twoPan.last.y;clampView();twoPan.last=mid;drawStage();}return;}if(box){const r=c.getBoundingClientRect();box.x2=e.clientX-r.left;box.y2=e.clientY-r.top;drawStage();}});
      c.addEventListener('pointerup',e=>{activePointers.delete(e.pointerId);if(activePointers.size===0){if(box){selectBox();box=null;renderList();drawStage();}twoPan=null;}});
      c.addEventListener('pointercancel',e=>{activePointers.delete(e.pointerId);if(activePointers.size===0){box=null;twoPan=null;drawStage();}});
      c.addEventListener('wheel',e=>{e.preventDefault();v.sx+=e.deltaX;v.sy+=e.deltaY;clampView();drawStage();},{passive:false});
      copyModal.addEventListener('pointerdown',e=>{if(e.target===copyModal){close();}});
      copyModal.querySelector('[data-local-copy]').onclick=()=>{const chosen=notes.filter((n,i)=>selected.has(i));if(!chosen.length){copyModal.querySelector('[data-local-copy-status]').textContent='Select at least one note.';return;}const b=noteSelectionBounds(chosen);state.clipboard=chosen.map(n=>({dt:n.t-b.minT,dp:b.maxP-n.p,l:n.l,p:n.p,velocity:100}));state.pasteTarget={step:b.minT,p:b.maxP};copyModal.querySelector('[data-local-copy-status]').textContent='Note has been copied, paste it at the DAW.';};
      copyModal.querySelector('[data-local-cancel]').onclick=close;
      window.addEventListener('resize',resize);renderList();resize();
    }
    function openLocalMidiPicker(){
      const picker=document.createElement('section');picker.className='modal uix-midi-local-list-modal';
      picker.innerHTML=`<div class="uix-midi-local-list-head"><div><strong>LIST OF MIDI</strong><small>Select a saved local .mid or .midi to open its notes in NOTE SELECTOR.</small></div><button class="btn" data-midi-local-cancel type="button">Cancel</button></div><div class="uix-midi-local-list" data-midi-local-list></div>`;
      document.body.append(picker);window.UIXApp?.showModal?.(picker);
      picker.addEventListener('pointerdown',e=>{if(e.target===picker){try{window.UIXApp?.closeModal?.(picker);}catch{}picker.remove();}});
      const host=picker.querySelector('[data-midi-local-list]');
      const list=(Assets.MIDI||[]).filter(a=>/\.(mid|midi)$/i.test(String(a?.filename||a?.name||'')));
      if(!list.length){host.innerHTML='<div class="uix-midi-local-empty">No saved MIDI files.</div>';}else list.forEach(asset=>{const b=document.createElement('button');b.type='button';b.className='uix-midi-local-item';b.innerHTML='<strong></strong><small></small>';b.querySelector('strong').textContent=asset.name||asset.filename||'MIDI';b.querySelector('small').textContent=asset.filename||`${asset.name||'MIDI'}.mid`;b.onclick=()=>{try{const raw=String(asset.value||''),comma=raw.indexOf(','),bytes=raw.startsWith('data:')&&comma>=0?Uint8Array.from(atob(raw.slice(comma+1)),c=>c.charCodeAt(0)):null;if(!bytes)throw new Error('Invalid MIDI');const song=window.UIXMIDIParser.parse(bytes);const notes=[];song.tracks?.forEach((track,ti)=>{(track.notes||[]).forEach(n=>notes.push({t:Math.max(0,Math.round(n.tick*4/song.ppq)),l:Math.max(1,Math.round(n.duration*4/song.ppq)),p:validMidiPitch(n.pitch),tr:ti,velocity:100}));});try{window.UIXApp?.closeModal?.(picker);}catch{}picker.remove();openNoteSelectorFromNotes(notes,asset.name||asset.filename||'MIDI');}catch(err){window.UIXApp?.status?.(`Could not read MIDI: ${err.message||err}`);}};host.append(b);});
      picker.querySelector('[data-midi-local-cancel]').onclick=()=>{try{window.UIXApp?.closeModal?.(picker);}catch{}picker.remove();};
    }
    function openCopyLocalNotes(){openLocalMidiPicker();}
    function openCurrentNoteSelector(){openNoteSelectorFromNotes(state.notes.filter(n=>n.tr===state.cur).map(n=>({...n})),'Current MIDI');}
    function cutMidi(){
      const s=selectedMidiNotes();if(!s.length)return status('Nothing selected to cut');
      copyMidi();const before=beginHistory();state.notes=state.notes.filter(n=>!n.selected);clearMidiSelection();pushHistory(before);draw();
    }
    function addMidiNoteAt(c){
      const t=Math.max(0,Math.floor(c.step/snap())*snap());
      const p=validMidiPitch(c.p);
      const before=beginHistory();
      clearMidiSelection();
      const nn={t,l:+modal.querySelector('[data-midi-len]').value||2,p,tr:state.cur,velocity:100,selected:true};
      state.noteDefs=ensureNoteDefs(state.noteDefs||{},[p]);state.notes.push(nn);state.noteAnchor=nn;state.pasteTarget={step:t,p};pushHistory(before);preview(p);draw();
    }
    function pasteOriginMidi(target){
      if(!state.clipboard.length)return status('Nothing to paste');
      const t=target||state.pasteTarget||{step:state.head||0,p:72};
      const baseT=Math.max(0,Math.floor(Math.max(0,t.step)/snap())*snap());
      const pasted=state.clipboard.map(n=>({t:baseT+n.dt,l:n.l,p:validMidiPitch(n.op??n.p),tr:state.cur,velocity:n.velocity||100,selected:true}));
      state.noteLayout=ensureNotePitches(state.noteLayout,pasted.map(n=>n.p));state.noteDefs=ensureNoteDefs(state.noteDefs||{},pasted.map(n=>n.p));saveNoteLayout(state.noteLayout);saveNoteDefs(state.noteDefs);view.refreshRows();
      const before=beginHistory();clearMidiSelection();state.notes.push(...pasted);state.noteAnchor=pasted.at(-1)||null;state.pasteTarget={step:baseT,p:validMidiPitch(pasted.at(-1)?.p??72)};pushHistory(before);draw();status(`${pasted.length} MIDI note${pasted.length===1?'':'s'} pasted at original pitch`);
    }
    function pasteMidi(target){
      if(!state.clipboard.length)return status('Nothing to paste');
      const t=target||state.pasteTarget||{step:state.head||0,p:72};
      const baseT=Math.max(0,Math.floor(Math.max(0,t.step)/snap())*snap());
      const baseP=validMidiPitch(t.p);
      let pasted=state.clipboard.map(n=>({t:baseT+n.dt,l:n.l,p:baseP-n.dp,tr:state.cur,velocity:n.velocity||100,selected:true}));
      state.noteLayout=ensureNotePitches(state.noteLayout,pasted.map(n=>n.p));state.noteDefs=ensureNoteDefs(state.noteDefs||{},pasted.map(n=>n.p));saveNoteLayout(state.noteLayout);saveNoteDefs(state.noteDefs);view.refreshRows();
      const before=beginHistory();clearMidiSelection();state.notes.push(...pasted);state.noteAnchor=pasted.at(-1)||null;state.pasteTarget={step:baseT,p:baseP};pushHistory(before);draw();
      status(`${pasted.length} MIDI note${pasted.length===1?'':'s'} pasted at ${baseT}, ${baseP}`);
    }
    function duplicateMidi(){const s=selectedMidiNotes();if(!s.length)return status('Nothing selected to duplicate');copyMidi();const target={step:(noteSelectionBounds(s)?.maxT||0)+snap(),p:noteSelectionBounds(s)?.maxP||72};pasteMidi(target);}
    function deleteMidiNow(){const s=selectedMidiNotes();if(!s.length)return;const before=beginHistory();state.notes=state.notes.filter(n=>!n.selected);clearMidiSelection();pushHistory(before);draw();}
    function deleteMidi(){const s=selectedMidiNotes();if(!s.length)return status('Nothing selected');deleteMidiNow();}
    function midiSelectAll(){state.notes.filter(n=>n.tr===state.cur).forEach(n=>n.selected=true);state.noteAnchor=state.notes.find(n=>n.selected)||null;draw();}
    function midiDeselectAll(){clearMidiSelection();state.selectionBox=null;draw();}
    function selectInBox(rect,e,baseSelected){
      const cr=canvas.getBoundingClientRect(),x1=Math.min(rect.x1,rect.x2)-cr.left,x2=Math.max(rect.x1,rect.x2)-cr.left,y1=Math.min(rect.y1,rect.y2)-cr.top,y2=Math.max(rect.y1,rect.y2)-cr.top;
      const base=baseSelected||new Set();
      state.notes.filter(n=>n.tr===state.cur).forEach(n=>{
        const nx1=KEYW+n.t*state.zoom-state.sx,nx2=KEYW+(n.t+n.l)*state.zoom-state.sx;
        const row=view.rowForPitch(n.p);if(row===undefined)return;
        const ny1=RULER+row*RH-state.sy,ny2=ny1+RH;
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
        {label:'Paste Origin Note',icon:'↥',disabled:!state.clipboard.length,action:()=>pasteOriginMidi(target)},
        {label:'Edit in Record Note',icon:'●',disabled:selectedMidiNotes().length<1,action:()=>openRecordNoteModal(state,selectedMidiNotes().map(n=>({...n})),true)},
        {label:'Delete',icon:'×',shortcut:window.UIXKeyBinds?.shortcutFor('delete','midi'),disabled:!selectedMidiNotes().length,action:deleteMidi}
      ],x,y);
    }
    let drag=null;
    let longPressTimer=0,longPressPointer=null,longPressFired=false,longPressStart=null;
    const activePointers=new Map();let twoFingerPan=null;
    const midiPointerMidpoint=()=>{const pts=[...activePointers.values()];return pts.length>=2?{x:(pts[0].x+pts[1].x)/2,y:(pts[0].y+pts[1].y)/2}:null;};
    const cancelMidiLongPress=()=>{if(longPressTimer){clearTimeout(longPressTimer);longPressTimer=0;}longPressPointer=null;longPressStart=null;};
    canvas.addEventListener('contextmenu',e=>{if(longPressFired){e.preventDefault();e.stopPropagation();return;}const c=cell(e);if(c.x>=KEYW&&c.y>=RULER)state.pasteTarget={step:Math.max(0,c.step),p:validMidiPitch(c.p)};e.preventDefault();e.stopPropagation();showMidiContextMenu(e.clientX,e.clientY);});
    canvas.addEventListener('pointerdown',e=>{
      activePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      canvas.setPointerCapture?.(e.pointerId);
      if(activePointers.size>=2){cancelMidiLongPress();longPressFired=false;drag=null;state.selectionBox=null;twoFingerPan={last:midiPointerMidpoint(),sx:state.sx,sy:state.sy};draw();return;}
      if((e.buttons&3)===3){cancelMidiLongPress();drag={k:'pan',x:e.clientX,y:e.clientY,sx:state.sx,sy:state.sy};return;}
      if(e.button===2){e.preventDefault();e.stopPropagation();const c=cell(e);state.pasteTarget={step:Math.max(0,c.step),p:validMidiPitch(c.p)};return;}
      longPressFired=false;cancelMidiLongPress();
      if(e.pointerType==='touch'){longPressStart={x:e.clientX,y:e.clientY};longPressPointer=e.pointerId;longPressTimer=setTimeout(()=>{longPressTimer=0;longPressFired=true;drag=null;state.selectionBox=null;const c=cell(e);state.pasteTarget={step:Math.max(0,c.step),p:validMidiPitch(c.p)};showMidiContextMenu(e.clientX,e.clientY);},550);}
      const c=cell(e);state.pasteTarget={step:Math.max(0,c.step),p:validMidiPitch(c.p)};
      if(c.x<KEYW&&c.y>RULER){if(state.noteRowByPitch.has(c.p))preview(c.p);return;}
      if(c.y<RULER){const before=beginHistory();state.start=Math.max(0,Math.round(c.step));state.head=state.start;if(state.playing)play(true);if(!sameSnapshot(before,snapshot()))pushHistory(before);draw();return;}
      if(state.tool==='pan'||e.button===1){drag={k:'pan',x:e.clientX,y:e.clientY,sx:state.sx,sy:state.sy};return;}
      const n=hit(c);
      if(state.tool==='erase'){if(n){const before=beginHistory();state.notes.splice(state.notes.indexOf(n),1);pushHistory(before);draw();}return;}
      if(state.tool==='select'&&!n){drag={k:'pending',x:e.clientX,y:e.clientY,c0:c,changed:false,before:null,mod:true};return;}
      if(n){
        if(e.shiftKey||e.ctrlKey||e.metaKey)selectMidiNote(n,e);else if(!n.selected){clearMidiSelection();n.selected=true;state.noteAnchor=n;draw();}
        const edge=Math.min(Math.abs(c.step-n.t),Math.abs((n.t+n.l)-c.step))*state.zoom<14;
        drag={k:edge?'resize':'move',n,off:c.step-n.t,changed:false,before:beginHistory(),startX:e.clientX,startY:e.clientY,group:edge?null:selectedMidiNotes().map(x=>({n:x,dt:x.t-n.t,dp:x.p-n.p}))};
        preview(n.p);return;
      }
      drag={k:'pending',x:e.clientX,y:e.clientY,c0:c,changed:false,before:null,mod:e.shiftKey||e.ctrlKey||e.metaKey};
    });
    canvas.addEventListener('pointermove',e=>{
      if(longPressTimer&&longPressPointer===e.pointerId&&e.pointerType==='touch'){if(Math.hypot(e.clientX-(longPressStart?.x||e.clientX),e.clientY-(longPressStart?.y||e.clientY))>8)cancelMidiLongPress();}
      const c=cell(e);state.pasteTarget={step:Math.max(0,c.step),p:validMidiPitch(c.p)};
      if(activePointers.size>=2){
        const pt=midiPointerMidpoint();
        if(pt&&twoFingerPan?.last){state.sx+=pt.x-twoFingerPan.last.x;state.sy+=pt.y-twoFingerPan.last.y;view.clampView();twoFingerPan.last=pt;draw();}
        return;
      }
      if((e.buttons&3)===3){
        if(!drag||drag.k!=='pan')drag={k:'pan',x:e.clientX,y:e.clientY,sx:state.sx,sy:state.sy};
        state.sx=drag.sx-(e.clientX-drag.x);state.sy=drag.sy-(e.clientY-drag.y);view.clampView();draw();return;
      }
      if(!drag){status((state.noteRowByPitch.has(c.p)?noteName(c.p)+' ('+c.p+') ':'')+'step '+Math.max(0,Math.floor(c.step))+' notes '+state.notes.length);draw();return;}
      if(drag.k==='pan'){state.sx=drag.sx-(e.clientX-drag.x);state.sy=drag.sy-(e.clientY-drag.y);view.clampView();draw();return;}
      if(drag.k==='pending'){
        const moved=Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>4;
        if(moved){
          cancelMidiLongPress();
          if(state.tool==='draw'&&!drag.mod){
            const step=snap(),before=beginHistory(),nn={t:Math.max(0,Math.round(drag.c0.step/step)*step),l:step,p:drag.c0.p,tr:state.cur,velocity:100,selected:true};
            clearMidiSelection();state.notes.push(nn);state.noteAnchor=nn;drag={k:'createResize',n:nn,changed:true,before,lastStep:nn.t};preview(nn.p);draw();return;
          }
          drag.k='marquee';drag.before=beginHistory();drag.baseSelected=new Set(selectedMidiNotes());drag.box={x1:drag.x,y1:drag.y,x2:e.clientX,y2:e.clientY};
        }
        else return;
      }
      if(drag.k==='marquee'){drag.box.x2=e.clientX;drag.box.y2=e.clientY;state.selectionBox={a:{x:drag.box.x1-canvas.getBoundingClientRect().left,y:drag.box.y1-canvas.getBoundingClientRect().top},b:{x:drag.box.x2-canvas.getBoundingClientRect().left,y:drag.box.y2-canvas.getBoundingClientRect().top}};selectInBox(drag.box,e,drag.baseSelected);return;}
      if(drag.k==='move'){
        const n=drag.n,step=snap();
        let baseT=Math.max(0,Math.round((c.step-drag.off)/step)*step);
        const baseP=validMidiPitch(c.p);
        const group=drag.group||[{n,dt:0,dp:0}];
        const minDt=Math.min(...group.map(g=>g.dt)),maxDt=Math.max(...group.map(g=>g.dt));
        baseT=Math.max(0,baseT-minDt);
        const minDp=Math.min(...group.map(g=>g.dp)),maxDp=Math.max(...group.map(g=>g.dp));
        const anchoredP=clamp(baseP,-minDp,127-maxDp);
        const nextPitches=group.map(g=>validMidiPitch(anchoredP+g.dp));
        state.noteLayout=ensureNotePitches(state.noteLayout,nextPitches);
        const oldSignature=group.map(g=>`${g.n.t}:${g.n.p}`).join('|');
        group.forEach((g,i)=>{g.n.t=Math.max(0,baseT+g.dt);g.n.p=nextPitches[i];});
        const newSignature=group.map(g=>`${g.n.t}:${g.n.p}`).join('|');
        if(oldSignature!==newSignature)drag.changed=true;
        view.refreshRows();view.clampView();state.noteAnchor=n;draw();return;
      }
      if(drag.k==='resize'||drag.k==='createResize'){
        const n=drag.n,step=snap(),nl=Math.max(step,Math.round((c.step-n.t)/step)*step||step);
        if(nl!==n.l){n.l=nl;drag.changed=true;}draw();return;
      }
      status((state.noteRowByPitch.has(c.p)?noteName(c.p)+' ('+c.p+') ':'')+'step '+Math.max(0,Math.floor(c.step))+' notes '+state.notes.length);
    });
    canvas.addEventListener('pointerup',e=>{
      activePointers.delete(e.pointerId);if(activePointers.size<2)twoFingerPan=null;
      if(activePointers.size){cancelMidiLongPress();return;}
      if(e.pointerType==='touch'){const fired=longPressFired;cancelMidiLongPress();longPressFired=false;if(fired){drag=null;state.selectionBox=null;draw();return;}}
      if(!drag)return;
      if(drag.k==='pending'){addMidiNoteAt(drag.c0);drag=null;return;}
      if(drag.k==='marquee'){
        const r=drag.box;selectInBox(r,e,drag.baseSelected);state.selectionBox=null;drag=null;updateHistoryUI();draw();return;
      }
      if(drag.before&&drag.changed)pushHistory(drag.before);
      drag=null;updateHistoryUI();draw();
    });
    canvas.addEventListener('pointercancel',e=>{activePointers.delete(e.pointerId);if(activePointers.size<2)twoFingerPan=null;cancelMidiLongPress();longPressFired=false;drag=null;state.selectionBox=null;updateHistoryUI();draw();});
    canvas.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey)state.zoom=Math.max(6,Math.min(80,state.zoom*(e.deltaY<0?1.1:.9)));else if(e.shiftKey)state.sx+=e.deltaY;else{state.sy+=e.deltaY;state.sx+=e.deltaX;}view.clampView();draw();},{passive:false});


    function stopOscs(){state.oscillators.forEach(o=>{try{o.stop();}catch{}});state.oscillators=[];}
    const stepSec=()=>60/(Number(modal.querySelector('[data-midi-bpm]').value)||120)/4;
    function clearScheduler(){if(state.playTimer){clearInterval(state.playTimer);state.playTimer=0;}state.scheduled.clear();}
    function stop(){state.playing=false;state.playToken++;clearScheduler();stopOscs();cancelAnimationFrame(state.raf);state.previewNote=null;state.trackLevels=(state.tracks||[]).map(()=>0);state.head=state.start;modal.querySelector('[data-midi-play]').innerHTML='▶ <span>Play</span>';modal.querySelector('[data-midi-play]').classList.remove('active');draw();}
    function play(restart){
      try {
        const a=audio();
        stopOscs();clearScheduler();cancelAnimationFrame(state.raf);
        const ss=stepSec(),from=restart?state.start:state.head;let end=0;for(const n of state.notes)end=Math.max(end,Number(n.t)||0,((Number(n.t)||0)+(Number(n.l)||0)));
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
            const st=Math.max(n.t,nowStep),dur=Math.max(.03,(n.l-(st-n.t))*ss),vel=Math.max(.02,Math.min(1,(Number(n.velocity)||100)/127));
            tone(n.p,state.startedAt+st*ss,dur,state.tracks[n.tr]?.wave||'triangle',vel);state.scheduled.add(key);
          }
        };
        schedule();state.playTimer=setInterval(schedule,pollMs);
        modal.querySelector('[data-midi-play]').innerHTML='■ <span>Stop</span>';modal.querySelector('[data-midi-play]').classList.add('active');
        (function tick(){
          if(!state.playing||token!==state.playToken)return;
          state.head=(a.currentTime-state.startedAt)/ss;
          state.trackLevels=(state.trackLevels||[]).map(v=>0);state.trackLoudness=(state.trackLoudness||[]).map(v=>0);
          for(let ti=0;ti<state.tracks.length;ti++){let loud=null,lscore=-1;for(const n of state.notes){if(n.tr!==ti||state.head<n.t||state.head>=n.t+n.l)continue;const def=state.noteDefs?.[String(validMidiPitch(n.p))]||normalizeNoteDef(null,n.p),score=clamp((Number(def.amplitude)||.16)*(Number(n.velocity||100)/100),0,1);if(score>lscore){lscore=score;loud=n;}}if(loud){const progress=clamp((state.head-loud.t)/Math.max(1,loud.l),0,1);state.trackLevels[ti]=progress;state.trackLoudness[ti]=progress*lscore;} }
          if(state.previewNote&&state.previewNote.until<=performance.now())state.previewNote=null;
          if(state.head>=end){if(state.loop){state.playing=false;clearScheduler();state.head=state.start;return play(true);}return stop();}
          const x=state.head*state.zoom-state.sx;if(x>state.W-KEYW-20)state.sx=state.head*state.zoom-40;draw();state.raf=requestAnimationFrame(tick);
        })();
      } catch(err) {state.playing=false;clearScheduler();window.UIXApp?.status?.('MIDI playback error: '+(err?.message||'Audio unavailable'));}
    }
    const bytes=()=>window.UIXMIDIParser.encode({ppq:state.ppq,bpm:Number(modal.querySelector('[data-midi-bpm]').value)||120,tracks:state.tracks.map((t,i)=>({name:t.name,channel:t.channel,notes:state.notes.filter(n=>n.tr===i)}))});
    function download(bytesData,name='song.mid'){const blob=new Blob([bytesData],{type:'audio/midi'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
    function save(){const name=state.name||'Song', data=window.UIXMIDIParser.bytesToDataURL(bytes()), existing=state.sourceAsset;const list=Assets.MIDI||(Assets.MIDI=[]);if(existing&&list.includes(existing)){existing.name=name;existing.filename=`${name}.mid`;existing.value=data;existing.type='audio/midi';existing.kind='MIDI';existing.editable=true;}else{let finalName=name,i=2;while(list.some(a=>a.name===finalName))finalName=`${name} ${i++}`;list.push({name:finalName,filename:`${finalName}.mid`,value:data,type:'audio/midi',kind:'MIDI',editable:true});}window.UIXApp?.refreshAssets?.();window.UIXApp?.status?.('MIDI saved');closeEditor();}
    function importFile(file){
      const reader=new FileReader();
      reader.onload=()=>{
        try{
          const song=window.UIXMIDIParser.parse(new Uint8Array(reader.result));
          const applyImported=()=>{
            stop();
            const nextNotes=[],nextTracks=[],importedPitches=[];
            const importedTracks=song.tracks.filter(track=>Array.isArray(track.notes)&&track.notes.length);
            importedTracks.forEach((track,i)=>{
              const index=nextTracks.length;
              nextTracks.push({name:track.name||`Track ${i+1}`,color:COLORS[index%COLORS.length],wave:'triangle',channel:track.channel??index%16});
              track.notes.forEach(n=>{const p=validMidiPitch(n.pitch);importedPitches.push(p);nextNotes.push({t:Math.max(0,Math.round(n.tick*4/song.ppq)),l:Math.max(1,Math.round(n.duration*4/song.ppq)),p,tr:index,velocity:100,selected:false});});
            });
            const before=beginHistory();state.ppq=song.ppq||480;state.bpm=Math.round(song.bpm||120);state.notes=nextNotes;state.tracks=nextTracks.length?nextTracks:[{name:'Track 1',color:COLORS[0],wave:'triangle',channel:0}];state.trackLevels=state.tracks.map(()=>0);state.noteLayout=ensureNotePitches(state.noteLayout,importedPitches);state.noteDefs=ensureNoteDefs(state.noteDefs||{},importedPitches);saveNoteLayout(state.noteLayout);saveNoteDefs(state.noteDefs);pushHistory(before);state.cur=0;state.sx=0;state.sy=Math.max(0,Math.min(Math.max(0,state.noteLayout.length*RH-state.H+RULER),Math.max(0,(state.noteLayout.length*RH-state.H)*0.5)));modal.querySelector('[data-midi-bpm]').value=state.bpm;renderTracks();view.clampView();draw();state.name=safeName(file.name);modal.querySelector('[data-midi-name]').textContent=`${state.name}`;
          };
          if(state.notes.length){const ask=window.UIXApp?.askConfirm;if(ask)ask('Import MIDI','Importing this MIDI will replace the current MIDI. Continue?',applyImported,'Import');else if(confirm('Importing this MIDI will replace the current MIDI. Continue?'))applyImported();}
          else applyImported();
        }catch(err){window.UIXApp?.status?.(`Could not read MIDI file: ${err.message||err}`);}
      };
      reader.readAsArrayBuffer(file);
    }

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
    modal.querySelector('[data-midi-custom-notes]').onclick=()=>openCustomNotesEditor(state,refreshNoteLayout);
    modal.querySelector('[data-midi-copy-local]').onclick=()=>openCopyLocalNotes();
    modal.querySelector('[data-midi-note-selector]').onclick=()=>openCurrentNoteSelector();
    modal.querySelector('[data-midi-record-note]').onclick=()=>openRecordNoteModal(state,null,false);
    const confirmMidiCancel=()=>{stop();if(window.UIXApp?.askConfirm)window.UIXApp.askConfirm('Cancel MIDI Editing','Cancel MIDI editing? Any unsaved changes will be lost.',closeEditor,'Cancel Editing');else closeEditor();};
    modal.querySelector('[data-midi-cancel]').onclick=confirmMidiCancel;
    modal._uixMidiStopPlayback=stop;
    modal.querySelector('[data-midi-undo]').onclick=undo;
    modal.querySelector('[data-midi-redo]').onclick=redo;
    modal.tabIndex=0;modal.focus();
    activeShortcutHandler=command=>{
      switch(command){
        case'copy':copyMidi();break;case'cut':cutMidi();break;case'paste':pasteMidi();break;case'pasteOrigin':pasteOriginMidi();break;case'recordNote':openRecordNoteModal(state,null,false);break;
        case'delete':deleteMidi();break;case'duplicate':duplicateMidi();break;case'selectAll':midiSelectAll();break;case'deselectAll':midiDeselectAll();break;
        case'undo':undo();break;case'redo':redo();break;case'saveMIDI':save();break;
        case'exportMIDI':download(bytes(),`${safeName(state.name)}.mid`);break;case'importMIDI':modal.querySelector('[data-midi-import]')?.click();break;
        case'play':state.playing?stop():play(true);break;case'stop':stop();break;case'escape':confirmMidiCancel();break;
        case'contextMenu':{const r=canvas.getBoundingClientRect();showMidiContextMenu(r.left+r.width/2,r.top+r.height/2);break;}
      }
    };
    renderTracks();resize();updateHistoryUI();
  }

  function closeEditor(){if(!modal){activeShortcutHandler=null;return;}const m=modal;try{m._uixMidiStopPlayback?.();}catch{}modal=null;activeShortcutHandler=null;try{window.UIXApp?.closeModal?.(m);}catch{}m.remove();}

  function handleShortcut(command){return activeShortcutHandler?.(command);}
  window.UIXMIDIEditor = { openCreate, openEdit, close: closeEditor, handleShortcut };
})();
