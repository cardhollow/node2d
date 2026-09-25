(() => {
  'use strict';

  const MAX_SIZE = 512;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = v => String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
  const transparent = () => [0, 0, 0, 0];
  const makePixels = (w, h) => Array.from({length: h}, () => Array.from({length: w}, transparent));
  const clonePixels = p => p.map(row => row.map(px => [...px]));
  const samePixel = (a, b) => a[0]===b[0] && a[1]===b[1] && a[2]===b[2] && a[3]===b[3];
  const cssRgba = p => `rgba(${p[0]},${p[1]},${p[2]},${(p[3]/255).toFixed(3)})`;
  const rgbaToHex = rgba => '#' + rgba.map(v => clamp(Math.round(v),0,255).toString(16).padStart(2,'0')).join('').toUpperCase();
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const midpoint = (a,b) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const EXT = /\.[^.]+$/;

  const glyphs = {
    pencil:'✎', eraser:'⌫', line:'／', point:'•', rect:'□', circle:'○', triangle:'△',
    undo:'↶', redo:'↷', grid:'⊞', center:'⊙', flipx:'↔', flipy:'↕', rotate:'↻',
    copy:'⧉', add:'＋', save:'⇩', play:'▶', pause:'Ⅱ', prev:'‹', next:'›', delete:'×', lasso:'⌁', cut:'✂', paste:'▣', bucket:'▰'
  };
  const glyph = name => `<span class="ui-glyph" aria-hidden="true">${glyphs[name] || '·'}</span>`;

  let modalSeq = 0;
  let activeEditor = null;

  function makeModal(className, html) {
    const modal = document.createElement('section');
    modal.className = `modal ${className}`;
    modal.id = `spriteModal-${++modalSeq}`;
    modal.dataset.closeOutside = 'false';
    modal.innerHTML = html;
    document.body.append(modal);
    window.UIXApp?.showModal?.(modal);
    return modal;
  }

  function parseHex(value) {
    let s = String(value || '#FFFFFFFF').trim().replace(/^#/,'');
    if (s.length === 3) s = s.split('').map(c=>c+c).join('');
    if (s.length === 6) s += 'FF';
    if (!/^[\da-f]{8}$/i.test(s)) throw new Error('Invalid color');
    const n = parseInt(s,16);
    return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255];
  }

  function assetStem(asset) {
    return String(asset?.filename || asset?.name || 'Sprite').replace(EXT,'');
  }
  function frameSuffix(stem) {
    const m = String(stem).match(/^(.*?)(\d+)$/);
    return m ? {base:m[1], number:Number(m[2])} : {base:String(stem), number:null};
  }
  function frameGroupFor(asset) {
    const all = window.UIXAssets?.Assets?.Sprite || [];
    const parsed = frameSuffix(assetStem(asset));
    if (parsed.number == null) return [asset];
    const candidates = all
      .map(a => ({asset:a, parsed:frameSuffix(assetStem(a))}))
      .filter(x => x.parsed.number != null && x.parsed.base.toLowerCase() === parsed.base.toLowerCase())
      .sort((a,b) => a.parsed.number - b.parsed.number);
    const byNumber = new Map(candidates.map(x => [x.parsed.number, x.asset]));
    const first = byNumber.get(1);
    if (!first) return [asset];
    const group=[];
    for(let n=1; byNumber.has(n); n++) group.push(byNumber.get(n));
    return group.some(a => a === asset) ? group : [asset];
  }

  function openCreate() {
    const modal = makeModal('sprite-create-modal', `
      <div class="modal-header"><div><h3>New Sprite</h3><p>Create a sprite with one or more animation frames.</p></div><button class="modal-close" type="button" data-close-sprite>×</button></div>
      <div class="sprite-create-form">
        <div class="property-row"><span class="property-label">Name</span><div class="property-control"><input data-create-name type="text" value="Sprite" autocomplete="off"></div></div>
        <div class="sprite-create-pixel"><label><span class="property-label">Width</span><input data-create-width type="number" min="1" max="512" value="32"></label><label><span class="property-label">Height</span><input data-create-height type="number" min="1" max="512" value="32"></label></div>
        <div class="sprite-create-note">A new Sprite starts with 1 frame. Use <b>+ Add</b> in the editor to create more frames.</div>
        <div class="modal-actions"><button class="btn" data-close-sprite type="button">Cancel</button><button class="btn primary" data-create-sprite type="button">Create</button></div>
      </div>`);

    const close = () => { window.UIXApp?.closeModal?.(modal); modal.remove(); };
    modal.querySelectorAll('[data-close-sprite]').forEach(b => b.addEventListener('click', close));
    modal.querySelector('[data-create-sprite]').addEventListener('click', () => {
      const name = modal.querySelector('[data-create-name]').value.trim() || 'Sprite';
      const width = clamp(Number(modal.querySelector('[data-create-width]').value) || 32, 1, MAX_SIZE);
      const height = clamp(Number(modal.querySelector('[data-create-height]').value) || 32, 1, MAX_SIZE);
      close();
      openEditor({
        name,width,height,sourceAssets:[],fps:8,
        frames:[{name,width,height,pixels:makePixels(width,height),sourceAsset:null}]
      });
    });
  }

  async function imageToPixels(src) {
    if (!src) throw new Error('No sprite source');
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await new Promise((resolve,reject) => { img.onload=resolve; img.onerror=reject; });
    const width = clamp(img.naturalWidth || 32, 1, MAX_SIZE);
    const height = clamp(img.naturalHeight || 32, 1, MAX_SIZE);
    const c=document.createElement('canvas'); c.width=width; c.height=height;
    const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.imageSmoothingEnabled=false; ctx.clearRect(0,0,width,height); ctx.drawImage(img,0,0,width,height);
    const raw=ctx.getImageData(0,0,width,height).data, px=makePixels(width,height);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++){const i=(y*width+x)*4;px[y][x]=[raw[i],raw[i+1],raw[i+2],raw[i+3]];}
    return {width,height,pixels:px};
  }

  function normalizeFrameSizes(frames){
    const maxW=Math.max(1,...frames.map(f=>f.width||1));
    const maxH=Math.max(1,...frames.map(f=>f.height||1));
    return frames.map(f=>{
      if(f.width===maxW && f.height===maxH)return f;
      const pixels=makePixels(maxW,maxH);
      for(let y=0;y<Math.min(f.height,maxH);y++)for(let x=0;x<Math.min(f.width,maxW);x++)pixels[y][x]=[...f.pixels[y][x]];
      return {...f,width:maxW,height:maxH,pixels};
    });
  }

  async function openEdit(asset) {
    const group = frameGroupFor(asset), frames=[];
    for(const sourceAsset of group){
      try{
        const p=await imageToPixels(sourceAsset.value);
        frames.push({name:assetStem(sourceAsset),width:p.width,height:p.height,pixels:p.pixels,sourceAsset});
      }catch{
        frames.push({name:assetStem(sourceAsset),width:32,height:32,pixels:makePixels(32,32),sourceAsset});
      }
    }
    const normalized=normalizeFrameSizes(frames);
    const parsed=frameSuffix(assetStem(group[0]));
    openEditor({name:parsed.number==null?assetStem(group[0]):parsed.base,sourceAssets:group,frames:normalized,fps:8,width:normalized[0]?.width||32,height:normalized[0]?.height||32});
  }

  function openEditor(config) {
    const modal=makeModal('sprite-paint-modal',`
      <div class="sprite-editor-header">
        <div class="sprite-editor-heading"><strong>Sprite Editor</strong><span data-editor-subtitle></span></div>
        <div class="sprite-editor-header-actions"><button class="btn" type="button" data-sprite-cancel>Cancel</button><button class="btn primary" type="button" data-sprite-save>${glyph('save')}Save PNG</button></div>
      </div>
      <div class="sprite-editor-layout">
        <aside class="sprite-tool-panel" data-sprite-panel="left">
          <div class="sprite-side-header"><div class="sprite-side-heading"><strong>Tools</strong><span>Sprite editing tools</span></div><button type="button" class="sprite-side-collapse" data-sprite-panel-collapse="left" title="Collapse">‹</button></div>
          <div class="sprite-panel-resize sprite-panel-resize-left" data-resize-sprite-panel="left"></div>
          <section class="sprite-tool-section sprite-tool-first-section">
            <div class="sprite-section-title">Tools</div>
            <div class="sprite-tool-stack" data-basic-tools></div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Shape</div>
            <div class="sprite-shape-stack" data-shape-tools></div>
            <label class="sprite-check-row"><input type="checkbox" data-perfect-shape><span>Perfect Shape</span></label>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Brush</div>
            <input data-sprite-size type="range" min="1" max="32" value="1">
            <div class="sprite-inline-value"><span data-sprite-size-label>1</span> px</div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Color</div>
            <div class="sprite-color-row"><span class="sprite-color-swatch" data-sprite-color-swatch></span><input data-sprite-color type="text" value="#FFFFFFFF" spellcheck="false"></div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Mirror Painting</div>
            <div class="sprite-button-column">
              <button class="btn toggle-btn" data-mirror="x" type="button">Mirror X: Off</button>
              <button class="btn toggle-btn" data-mirror="y" type="button">Mirror Y: Off</button>
            </div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Edit</div>
            <div class="sprite-action-row"><button class="btn" data-sprite-action="undo" type="button">${glyph('undo')}Undo</button><button class="btn" data-sprite-action="redo" type="button">${glyph('redo')}Redo</button></div>
            <div class="sprite-action-row"><button class="btn" data-sprite-action="grid" type="button">${glyph('grid')}Grid</button><button class="btn" data-sprite-action="center" type="button">${glyph('center')}Center</button></div>
            <div class="sprite-action-row"><button class="btn" data-sprite-action="flipx" type="button">${glyph('flipx')}Flip X</button><button class="btn" data-sprite-action="flipy" type="button">${glyph('flipy')}Flip Y</button></div>
            <div class="sprite-action-row"><button class="btn" data-sprite-action="rotate" type="button">${glyph('rotate')}Rotate</button></div>
            <div class="sprite-action-row"><button class="btn" data-sprite-action="clear" type="button">Clear</button></div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Selection</div>
            <div class="sprite-action-row"><button class="btn" data-lasso-mode="set" type="button">Set</button><button class="btn" data-lasso-mode="add" type="button">Add</button><button class="btn" data-lasso-mode="subtract" type="button">Subtract</button></div>
            <div class="sprite-action-row"><button class="btn" data-sprite-selection="copy" type="button">${glyph('copy')}Copy</button><button class="btn" data-sprite-selection="cut" type="button">${glyph('cut')}Cut</button></div>
            <div class="sprite-action-row"><button class="btn" data-sprite-selection="paste" type="button">${glyph('paste')}Paste</button><button class="btn" data-sprite-selection="cancel" type="button">Cancel</button></div>
          </section>
          <section class="sprite-tool-section sprite-navigation-help">
            <div class="sprite-section-title">View</div>
            <div>Wheel / pinch: zoom</div><div>2 fingers / Space + drag: pan</div>
          </section>
        </aside>

        <main class="sprite-canvas-wrap" data-sprite-canvas-wrap>
          <canvas class="sprite-paint-canvas" data-sprite-paint></canvas>
          <div class="sprite-preview-card" data-preview-card>
            <div class="sprite-preview-header"><strong>Preview</strong><button type="button" class="icon-button" data-preview-close title="Hide Preview">×</button></div>
            <canvas data-sprite-preview></canvas>
          </div>
          <div class="sprite-editor-status"><span data-sprite-coord>—, —</span><span>Zoom <b data-sprite-zoom>100%</b></span></div>
        </main>

        <aside class="sprite-inspector-panel" data-sprite-panel="right">
          <div class="sprite-side-header"><div class="sprite-side-heading"><strong>Inspector</strong><span>Sprite and frame settings</span></div><button type="button" class="sprite-side-collapse" data-sprite-panel-collapse="right" title="Collapse">›</button></div>
          <div class="sprite-panel-resize sprite-panel-resize-right" data-resize-sprite-panel="right"></div>
          <section class="sprite-inspector-section">
            <div class="sprite-section-title">Sprite</div>
            <div class="property-row"><span class="property-label">Name</span><div class="property-control"><input data-sprite-name type="text"></div></div>
            <div class="sprite-size-pair"><label><span class="property-label">Width</span><input data-sprite-width type="number" min="1" max="512"></label><label><span class="property-label">Height</span><input data-sprite-height type="number" min="1" max="512"></label></div>
          </section>
          <section class="sprite-inspector-section">
            <div class="sprite-frames-heading"><strong>Frames</strong><span data-frame-count>1</span></div>
            <div class="sprite-frame-list" data-frame-list></div>
            <div class="sprite-frame-actions"><button class="btn" data-frame-action="copy" type="button">${glyph('copy')}Copy</button><button class="btn" data-frame-action="add" type="button">${glyph('add')}Add</button></div>
            <div class="sprite-play-row"><button class="btn" data-frame-action="prev" type="button" aria-label="Previous frame">${glyph('prev')}</button><button class="btn" data-frame-action="play" type="button">${glyph('play')}Play</button><button class="btn" data-frame-action="next" type="button" aria-label="Next frame">${glyph('next')}</button><label><span>FPS</span><input data-sprite-fps type="number" min="1" max="120" value="8"></label></div>
            <div class="sprite-frame-hint">Drag frames to reorder. Frames are saved as separate PNG files.</div>
          </section>
        </aside>
      </div>`);

    const frames=(config.frames||[]).map(f=>({...f,pixels:clonePixels(f.pixels)}));
    const ed={
      modal,name:config.name||'Sprite',sourceAssets:config.sourceAssets||[],frames:frames.length?frames:[{name:config.name||'Sprite',width:config.width||32,height:config.height||32,pixels:makePixels(config.width||32,config.height||32),sourceAsset:null}],
      frameIndex:0,fps:config.fps||8,playing:false,playTimer:null,tool:'pencil',brushSize:1,color:[255,255,255,255],showGrid:true,
      zoom:4,pan:{x:0,y:0},mirrorX:false,mirrorY:false,undo:[],redo:[],drawing:false,drawStart:null,lastCell:null,lastPaintCell:null,
      panelWidths:{left:190,right:235},leftCollapsed:false,rightCollapsed:false,
      pointers:new Map(),pinch:null,panDrag:null,spacePan:false,ruler:null,pointerDrawingId:null,lastPointerCellKey:'',perfectShape:false,points:[],pointDragIndex:-1,
      lassoPoints:[],lassoDrawing:false,selection:null,selectionMode:'set',selectionGestureMode:'set',selectionRect:null,clipboard:null,canvasRenderRaf:0,selectionDrag:null
    };
    bindEditor(ed);
    enablePanelControls(ed);
    activeEditor=ed;
    requestAnimationFrame(()=>{modal.focus?.({preventScroll:true});fitEditor(ed);render(ed);});
  }

  const currentFrame = ed => ed.frames[ed.frameIndex];
  const activePixels = ed => currentFrame(ed).pixels;

  function renderTools(ed){
    const basic=ed.modal.querySelector('[data-basic-tools]'), shapes=ed.modal.querySelector('[data-shape-tools]');
    basic.innerHTML='';shapes.innerHTML='';
    [['pencil','pencil','Pencil'],['eraser','eraser','Eraser'],['fill','bucket','Bucket'],['line','line','Line'],['point','point','Point'],['lasso','lasso','Lasso'],['box','rect','Box Select']].forEach(([name,g,label])=>basic.append(toolButton(ed,name,g,label)));
    [['rect','rect','Rect'],['ellipse','circle','Circle'],['triangle','triangle','Triangle']].forEach(([name,g,label])=>shapes.append(toolButton(ed,name,g,label)));
  }
  function toolButton(ed,name,g,label){
    const b=document.createElement('button');b.type='button';b.className='sprite-tool';b.dataset.tool=name;b.innerHTML=`${glyph(g)}<span>${label}</span>`;
    b.addEventListener('click',()=>{
      if(ed.tool==='point' && name!=='point') commitPointPath(ed);
      if(ed.tool==='lasso' && name!=='lasso') clearSelectionPath(ed);if(ed.tool==='box' && name!=='box') ed.selectionRect=null;
      ed.tool=name;ed.ruler=null;render(ed);
    });
    return b;
  }

  function applyPanelState(ed){
    const layout=ed.modal.querySelector('.sprite-editor-layout'),left=ed.modal.querySelector('.sprite-tool-panel'),right=ed.modal.querySelector('.sprite-inspector-panel');
    if(!layout||!left||!right)return;
    const lw=clamp(Number(ed.panelWidths?.left)||190,34,420),rw=clamp(Number(ed.panelWidths?.right)||235,34,420);
    ed.panelWidths={left:lw,right:rw};
    left.classList.toggle('sprite-panel-collapsed',!!ed.leftCollapsed);
    right.classList.toggle('sprite-panel-collapsed',!!ed.rightCollapsed);
    layout.style.setProperty('--sprite-left-width',`${ed.leftCollapsed?34:lw}px`);
    layout.style.setProperty('--sprite-right-width',`${ed.rightCollapsed?34:rw}px`);
    const lb=left.querySelector('[data-sprite-panel-collapse="left"]'),rb=right.querySelector('[data-sprite-panel-collapse="right"]');
    if(lb){lb.textContent=ed.leftCollapsed?'›':'‹';lb.title=ed.leftCollapsed?'Expand':'Collapse';}
    if(rb){rb.textContent=ed.rightCollapsed?'‹':'›';rb.title=ed.rightCollapsed?'Expand':'Collapse';}
    requestAnimationFrame(()=>render(ed));
  }
  function enablePanelControls(ed){
    const modal=ed.modal;if(!modal||modal.dataset.spritePanelControls==='1')return;
    modal.dataset.spritePanelControls='1';let active=null;
    modal.addEventListener('click',e=>{const b=e.target.closest('[data-sprite-panel-collapse]');if(!b)return;e.preventDefault();e.stopPropagation();if(b.dataset.spritePanelCollapse==='left')ed.leftCollapsed=!ed.leftCollapsed;else ed.rightCollapsed=!ed.rightCollapsed;applyPanelState(ed);});
    modal.addEventListener('pointerdown',e=>{const h=e.target.closest('[data-resize-sprite-panel]');if(!h)return;if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();e.stopPropagation();active={side:h.dataset.resizeSpritePanel,startX:e.clientX,left:ed.panelWidths.left,right:ed.panelWidths.right,pointerId:e.pointerId};h.setPointerCapture?.(e.pointerId);document.documentElement.classList.add('resizing-panels');});
    const move=e=>{if(!active||e.pointerId!==active.pointerId)return;e.preventDefault();if(active.side==='left')ed.panelWidths.left=clamp(active.left+(e.clientX-active.startX),34,420);else ed.panelWidths.right=clamp(active.right-(e.clientX-active.startX),34,420);applyPanelState(ed);};
    const end=e=>{if(!active)return;if(e?.pointerId!=null&&e.pointerId!==active.pointerId)return;active=null;document.documentElement.classList.remove('resizing-panels');};
    document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  }

  function bindEditor(ed){
    const q=s=>ed.modal.querySelector(s),canvas=q('[data-sprite-paint]');
    canvas.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();window.UIXApp?.showContextMenu?.([
      {label:'Copy Selection',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('copy','sprite'),disabled:!ed.selection,action:()=>selectionAction(ed,'copy')},
      {label:'Cut Selection',icon:'✂',shortcut:window.UIXKeyBinds?.shortcutFor('cut','sprite'),disabled:!ed.selection,action:()=>selectionAction(ed,'cut')},
      {label:'Paste Selection',icon:'▣',shortcut:window.UIXKeyBinds?.shortcutFor('paste','sprite'),disabled:!ed.clipboard,action:()=>selectionAction(ed,'paste')},
      {label:'Delete Selection',icon:'×',shortcut:window.UIXKeyBinds?.shortcutFor('delete','sprite'),disabled:!ed.selection,action:()=>requestDeleteSelection(ed)},
      {label:'Cancel Selection',icon:'×',shortcut:'',disabled:!ed.selection&&!ed.lassoDrawing&&!ed.lassoPoints.length&&!ed.selectionRect,action:()=>selectionAction(ed,'cancel')},
      {label:'Undo',icon:'↶',shortcut:window.UIXKeyBinds?.shortcutFor('undo','sprite'),disabled:!ed.undo.length,action:()=>spriteAction(ed,'undo')},
      {label:'Redo',icon:'↷',shortcut:window.UIXKeyBinds?.shortcutFor('redo','sprite'),disabled:!ed.redo.length,action:()=>spriteAction(ed,'redo')},
      {label:'Save PNG',icon:'▣',action:()=>saveEditor(ed)},
      {label:'Close',icon:'×',shortcut:window.UIXKeyBinds?.shortcutFor('escape','sprite'),action:()=>closeEditor(ed)}
    ],e.clientX,e.clientY);});
    q('[data-sprite-name]').value=ed.name;
    q('[data-sprite-size]').value=ed.brushSize;
    renderTools(ed);

    q('[data-sprite-size]').addEventListener('input',e=>{ed.brushSize=clamp(Number(e.target.value)||1,1,32);render(ed);});
    q('[data-perfect-shape]').addEventListener('change',e=>{ed.perfectShape=e.target.checked;render(ed);});
    q('[data-sprite-color]').addEventListener('change',()=>{try{ed.color=parseHex(q('[data-sprite-color]').value);syncColor(ed);}catch{q('[data-sprite-color]').value=rgbaToHex(ed.color);}});
    q('[data-sprite-color-swatch]').addEventListener('click',()=>window.UIXApp?.openColorModal?.(rgbaToHex(ed.color),v=>{try{ed.color=parseHex(v);syncColor(ed);render(ed);}catch{}},'Sprite Color'));
    q('[data-sprite-color]').addEventListener('click',()=>window.UIXApp?.openColorModal?.(rgbaToHex(ed.color),v=>{try{ed.color=parseHex(v);syncColor(ed);render(ed);}catch{}},'Sprite Color'));
    q('[data-preview-close]').addEventListener('click',()=>q('[data-preview-card]').classList.add('hidden-preview'));
    q('[data-sprite-name]').addEventListener('input',e=>{ed.name=e.target.value.trim()||'Sprite';render(ed);});
    q('[data-sprite-width]').addEventListener('change',e=>resizeSprite(ed,Number(e.target.value)||currentFrame(ed).width,currentFrame(ed).height));
    q('[data-sprite-height]').addEventListener('change',e=>resizeSprite(ed,currentFrame(ed).width,Number(e.target.value)||currentFrame(ed).height));
    q('[data-sprite-fps]').addEventListener('input',e=>{ed.fps=clamp(Number(e.target.value)||8,1,120);if(ed.playing){stopPlayback(ed);startPlayback(ed);}});
    q('[data-mirror="x"]').addEventListener('click',()=>{if(ed.selection?.mask?.size){flipSelection(ed,'x');render(ed);}else{ed.mirrorX=!ed.mirrorX;render(ed);}});
    q('[data-mirror="y"]').addEventListener('click',()=>{if(ed.selection?.mask?.size){flipSelection(ed,'y');render(ed);}else{ed.mirrorY=!ed.mirrorY;render(ed);}});
    ed.modal.querySelectorAll('[data-sprite-action]').forEach(b=>b.addEventListener('click',()=>spriteAction(ed,b.dataset.spriteAction)));
    ed.modal.querySelectorAll('[data-sprite-selection]').forEach(b=>b.addEventListener('pointerup',e=>{e.preventDefault();e.stopPropagation();selectionAction(ed,b.dataset.spriteSelection);}));
    ed.modal.querySelectorAll('[data-lasso-mode]').forEach(b=>b.addEventListener('pointerup',e=>{e.preventDefault();e.stopPropagation();ed.selectionMode=b.dataset.lassoMode;render(ed);}));
    ed.modal.querySelectorAll('[data-frame-action]').forEach(b=>b.addEventListener('pointerup',e=>{e.preventDefault();e.stopPropagation();frameAction(ed,b.dataset.frameAction);}));
    q('[data-sprite-cancel]').addEventListener('click',()=>{ const close=()=>closeEditor(ed); if(window.UIXApp?.askConfirm) window.UIXApp.askConfirm('Discard changes','Discard the current Sprite Editor changes?',close,'Discard'); else if(window.confirm('Discard the current Sprite Editor changes?')) close(); });
    q('[data-sprite-save]').addEventListener('click',()=>saveEditor(ed));
    ed.modal.tabIndex=0;
    ed.modal.addEventListener('keydown',e=>{
      if(e.key===' '){ed.spacePan=true;e.preventDefault();}
      if(e.key.toLowerCase()==='b'){ed.tool='pencil';render(ed);}
      if(e.key.toLowerCase()==='e'){ed.tool='eraser';render(ed);}
      if(e.key.toLowerCase()==='l'){ed.tool='line';render(ed);}
      if(e.key.toLowerCase()==='g'){ed.tool='fill';render(ed);}
    });
    ed.modal.addEventListener('keyup',e=>{if(e.key===' ')ed.spacePan=false;});

    const strokeFromCell=(cell,erase)=>{
      if(!cell || !ed.drawing)return;
      const key=`${cell.x},${cell.y}`;
      if(key===ed.lastPointerCellKey)return;
      if(ed.lastPaintCell)lineCells(ed.lastPaintCell,cell,(x,y)=>paint(ed,{x,y},erase));
      else paint(ed,cell,erase);
      ed.lastPaintCell=cell;ed.lastPointerCellKey=key;
      renderStatus(ed,cell);scheduleCanvasRender(ed);
    };

    const nearestPoint=(cell)=>{
      let best=-1,bestD=3;
      ed.points.forEach((p,i)=>{const d=Math.hypot(p.x-cell.x,p.y-cell.y);if(d<=bestD){bestD=d;best=i;}});
      return best;
    };
    const handlePointDown=(e,cell)=>{
      const hit=nearestPoint(cell);
      if(e.button===2){if(hit>=0){ed.points.splice(hit,1);render(ed);}return true;}
      if(hit>=0){ed.pointDragIndex=hit;return true;}
      ed.points.push({...cell});render(ed);return true;
    };

    const onPointerDown=e=>{
      if(e.button!==0 && e.button!==2)return;
      e.preventDefault();canvas.setPointerCapture?.(e.pointerId);ed.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(ed.pointers.size>=2){startPinch(ed);return;}
      if(ed.spacePan){ed.panDrag={x:e.clientX,y:e.clientY,px:ed.pan.x,py:ed.pan.y};return;}
      const cell=clientToCell(ed,e.clientX,e.clientY);if(!cell)return;
      if((ed.tool==='lasso'||ed.tool==='box') && ed.selection && pointInSelection(ed,cell) && e.button===0){
        pushUndo(ed);ed.selectionDrag={pointerX:e.clientX,pointerY:e.clientY,dx:0,dy:0,basePixels:clonePixels(currentFrame(ed).pixels),baseSelection:JSON.parse(JSON.stringify({x:ed.selection.x,y:ed.selection.y,width:ed.selection.width,height:ed.selection.height,mask:[...ed.selection.mask],pixels:ed.selection.pixels}))};
        return;
      }
      if(ed.tool==='lasso'){ed.selectionGestureMode=e.altKey?'subtract':(e.shiftKey?'add':(ed.selectionMode||'set'));ed.lassoDrawing=true;ed.lassoPoints=[{...cell}];ed.lastCell=cell;scheduleCanvasRender(ed);return;}
      if(ed.tool==='box'){ed.selectionGestureMode=e.altKey?'subtract':(e.shiftKey?'add':(ed.selectionMode||'set'));ed.selectionRect={a:{...cell},b:{...cell}};scheduleCanvasRender(ed);return;}
      if(ed.tool==='point'){handlePointDown(e,cell);return;}
      if(ed.tool==='fill'){pushUndo(ed);fill(ed,cell);ed.lastCell=cell;renderStatus(ed,cell);render(ed);return;}
      ed.pointerDrawingId=e.pointerId;ed.drawing=true;ed.drawStart=cell;ed.lastCell=cell;ed.lastPaintCell=null;ed.lastPointerCellKey='';
      if(['pencil','eraser'].includes(ed.tool)){pushUndo(ed);strokeFromCell(cell,ed.tool==='eraser');}
      else if(['line','rect','ellipse','triangle'].includes(ed.tool)){render(ed);}
    };

    const processPointerMove=e=>{
      if(ed.pointers.has(e.pointerId))ed.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(ed.pointers.size>=2&&ed.pinch){updatePinch(ed);return;}
      if(ed.panDrag){ed.pan.x=ed.panDrag.px+e.clientX-ed.panDrag.x;ed.pan.y=ed.panDrag.py+e.clientY-ed.panDrag.y;scheduleCanvasRender(ed);return;}
      if(ed.selectionDrag && ed.selectionDrag.baseSelection){
        const c=clientToCell(ed,e.clientX,e.clientY);if(c){
          const dx=Math.round((e.clientX-ed.selectionDrag.pointerX)/ed.zoom),dy=Math.round((e.clientY-ed.selectionDrag.pointerY)/ed.zoom);
          const bs=ed.selectionDrag.baseSelection,sel=ed.selection;
          const nx=clamp(bs.x+dx,0,Math.max(0,currentFrame(ed).width-bs.width)),ny=clamp(bs.y+dy,0,Math.max(0,currentFrame(ed).height-bs.height));
          const f=currentFrame(ed);f.pixels=clonePixels(ed.selectionDrag.basePixels);for(const key of bs.mask){const [ox,oy]=key.split(',').map(Number);if(ox>=0&&oy>=0&&ox<f.width&&oy<f.height)f.pixels[oy][ox]=transparent();}const newMask=new Set(),newPix=makePixels(bs.width,bs.height);
          for(const key of bs.mask){const [x,y]=key.split(',').map(Number),tx=x+(nx-bs.x),ty=y+(ny-bs.y);if(tx<0||ty<0||tx>=f.width||ty>=f.height)continue;newMask.add(`${tx},${ty}`);const p=bs.pixels[y-bs.y][x-bs.x];newPix[ty-ny][tx-nx]=[...p];f.pixels[ty][tx]=[...p];}
          ed.selection={x:nx,y:ny,width:bs.width,height:bs.height,mask:newMask,pixels:newPix};ed.selectionDrag.dx=nx-bs.x;ed.selectionDrag.dy=ny-bs.y;invalidateCache(f);ensureFrameCache(f);scheduleCanvasRender(ed);
        }return;
      }
      if(ed.tool==='point' && ed.pointDragIndex>=0){const c=clientToCell(ed,e.clientX,e.clientY);if(c){ed.points[ed.pointDragIndex]={...c};ed.lastCell=c;renderStatus(ed,c);scheduleCanvasRender(ed);}return;}
      if(ed.tool==='lasso' && ed.lassoDrawing){const c=clientToCell(ed,e.clientX,e.clientY);if(c){const last=ed.lassoPoints.at(-1);if(!last || Math.hypot(c.x-last.x,c.y-last.y)>=1){ed.lassoPoints.push({...c});ed.lastCell=c;scheduleCanvasRender(ed);} }return;}
      if(ed.tool==='box'&&ed.selectionRect){const c=clientToCell(ed,e.clientX,e.clientY);if(c){ed.selectionRect.b={...c};ed.lastCell=c;scheduleCanvasRender(ed);}return;}
      if(ed.pointerDrawingId!==e.pointerId || !ed.drawing)return;
      const events=e.getCoalescedEvents?.() || [e];
      for(const ev of events){const cell=clientToCell(ed,ev.clientX,ev.clientY);if(!cell)continue;ed.lastCell=cell;if(ed.tool==='pencil')strokeFromCell(cell,false);else if(ed.tool==='eraser')strokeFromCell(cell,true);else if(['line','rect','ellipse','triangle'].includes(ed.tool))scheduleCanvasRender(ed);}
    };

    const onPointerMove=e=>{e.preventDefault();processPointerMove(e);};

    const onPointerUp=e=>{
      const hadTwo=ed.pointers.size>=2;ed.pointers.delete(e.pointerId);
      if(hadTwo){if(ed.pointers.size<2)ed.pinch=null;return;}
      if(ed.panDrag){ed.panDrag=null;return;}
      if(ed.selectionDrag){commitSelectionDrag(ed,false);return;}
      if(ed.tool==='point' && ed.pointDragIndex>=0){ed.pointDragIndex=-1;return;}
      if(ed.tool==='lasso' && ed.lassoDrawing){ed.lassoDrawing=false;finishLasso(ed);ed.pointerDrawingId=null;ed.drawing=false;return;}
      if(ed.tool==='box'&&ed.selectionRect){const r=ed.selectionRect;ed.selectionRect=null;finishBoxSelect(ed,r);ed.pointerDrawingId=null;ed.drawing=false;return;}
      if(ed.pointerDrawingId!==e.pointerId)return;
      const cell=clientToCell(ed,e.clientX,e.clientY) || ed.lastCell;
      if(ed.drawing && cell && ed.drawStart && ['line','rect','ellipse','triangle'].includes(ed.tool)){
        pushUndo(ed);
        const end=constrainShapeEnd(ed,ed.drawStart,cell,ed.tool);
        if(ed.tool==='line')lineCells(ed.drawStart,end,(x,y)=>paint(ed,{x,y},false));
        if(ed.tool==='rect')rectCells(ed.drawStart,end,(x,y)=>paint(ed,{x,y},false));
        if(ed.tool==='ellipse')ellipseCells(ed.drawStart,end,(x,y)=>paint(ed,{x,y},false));
        if(ed.tool==='triangle')triangleCells(ed.drawStart,end,(x,y)=>paint(ed,{x,y},false));
      }
      ed.drawing=false;ed.pointerDrawingId=null;ed.drawStart=null;ed.lastCell=cell;ed.lastPaintCell=null;ed.lastPointerCellKey='';render(ed);
    };

    canvas.addEventListener('pointerdown',onPointerDown,{passive:false});
    canvas.addEventListener('pointermove',onPointerMove,{passive:false});
    canvas.addEventListener('pointerup',onPointerUp,{passive:false});
    canvas.addEventListener('pointercancel',onPointerUp,{passive:false});
    canvas.addEventListener('wheel',e=>{e.preventDefault();zoomAt(ed,e.clientX,e.clientY,Math.exp(-e.deltaY*.0015));},{passive:false});
    const ro=new ResizeObserver(()=>render(ed));ro.observe(q('[data-sprite-canvas-wrap]'));ed.modal._resizeObserver=ro;
    syncColor(ed);render(ed);
  }

  function startPinch(ed){
    const arr=[...ed.pointers.values()];if(arr.length<2)return;
    const mid=midpoint(arr[0],arr[1]);
    ed.pinch={lastDistance:Math.max(1,distance(arr[0],arr[1])),lastMidX:mid.x,lastMidY:mid.y};
    ed.panDrag=null;ed.drawing=false;ed.pointerDrawingId=null;
  }
  function updatePinch(ed){
    const arr=[...ed.pointers.values()];if(arr.length<2||!ed.pinch)return;
    const mid=midpoint(arr[0],arr[1]),dist=Math.max(1,distance(arr[0],arr[1])),wrap=ed.modal.querySelector('[data-sprite-canvas-wrap]').getBoundingClientRect();
    const anchorWorld=screenToWorld(ed,ed.pinch.lastMidX,ed.pinch.lastMidY);
    ed.zoom=clamp(ed.zoom*(dist/ed.pinch.lastDistance),1,96);
    ed.pan.x=(mid.x-wrap.left-wrap.width/2)-anchorWorld.x*ed.zoom;
    ed.pan.y=(mid.y-wrap.top-wrap.height/2)-anchorWorld.y*ed.zoom;
    ed.pinch.lastDistance=dist;ed.pinch.lastMidX=mid.x;ed.pinch.lastMidY=mid.y;
    scheduleCanvasRender(ed);
  }
  function screenToWorld(ed,cx,cy){const r=ed.modal.querySelector('[data-sprite-canvas-wrap]').getBoundingClientRect();return{x:(cx-r.left-r.width/2-ed.pan.x)/ed.zoom,y:(cy-r.top-r.height/2-ed.pan.y)/ed.zoom};}
  function clientToCell(ed,cx,cy){const f=currentFrame(ed),w=screenToWorld(ed,cx,cy),x=Math.floor(w.x+f.width/2),y=Math.floor(w.y+f.height/2);return x>=0&&y>=0&&x<f.width&&y<f.height?{x,y}:null;}
  function zoomAt(ed,cx,cy,factor){const before=screenToWorld(ed,cx,cy);ed.zoom=clamp(ed.zoom*factor,1,96);const r=ed.modal.querySelector('[data-sprite-canvas-wrap]').getBoundingClientRect();ed.pan.x=cx-r.left-r.width/2-before.x*ed.zoom;ed.pan.y=cy-r.top-r.height/2-before.y*ed.zoom;scheduleCanvasRender(ed);renderStatus(ed,ed.lastCell);}
  function fitEditor(ed){const wrap=ed.modal.querySelector('[data-sprite-canvas-wrap]');if(!wrap)return;const f=currentFrame(ed);const fit=Math.min((wrap.clientWidth*.72)/Math.max(1,f.width),(wrap.clientHeight*.72)/Math.max(1,f.height));ed.zoom=clamp(Math.max(2,Math.floor(fit)),2,96);ed.pan.x=0;ed.pan.y=0;}

  function pushUndo(ed){ed.undo.push(clonePixels(activePixels(ed)));if(ed.undo.length>100)ed.undo.shift();ed.redo=[];}
  function frameCache(f){return f.__cache || (f.__cache={canvas:null,ctx:null});}
  function invalidateCache(f){if(f&&f.__cache){f.__cache.canvas=null;f.__cache.ctx=null;}}
  function ensureFrameCache(f){
    const cache=frameCache(f);
    if(cache.canvas && cache.canvas.width===f.width && cache.canvas.height===f.height)return cache;
    const canvas=document.createElement('canvas');canvas.width=f.width;canvas.height=f.height;
    const ctx=canvas.getContext('2d',{alpha:true});ctx.imageSmoothingEnabled=false;
    const image=ctx.createImageData(f.width,f.height);
    let p=0;
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const px=f.pixels[y][x];image.data[p++]=px[0];image.data[p++]=px[1];image.data[p++]=px[2];image.data[p++]=px[3];}
    ctx.putImageData(image,0,0);cache.canvas=canvas;cache.ctx=ctx;return cache;
  }
  function updateCachePixel(f,x,y,pixel){
    const cache=ensureFrameCache(f);
    if(pixel[3]===0)cache.ctx.clearRect(x,y,1,1);else{cache.ctx.fillStyle=cssRgba(pixel);cache.ctx.fillRect(x,y,1,1);}
  }
  function applyPixel(ed,x,y,erase){const f=currentFrame(ed);if(x<0||y<0||x>=f.width||y>=f.height)return;const pixel=erase?transparent():[...ed.color];f.pixels[y][x]=pixel;updateCachePixel(f,x,y,pixel);}
  function paint(ed,cell,erase){const f=currentFrame(ed),rad=Math.max(1,Math.floor(ed.brushSize)),off=Math.floor(rad/2);for(let yy=0;yy<rad;yy++)for(let xx=0;xx<rad;xx++){const x=cell.x+xx-off,y=cell.y+yy-off;const xs=[x],ys=[y];if(ed.mirrorX)xs.push(f.width-1-x);if(ed.mirrorY)ys.push(f.height-1-y);for(const a of xs)for(const b of ys)applyPixel(ed,a,b,erase);}}
  function lineCells(a,b,fn){let x0=a.x,y0=a.y,x1=b.x,y1=b.y,dx=Math.abs(x1-x0),sx=x0<x1?1:-1,dy=-Math.abs(y1-y0),sy=y0<y1?1:-1,err=dx+dy;for(;;){fn(x0,y0);if(x0===x1&&y0===y1)break;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}}
  function rectCells(a,b,fn){const l=Math.min(a.x,b.x),r=Math.max(a.x,b.x),t=Math.min(a.y,b.y),bot=Math.max(a.y,b.y);for(let x=l;x<=r;x++){fn(x,t);fn(x,bot);}for(let y=t;y<=bot;y++){fn(l,y);fn(r,y);}}
  function ellipseCells(a,b,fn){const cx=(a.x+b.x)/2,cy=(a.y+b.y)/2,rx=Math.abs(b.x-a.x)/2,ry=Math.abs(b.y-a.y)/2,steps=Math.max(16,Math.ceil(Math.PI*2*Math.max(rx,ry)*3));for(let i=0;i<=steps;i++){const t=i/steps*Math.PI*2;fn(Math.round(cx+Math.cos(t)*rx),Math.round(cy+Math.sin(t)*ry));}}
  function triangleCells(a,b,fn){const l=Math.min(a.x,b.x),r=Math.max(a.x,b.x),t=Math.min(a.y,b.y),bot=Math.max(a.y,b.y),v1={x:Math.round((l+r)/2),y:t},v2={x:l,y:bot},v3={x:r,y:bot};lineCells(v1,v2,fn);lineCells(v1,v3,fn);lineCells(v2,v3,fn);}
  function fill(ed,start){const f=currentFrame(ed),target=[...f.pixels[start.y][start.x]],next=[...ed.color];if(samePixel(target,next))return;const stack=[start],seen=new Set();while(stack.length){const p=stack.pop(),key=p.x+','+p.y;if(seen.has(key)||p.x<0||p.y<0||p.x>=f.width||p.y>=f.height||!samePixel(f.pixels[p.y][p.x],target))continue;seen.add(key);f.pixels[p.y][p.x]=[...next];stack.push({x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1});}invalidateCache(f);ensureFrameCache(f);}

  function constrainShapeEnd(ed,a,b,tool){
    if(!ed.perfectShape || !['rect','ellipse','triangle'].includes(tool))return {...b};
    const dx=b.x-a.x,dy=b.y-a.y,size=Math.max(Math.abs(dx),Math.abs(dy));
    return {x:a.x+(dx<0?-size:size),y:a.y+(dy<0?-size:size)};
  }
  function shapeCells(tool,a,b,perfect){
    const end=perfect&&['rect','ellipse','triangle'].includes(tool)?constrainShapeEnd({perfectShape:true},a,b,tool):b;
    const out=new Set(),add=(x,y)=>{if(Number.isFinite(x)&&Number.isFinite(y))out.add(`${Math.round(x)},${Math.round(y)}`);};
    if(tool==='line')lineCells(a,end,add);
    else if(tool==='rect')rectCells(a,end,add);
    else if(tool==='ellipse')ellipseCells(a,end,add);
    else if(tool==='triangle')triangleCells(a,end,add);
    return [...out].map(k=>{const [x,y]=k.split(',').map(Number);return{x,y};});
  }
  function drawPreviewCells(ctx,f,ed,cells,color=ed.color){const ox=-f.width/2,oy=-f.height/2,rad=Math.max(1,Math.floor(ed.brushSize)),off=Math.floor(rad/2);const set=new Set();const add=(x,y)=>{if(x<0||y<0||x>=f.width||y>=f.height)return;set.add(`${x},${y}`);};for(const p of cells)for(let yy=0;yy<rad;yy++)for(let xx=0;xx<rad;xx++){const x=p.x+xx-off,y=p.y+yy-off;add(x,y);if(ed.mirrorX)add(f.width-1-x,y);if(ed.mirrorY)add(x,f.height-1-y);if(ed.mirrorX&&ed.mirrorY)add(f.width-1-x,f.height-1-y);}ctx.fillStyle=cssRgba(color);for(const key of set){const [x,y]=key.split(',').map(Number);ctx.fillRect(x+ox,y+oy,1,1);}}
  function commitPointPath(ed){
    if(ed.points.length===0)return;
    pushUndo(ed);const pts=ed.points.slice();for(let i=0;i<pts.length;i++){paint(ed,pts[i],false);if(i>0)lineCells(pts[i-1],pts[i],(x,y)=>paint(ed,{x,y},false));}ed.points=[];ed.pointDragIndex=-1;render(ed);
  }

  function moveSelectionPixels(ed,dx,dy){
    const f=currentFrame(ed),sel=ed.selection;if(!sel||!sel.mask?.size)return;
    dx=Math.round(dx);dy=Math.round(dy);
    const maxX=f.width-sel.width,maxY=f.height-sel.height;
    const nx=clamp(sel.x+dx,0,Math.max(0,maxX)),ny=clamp(sel.y+dy,0,Math.max(0,maxY));
    ed.selectionDrag={dx:nx-sel.x,dy:ny-sel.y,basePixels:clonePixels(f.pixels),baseX:sel.x,baseY:sel.y};
    f.pixels=clonePixels(ed.selectionDrag.basePixels);
    for(const key of sel.mask){const [x,y]=key.split(',').map(Number);if(x>=0&&y>=0&&x<f.width&&y<f.height)f.pixels[y][x]=transparent();}
    const nextMask=new Set();const nextPix=makePixels(sel.width,sel.height);
    for(const key of sel.mask){const [x,y]=key.split(',').map(Number),tx=x+(nx-sel.x),ty=y+(ny-sel.y);if(tx<0||ty<0||tx>=f.width||ty>=f.height)continue;nextMask.add(`${tx},${ty}`);nextPix[ty-ny][tx-nx]=[...sel.pixels[y-sel.y][x-sel.x]];f.pixels[ty][tx]=[...sel.pixels[y-sel.y][x-sel.x]];}
    sel.x=nx;sel.y=ny;sel.mask=nextMask;sel.pixels=nextPix;invalidateCache(f);ensureFrameCache(f);
  }
  function flipSelection(ed,axis){
    const f=currentFrame(ed),sel=ed.selection;if(!sel?.mask?.size)return false;
    pushUndo(ed);
    const oldMask=new Set(sel.mask),oldPix=clonePixels(sel.pixels),newMask=new Set(),newPix=makePixels(sel.width,sel.height);
    for(const key of oldMask){const [x,y]=key.split(',').map(Number),lx=x-sel.x,ly=y-sel.y,nx=axis==='x'?sel.x+sel.width-1-lx:x,ny=axis==='y'?sel.y+sel.height-1-ly:y;newMask.add(`${nx},${ny}`);newPix[ny-sel.y][nx-sel.x]=[...oldPix[ly][lx]];}
    for(const key of oldMask){const [x,y]=key.split(',').map(Number);f.pixels[y][x]=transparent();}
    for(const key of newMask){const [x,y]=key.split(',').map(Number);f.pixels[y][x]=[...newPix[y-sel.y][x-sel.x]];}
    sel.mask=newMask;sel.pixels=newPix;invalidateCache(f);ensureFrameCache(f);return true;
  }
  function rotateSelection(ed){
    const f=currentFrame(ed),sel=ed.selection;if(!sel?.mask?.size)return false;
    pushUndo(ed);const oldMask=new Set(sel.mask),oldPix=clonePixels(sel.pixels),nw=sel.height,nh=sel.width,newPix=makePixels(nw,nh),newMask=new Set();
    for(const key of oldMask){const [x,y]=key.split(',').map(Number),lx=x-sel.x,ly=y-sel.y,nx=sel.x+(sel.height-1-ly),ny=sel.y+lx;newMask.add(`${nx},${ny}`);newPix[ny-sel.y][nx-sel.x]=[...oldPix[ly][lx]];}
    for(const key of oldMask){const [x,y]=key.split(',').map(Number);f.pixels[y][x]=transparent();}
    const maxX=f.width-nw,maxY=f.height-nh;const ox=clamp(sel.x,0,Math.max(0,maxX)),oy=clamp(sel.y,0,Math.max(0,maxY));
    const finalMask=new Set(),finalPix=makePixels(nw,nh);
    for(const key of newMask){const [x,y]=key.split(',').map(Number),tx=x+(ox-sel.x),ty=y+(oy-sel.y);if(tx<0||ty<0||tx>=f.width||ty>=f.height)continue;finalMask.add(`${tx},${ty}`);finalPix[ty-oy][tx-ox]=[...newPix[y-sel.y][x-sel.x]];f.pixels[ty][tx]=[...newPix[y-sel.y][x-sel.x]];}
    sel.x=ox;sel.y=oy;sel.width=nw;sel.height=nh;sel.mask=finalMask;sel.pixels=finalPix;invalidateCache(f);ensureFrameCache(f);return true;
  }
  function spriteAction(ed,a){const f=currentFrame(ed);
    if(a==='grid'){ed.showGrid=!ed.showGrid;return render(ed);}
    if(a==='center'){fitEditor(ed);return render(ed);}
    if(a==='clear'){pushUndo(ed);f.pixels=makePixels(f.width,f.height);invalidateCache(f);return render(ed);}
    if(a==='undo'){if(ed.undo.length){ed.redo.push(clonePixels(f.pixels));f.pixels=ed.undo.pop();invalidateCache(f);}return render(ed);}
    if(a==='redo'){if(ed.redo.length){ed.undo.push(clonePixels(f.pixels));f.pixels=ed.redo.pop();invalidateCache(f);}return render(ed);}
    if(a==='flipx'){if(ed.selection?.mask?.size?flipSelection(ed,'x'):(pushUndo(ed),f.pixels=f.pixels.map(row=>[...row].reverse()),invalidateCache(f),false))return render(ed);return render(ed);}
    if(a==='flipy'){if(ed.selection?.mask?.size?flipSelection(ed,'y'):(pushUndo(ed),f.pixels=[...f.pixels].reverse(),invalidateCache(f),false))return render(ed);return render(ed);}
    if(a==='rotate'){if(ed.selection?.mask?.size)rotateSelection(ed);else{pushUndo(ed);const next=makePixels(f.height,f.width);for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)next[x][f.height-1-y]=[...f.pixels[y][x]];f.pixels=next;[f.width,f.height]=[f.height,f.width];invalidateCache(f);syncFrameFields(ed);fitEditor(ed);}return render(ed);}
  }

  function frameAction(ed,a){
    if(a==='copy'){const f=currentFrame(ed);const copy={name:f.name,width:f.width,height:f.height,pixels:clonePixels(f.pixels),sourceAsset:null};ed.frames.splice(ed.frameIndex+1,0,copy);ed.frameIndex++;ed.undo=[];ed.redo=[];return render(ed);}
    if(a==='add'){const f=currentFrame(ed);const blank={name:ed.name,width:f.width,height:f.height,pixels:makePixels(f.width,f.height),sourceAsset:null};ed.frames.splice(ed.frameIndex+1,0,blank);ed.frameIndex++;ed.undo=[];ed.redo=[];return render(ed);}
    if(a==='prev')return selectFrame(ed,ed.frameIndex-1<0?ed.frames.length-1:ed.frameIndex-1);
    if(a==='next')return selectFrame(ed,(ed.frameIndex+1)%ed.frames.length);
    if(a==='play'){ed.playing?stopPlayback(ed):startPlayback(ed);}
  }
  function selectFrame(ed,i){ed.frameIndex=clamp(i,0,ed.frames.length-1);ed.undo=[];ed.redo=[];fitEditor(ed);render(ed);}
  function deleteFrame(ed,i){if(ed.frames.length===1)return;const remove=ed.frames[i];const doDelete=()=>{ed.frames.splice(i,1);ed.frameIndex=clamp(ed.frameIndex,0,ed.frames.length-1);ed.undo=[];ed.redo=[];fitEditor(ed);render(ed);};if(window.UIXApp?.askConfirm)window.UIXApp.askConfirm('Delete Frame',`Delete Frame ${i+1}?`,doDelete,'Delete');else if(confirm(`Delete Frame ${i+1}?`))doDelete();}
  function moveFrame(ed,from,to){if(from===to||from<0||to<0||from>=ed.frames.length||to>=ed.frames.length)return;const [f]=ed.frames.splice(from,1);ed.frames.splice(to,0,f);ed.frameIndex=to;render(ed);}
  function startPlayback(ed){if(ed.frames.length<2)return;ed.playing=true;render(ed);const tick=()=>{if(!ed.playing)return;ed.frameIndex=(ed.frameIndex+1)%ed.frames.length;render(ed);ed.playTimer=setTimeout(tick,Math.max(8,1000/ed.fps));};ed.playTimer=setTimeout(tick,Math.max(8,1000/ed.fps));}
  function stopPlayback(ed){ed.playing=false;if(ed.playTimer){clearTimeout(ed.playTimer);ed.playTimer=null;}render(ed);}

  function resizeSprite(ed,w,h){const f=currentFrame(ed);w=clamp(Math.floor(w)||f.width,1,MAX_SIZE);h=clamp(Math.floor(h)||f.height,1,MAX_SIZE);pushUndo(ed);const next=makePixels(w,h);for(let y=0;y<Math.min(h,f.height);y++)for(let x=0;x<Math.min(w,f.width);x++)next[y][x]=[...f.pixels[y][x]];f.width=w;f.height=h;f.pixels=next;invalidateCache(f);syncFrameFields(ed);fitEditor(ed);render(ed);}

  function drawChecker(ctx,w,h,size=12){for(let y=0;y<h;y+=size)for(let x=0;x<w;x+=size){ctx.fillStyle=((x/size+y/size)&1)?'#2a2a2a':'#333';ctx.fillRect(x,y,size,size);}}
  function drawFrame(ctx,f,ed){ctx.imageSmoothingEnabled=false;const x0=-f.width/2,y0=-f.height/2;const cache=ensureFrameCache(f);ctx.drawImage(cache.canvas,x0,y0);if(ed.showGrid&&ed.zoom>=4){ctx.strokeStyle='rgba(150,150,150,.22)';ctx.lineWidth=1/ed.zoom;ctx.beginPath();for(let x=0;x<=f.width;x++){const xx=x0+x;ctx.moveTo(xx,y0);ctx.lineTo(xx,y0+f.height);}for(let y=0;y<=f.height;y++){const yy=y0+y;ctx.moveTo(x0,yy);ctx.lineTo(x0+f.width,yy);}ctx.stroke();}ctx.strokeStyle='rgba(220,220,220,.75)';ctx.lineWidth=1/ed.zoom;ctx.strokeRect(x0,y0,f.width,f.height);}
  function previewShape(ctx,ed,a,b){if(!a||!b)return;const f=currentFrame(ed),color='rgba(230,198,80,.95)';ctx.strokeStyle=color;ctx.lineWidth=1/ed.zoom;const ox=-f.width/2,oy=-f.height/2;if(ed.tool==='line'){ctx.beginPath();ctx.moveTo(a.x+ox+.5,a.y+oy+.5);ctx.lineTo(b.x+ox+.5,b.y+oy+.5);ctx.stroke();return;}if(ed.tool==='rect'){ctx.strokeRect(Math.min(a.x,b.x)+ox,Math.min(a.y,b.y)+oy,Math.abs(a.x-b.x)+1,Math.abs(a.y-b.y)+1);return;}if(ed.tool==='ellipse'){const cx=(a.x+b.x)/2+ox+.5,cy=(a.y+b.y)/2+oy+.5,rx=Math.abs(b.x-a.x)/2+.5,ry=Math.abs(b.y-a.y)/2+.5;ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.stroke();return;}if(ed.tool==='triangle'){const l=Math.min(a.x,b.x),r=Math.max(a.x,b.x),t=Math.min(a.y,b.y),bot=Math.max(a.y,b.y);ctx.beginPath();ctx.moveTo((l+r)/2+ox+.5,t+oy+.5);ctx.lineTo(l+ox+.5,bot+oy+.5);ctx.lineTo(r+ox+.5,bot+oy+.5);ctx.closePath();ctx.stroke();}}

  function scheduleCanvasRender(ed){
    if(ed.canvasRenderRaf)return;
    ed.canvasRenderRaf=requestAnimationFrame(()=>{ed.canvasRenderRaf=0;renderCanvasOnly(ed);});
  }
  function pointInPolygon(x,y,pts){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const xi=pts[i].x,yi=pts[i].y,xj=pts[j].x,yj=pts[j].y;const intersect=((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/((yj-yi)||1e-9)+xi);if(intersect)inside=!inside;}return inside;}
  function selectionPixels(ed,pts){const f=currentFrame(ed);if(!pts||pts.length<3)return null;let minX=f.width-1,minY=f.height-1,maxX=0,maxY=0;pts.forEach(p=>{minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);});minX=clamp(minX,0,f.width-1);minY=clamp(minY,0,f.height-1);maxX=clamp(maxX,0,f.width-1);maxY=clamp(maxY,0,f.height-1);const w=maxX-minX+1,h=maxY-minY+1,pix=makePixels(w,h),mask=new Set();for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){if(pointInPolygon(x+.5,y+.5,pts)){mask.add(`${x},${y}`);pix[y-minY][x-minX]=[...f.pixels[y][x]];}}return {x:minX,y:minY,width:w,height:h,pixels:pix,mask};}
  function pointInSelection(ed,c){const sel=ed.selection;if(!sel?.mask?.size)return false;const dx=ed.selectionDrag?.dx||0,dy=ed.selectionDrag?.dy||0;return sel.mask.has(`${c.x-dx},${c.y-dy}`);}
  function commitSelectionDrag(ed,cancel=false){
    const f=currentFrame(ed),d=ed.selectionDrag;if(!d||!d.baseSelection)return;
    if(cancel){f.pixels=clonePixels(d.basePixels);const bs=d.baseSelection;ed.selection={x:bs.x,y:bs.y,width:bs.width,height:bs.height,mask:new Set(bs.mask),pixels:bs.pixels};}
    else {ed.selectionDrag=null;}
    invalidateCache(f);ensureFrameCache(f);ed.selectionDrag=null;render(ed);
  }
  function selectionFromMask(ed,mask){const f=currentFrame(ed);if(!mask?.size)return null;let minX=f.width,maxX=-1,minY=f.height,maxY=-1;for(const key of mask){const [x,y]=key.split(',').map(Number);if(x<0||y<0||x>=f.width||y>=f.height)continue;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}if(maxX<minX||maxY<minY)return null;const width=maxX-minX+1,height=maxY-minY+1,pixels=makePixels(width,height);for(const key of mask){const [x,y]=key.split(',').map(Number);if(x>=minX&&x<=maxX&&y>=minY&&y<=maxY)pixels[y-minY][x-minX]=[...f.pixels[y][x]];}return{x:minX,y:minY,width,height,pixels,mask:new Set(mask)};}
  function combineSelection(ed,next){if(!next)return null;const mode=ed.selectionMode||'set';if(mode==='set'||!ed.selection?.mask?.size)return next;const out=new Set(ed.selection.mask);if(mode==='add')for(const k of next.mask)out.add(k);else if(mode==='subtract')for(const k of next.mask)out.delete(k);return selectionFromMask(ed,out);}
  function finishLasso(ed){const prev=ed.selectionMode,mode=ed.selectionGestureMode||prev;const next=selectionPixels(ed,ed.lassoPoints);ed.selectionMode=mode;ed.selection=combineSelection(ed,next);ed.selectionMode=prev;ed.selectionGestureMode=prev;ed.lassoPoints=[];ed.pointDragIndex=-1;render(ed);}
  function selectionRectPixels(ed,rect){const f=currentFrame(ed);const minX=clamp(Math.min(rect.a.x,rect.b.x),0,f.width-1),maxX=clamp(Math.max(rect.a.x,rect.b.x),0,f.width-1),minY=clamp(Math.min(rect.a.y,rect.b.y),0,f.height-1),maxY=clamp(Math.max(rect.a.y,rect.b.y),0,f.height-1);const mask=new Set();for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)mask.add(`${x},${y}`);return selectionFromMask(ed,mask);}
  function finishBoxSelect(ed,rect){const prev=ed.selectionMode,mode=ed.selectionGestureMode||prev;ed.selectionMode=mode;ed.selection=combineSelection(ed,selectionRectPixels(ed,rect));ed.selectionMode=prev;ed.selectionGestureMode=prev;render(ed);}
  function clearSelectionPath(ed){ed.lassoPoints=[];ed.lassoDrawing=false;}
  function selectionAction(ed,a){const sel=ed.selection,f=currentFrame(ed);if(a==='cancel'){ed.lassoPoints=[];ed.lassoDrawing=false;ed.selectionRect=null;ed.selection=null;ed.selectionDrag=null;ed.selectionMode='set';ed.selectionGestureMode='set';render(ed);return;}if(a==='copy'){if(!sel)return;ed.clipboard={width:sel.width,height:sel.height,pixels:clonePixels(sel.pixels)};render(ed);return;}if(a==='cut'){if(!sel)return;pushUndo(ed);for(const key of sel.mask){const [x,y]=key.split(',').map(Number);f.pixels[y][x]=transparent();updateCachePixel(f,x,y,f.pixels[y][x]);}invalidateCache(f);ensureFrameCache(f);ed.clipboard={width:sel.width,height:sel.height,pixels:clonePixels(sel.pixels)};ed.selection=null;render(ed);return;}if(a==='paste'){if(!ed.clipboard)return;pushUndo(ed);const center=ed.lastCell||{x:Math.floor(f.width/2),y:Math.floor(f.height/2)};const ox=Math.round(center.x-ed.clipboard.width/2),oy=Math.round(center.y-ed.clipboard.height/2);for(let y=0;y<ed.clipboard.height;y++)for(let x=0;x<ed.clipboard.width;x++){const p=ed.clipboard.pixels[y][x],tx=ox+x,ty=oy+y;if(tx>=0&&ty>=0&&tx<f.width&&ty<f.height){f.pixels[ty][tx]=[...p];updateCachePixel(f,tx,ty,p);}}ed.selection=null;render(ed);}}
  function renderCanvasOnly(ed){
    const q=s=>ed.modal.querySelector(s),canvas=q('[data-sprite-paint]'),wrap=q('[data-sprite-canvas-wrap]');if(!canvas||!wrap)return;
    const r=wrap.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(1,r.width),h=Math.max(1,r.height),pw=Math.max(1,Math.floor(w*dpr)),ph=Math.max(1,Math.floor(h*dpr));
    if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);drawChecker(ctx,w,h,12);
    const f=currentFrame(ed);ctx.save();ctx.translate(w/2+ed.pan.x,h/2+ed.pan.y);ctx.scale(ed.zoom,ed.zoom);drawFrame(ctx,f,ed);
    if(ed.drawing&&ed.drawStart&&ed.lastCell&&['line','rect','ellipse','triangle'].includes(ed.tool)){const end=constrainShapeEnd(ed,ed.drawStart,ed.lastCell,ed.tool);drawPreviewCells(ctx,f,ed,shapeCells(ed.tool,ed.drawStart,end,ed.perfectShape));}
    if(ed.tool==='point'&&ed.points.length){const pts=ed.points;for(let i=1;i<pts.length;i++)drawPreviewCells(ctx,f,ed,[...shapeCells('line',pts[i-1],pts[i],false)]);drawPreviewCells(ctx,f,ed,pts);}
    if(ed.tool==='box'&&ed.selectionRect){const a=ed.selectionRect.a,b=ed.selectionRect.b,ox=-f.width/2,oy=-f.height/2;ctx.strokeStyle='rgba(220,210,120,.95)';ctx.lineWidth=1/ed.zoom;ctx.setLineDash([3/ed.zoom,3/ed.zoom]);ctx.strokeRect(Math.min(a.x,b.x)+ox,Math.min(a.y,b.y)+oy,Math.abs(a.x-b.x)+1,Math.abs(a.y-b.y)+1);ctx.setLineDash([]);}
    if(ed.tool==='lasso'&&ed.lassoPoints.length){ctx.strokeStyle='rgba(220,210,120,.95)';ctx.lineWidth=1/ed.zoom;ctx.setLineDash([3/ed.zoom,3/ed.zoom]);ctx.beginPath();ed.lassoPoints.forEach((p,i)=>i?ctx.lineTo(p.x-f.width/2+.5,p.y-f.height/2+.5):ctx.moveTo(p.x-f.width/2+.5,p.y-f.height/2+.5));ctx.stroke();ctx.setLineDash([]);}
    if(ed.selection?.mask?.size){
      const s=ed.selection;
      const mask=s.mask;
      ctx.strokeStyle='rgba(230,205,90,.98)';ctx.lineWidth=1/ed.zoom;ctx.setLineDash([]);
      ctx.beginPath();
      for(const key of mask){
        const [mx,my]=key.split(',').map(Number),x=mx-f.width/2,y=my-f.height/2;
        const inside=(xx,yy)=>mask.has(`${xx},${yy}`);
        if(!inside(mx+1,my)) {ctx.moveTo(x+1,y);ctx.lineTo(x+1,y+1);}
        if(!inside(mx-1,my)) {ctx.moveTo(x,y);ctx.lineTo(x,y+1);}
        if(!inside(mx,my+1)) {ctx.moveTo(x,y+1);ctx.lineTo(x+1,y+1);}
        if(!inside(mx,my-1)) {ctx.moveTo(x,y);ctx.lineTo(x+1,y);}
      }
      ctx.stroke();
      const dx=ed.selectionDrag?.dx||0,dy=ed.selectionDrag?.dy||0;const bx=s.x+dx-f.width/2,by=s.y+dy-f.height/2;
      ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=1/ed.zoom;ctx.strokeRect(bx-.5,by-.5,s.width,s.height);
      const hs=Math.max(2.5/ed.zoom,1.5/ed.zoom);ctx.fillStyle='rgba(230,205,90,.98)';
      [[bx,by],[bx+s.width,by],[bx,by+s.height],[bx+s.width,by+s.height]].forEach(([hx,hy])=>ctx.fillRect(hx-hs/2,hy-hs/2,hs,hs));
      if(ed.selectionDrag){
        ctx.strokeStyle='rgba(230,205,90,.7)';ctx.lineWidth=1/ed.zoom;ctx.beginPath();ctx.moveTo(bx+s.width/2,by-6/ed.zoom);ctx.lineTo(bx+s.width/2,by-2/ed.zoom);ctx.moveTo(bx+s.width/2,by+s.height+2/ed.zoom);ctx.lineTo(bx+s.width/2,by+s.height+6/ed.zoom);ctx.moveTo(bx-6/ed.zoom,by+s.height/2);ctx.lineTo(bx-2/ed.zoom,by+s.height/2);ctx.moveTo(bx+s.width+2/ed.zoom,by+s.height/2);ctx.lineTo(bx+s.width+6/ed.zoom,by+s.height/2);ctx.stroke();
      }
    }
    ctx.restore();
  }
  function render(ed){
    renderCanvasOnly(ed);
    const q=s=>ed.modal.querySelector(s); if(!q('[data-sprite-paint]'))return;
    const f=currentFrame(ed);
    q('[data-editor-subtitle]').textContent=`${ed.name} · ${f.width}×${f.height}`;
    q('[data-sprite-zoom]').textContent=`${Math.round(ed.zoom*100)}%`;q('[data-sprite-coord]').textContent=ed.lastCell?`${ed.lastCell.x}, ${ed.lastCell.y}`:'—, —';q('[data-sprite-size-label]').textContent=String(ed.brushSize);
    const colorLabel=q('[data-sprite-color-label]');if(colorLabel)colorLabel.textContent=rgbaToHex(ed.color);q('[data-sprite-color-swatch]').style.background=cssRgba(ed.color);
    q('[data-mirror="x"]').textContent=`Mirror X: ${ed.mirrorX?'On':'Off'}`;q('[data-mirror="y"]').textContent=`Mirror Y: ${ed.mirrorY?'On':'Off'}`;q('[data-mirror="x"]').classList.toggle('active',ed.mirrorX);q('[data-mirror="y"]').classList.toggle('active',ed.mirrorY);q('[data-perfect-shape]').checked=!!ed.perfectShape;
    q('[data-sprite-name]').value=ed.name;syncFrameFields(ed);ed.modal.querySelectorAll('.sprite-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===ed.tool));
    ed.modal.querySelectorAll('[data-sprite-selection]').forEach(b=>{if(b.dataset.spriteSelection==='paste')b.disabled=!ed.clipboard;else if(b.dataset.spriteSelection==='cancel')b.disabled=!ed.selection&&!ed.lassoDrawing&&!ed.lassoPoints.length&&!ed.selectionRect;else b.disabled=!ed.selection;});ed.modal.querySelectorAll('[data-lasso-mode]').forEach(b=>b.classList.toggle('active',b.dataset.lassoMode===(ed.selectionMode||'set')));
    const play=q('[data-frame-action="play"]');if(play)play.innerHTML=`${glyph(ed.playing?'pause':'play')}${ed.playing?'Pause':'Play'}`;
    renderPreview(ed);renderFrameList(ed);
  }
  function syncFrameFields(ed){const f=currentFrame(ed),q=s=>ed.modal.querySelector(s);q('[data-sprite-width]').value=f.width;q('[data-sprite-height]').value=f.height;q('[data-sprite-fps]').value=ed.fps;q('[data-frame-count]').textContent=String(ed.frames.length);}
  function renderFrameList(ed){const host=ed.modal.querySelector('[data-frame-list]');if(!host)return;host.innerHTML='';ed.frames.forEach((f,i)=>{const row=document.createElement('div');row.className=`sprite-frame-row${i===ed.frameIndex?' selected':''}`;row.draggable=true;row.dataset.frameIndex=i;const thumb=document.createElement('canvas');thumb.width=56;thumb.height=56;thumb.className='sprite-frame-thumb';drawPreview(thumb,f);const info=document.createElement('div');info.className='sprite-frame-info';info.innerHTML=`<strong>Frame ${i+1}</strong><span>${esc(f.name||ed.name)}</span>`;const del=document.createElement('button');del.type='button';del.className='mini-action danger sprite-frame-delete';del.title='Delete frame';del.textContent='×';del.disabled=ed.frames.length===1;del.addEventListener('click',e=>{e.stopPropagation();deleteFrame(ed,i);});row.append(thumb,info,del);row.addEventListener('click',()=>selectFrame(ed,i));row.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain',String(i)));row.addEventListener('dragover',e=>e.preventDefault());row.addEventListener('drop',e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));if(Number.isInteger(from))moveFrame(ed,from,i);});host.append(row);});}
  function drawPreview(canvas,f){const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;drawChecker(ctx,w,h,8);const cache=ensureFrameCache(f);const s=Math.min((w-8)/Math.max(1,f.width),(h-8)/Math.max(1,f.height));ctx.imageSmoothingEnabled=false;ctx.save();ctx.translate((w-f.width*s)/2,(h-f.height*s)/2);ctx.scale(s,s);ctx.drawImage(cache.canvas,0,0);ctx.restore();}
  function renderPreview(ed){
    const c=ed.modal.querySelector('[data-sprite-preview]');
    if(!c)return;
    const f=currentFrame(ed);
    const max=156;
    const ratio=Math.max(1,f.width/f.height);
    let cssW=max,cssH=max;
    if(ratio>1)cssH=Math.max(24,Math.round(max/ratio));
    else if(ratio<1)cssW=Math.max(24,Math.round(max*ratio));
    const dpr=window.devicePixelRatio||1;
    c.width=Math.max(1,Math.round(cssW*dpr));
    c.height=Math.max(1,Math.round(cssH*dpr));
    c.style.width=cssW+'px';
    c.style.height=cssH+'px';
    const ctx=c.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    drawPreviewFit(ctx,cssW,cssH,f);
  }

  function drawPreviewFit(ctx,w,h,f){
    drawChecker(ctx,w,h,8);
    const scale=Math.min((w-8)/Math.max(1,f.width),(h-8)/Math.max(1,f.height));
    const ox=(w-f.width*scale)/2;
    const oy=(h-f.height*scale)/2;
    ctx.imageSmoothingEnabled=false;
    ctx.save();
    ctx.translate(ox,oy);
    ctx.scale(scale,scale);
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
      const p=f.pixels[y][x];
      if(p[3]){ctx.fillStyle=cssRgba(p);ctx.fillRect(x,y,1,1);}
    }
    ctx.restore();
  }
  function renderStatus(ed,cell){const e=ed.modal.querySelector('[data-sprite-coord]');if(e)e.textContent=cell?`${cell.x}, ${cell.y}`:'—, —';}
  function syncColor(ed){const h=rgbaToHex(ed.color),q=s=>ed.modal.querySelector(s);q('[data-sprite-color]').value=h;q('[data-sprite-color-swatch]').style.background=cssRgba(ed.color);}

  function toPngAsset(ed,f,index){const c=document.createElement('canvas');c.width=f.width;c.height=f.height;const ctx=c.getContext('2d');const data=ctx.createImageData(f.width,f.height);for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const p=f.pixels[y][x],i=(y*f.width+x)*4;data.data[i]=p[0];data.data[i+1]=p[1];data.data[i+2]=p[2];data.data[i+3]=p[3];}ctx.putImageData(data,0,0);const stem=(ed.name.trim()||'Sprite');const multi=ed.frames.length>1;const suffix=/\d$/.test(stem)?'_':'';const fileBase=multi?`${stem}${suffix}${index+1}`:stem;return{name:`${fileBase}.png`,value:c.toDataURL('image/png'),type:'image/png',kind:'Raster',editable:true,width:f.width,height:f.height,filename:`${fileBase}.png`};}
  function saveEditor(ed){stopPlayback(ed);if(ed.tool==='point')commitPointPath(ed);const frames=ed.frames.map((f,i)=>toPngAsset(ed,f,i));const app=window.UIXApp;if(app?.saveSpriteFrames)app.saveSpriteFrames(ed.sourceAssets,frames);else frames.forEach(f=>app?.addSpriteAsset?.(f));app?.status?.(`${frames.length} frame${frames.length===1?'':'s'} saved as PNG`);closeEditor(ed);}
  function closeEditor(ed){if(activeEditor===ed)activeEditor=null;stopPlayback(ed);ed.modal._resizeObserver?.disconnect();window.UIXApp?.closeModal?.(ed.modal);ed.modal.remove();}

  function requestDeleteSelection(ed){
    if(!ed?.selection?.mask?.size)return;
    const count=ed.selection.mask.size;
    const remove=()=>{const f=currentFrame(ed);pushUndo(ed);for(const key of ed.selection.mask){const [x,y]=key.split(',').map(Number);if(x>=0&&y>=0&&x<f.width&&y<f.height){f.pixels[y][x]=transparent();updateCachePixel(f,x,y,f.pixels[y][x]);}}invalidateCache(f);ensureFrameCache(f);ed.selection=null;render(ed);};
    const ask=window.UIXApp?.askConfirm;if(ask)ask('Delete Pixel Selection',`Delete ${count} selected pixel${count===1?'':'s'}?`,remove,'Delete');else if(confirm(`Delete ${count} selected pixel${count===1?'':'s'}?`))remove();
  }

  function handleShortcut(command){
    const ed=activeEditor;if(!ed)return;
    const f=currentFrame(ed);
    switch(command){
      case'copy':selectionAction(ed,'copy');break;
      case'cut':selectionAction(ed,'cut');break;
      case'paste':selectionAction(ed,'paste');break;
      case'duplicate':selectionAction(ed,'copy');selectionAction(ed,'paste');break;
      case'undo':spriteAction(ed,'undo');break;
      case'redo':spriteAction(ed,'redo');break;
      case'saveSprite':saveEditor(ed);break;
      case'selectAll':{const mask=new Set();for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)mask.add(`${x},${y}`);ed.selection={x:0,y:0,width:f.width,height:f.height,pixels:clonePixels(f.pixels),mask};render(ed);break;}
      case'deselectAll':ed.selection=null;clearSelectionPath(ed);ed.selectionRect=null;ed.selectionMode='set';ed.selectionGestureMode='set';render(ed);break;
      case'escape':selectionAction(ed,'cancel');break;
      case'delete':requestDeleteSelection(ed);break;
      case'escape':closeEditor(ed);break;
    }
  }
  window.UIXSpriteEditor={openCreate,openEdit,handleShortcut};
})();
