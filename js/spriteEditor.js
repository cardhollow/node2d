(() => {
  'use strict';

  const MAX_SIZE = 4096;
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
    undo:'↶', redo:'↷', grid:'⊞', center:'⊙', flipx:'↔', flipy:'↕', rotate:'↻', texture:'▧',
    copy:'⧉', add:'＋', save:'⇩', play:'▶', pause:'Ⅱ', prev:'‹', next:'›', delete:'×', lasso:'⌁', cut:'✂', paste:'▣', bucket:'▰', eyedropper:'⌕'
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
  function visibleFrameIndices(ed) {
    if (!ed.groupBaseName) return ed.frames.map((_, i) => i);
    const base = String(ed.groupBaseName).trim().toLocaleLowerCase();
    return ed.frames.map((f, i) => ({f, i})).filter(({f}) => {
      const parsed = frameSuffix(String(f?.name || ''));
      return parsed.number != null && parsed.base.toLocaleLowerCase() === base;
    }).map(({i}) => i);
  }
  function frameBelowIndex(ed, index=ed.frameIndex) {
    const visible = visibleFrameIndices(ed), position = visible.indexOf(index);
    return position >= 0 && position < visible.length - 1 ? visible[position + 1] : -1;
  }
  function nextGroupedFrameName(ed) {
    if (!ed.groupBaseName) return '';
    const root = String(ed.groupBaseName);
    const allAssets = window.UIXAssets?.Assets || {};
    const assetNames = Object.values(allAssets).flatMap(list => Array.isArray(list) ? list : [])
      .filter(asset => asset && asset !== null)
      .map(asset => asset.filename || asset.name || asset.title || '');
    const numbers=[...ed.frames.map(f=>frameSuffix(String(f.name||''))),...assetNames.map(name=>frameSuffix(String(name||'').replace(/\.[^.]+$/,'')))]
      .filter(item=>item.number!=null&&item.base.toLocaleLowerCase()===root.toLocaleLowerCase()).map(item=>item.number);
    let n = Math.max(0,...numbers)+1, candidate = '';
    do { candidate = `${root}${n++}`; }
    while (ed.frames.some(f => frameNameKey(f.name) === frameNameKey(candidate)) || assetNames.some(name => frameNameKey(name) === frameNameKey(candidate)));
    return candidate;
  }
  function frameGroupFor(asset) {
    const all = window.UIXAssets?.Assets?.Sprite || [];
    const parsed = frameSuffix(assetStem(asset));
    if (parsed.number == null) return [asset];
    // Names with the same base are one sequence even after a frame was renamed,
    // merged, or deleted and the numeric suffixes are no longer contiguous.
    const candidates = all
      .map(a => ({asset:a, parsed:frameSuffix(assetStem(a))}))
      .filter(x => x.parsed.number != null && x.parsed.base.toLowerCase() === parsed.base.toLowerCase())
      .sort((a,b) => a.parsed.number - b.parsed.number);
    const group=candidates.map(x=>x.asset);
    return group.some(a => a === asset) ? group : [asset];
  }

  function openCreate() {
    const modal = makeModal('sprite-create-modal', `
      <div class="modal-header"><div><h3>New Sprite</h3><p>Create a sprite with one or more animation frames.</p></div><button class="modal-close" type="button" data-close-sprite>×</button></div>
      <div class="sprite-create-form">
        <div class="property-row"><span class="property-label">Name</span><div class="property-control"><input data-create-name type="text" value="Sprite" autocomplete="off"></div></div>
        <div class="sprite-create-pixel"><label><span class="property-label">Width</span><input data-create-width type="number" min="1" max="4096" value="32"></label><label><span class="property-label">Height</span><input data-create-height type="number" min="1" max="4096" value="32"></label></div>
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
    const width = Math.max(1, Math.min(MAX_SIZE, Math.floor(img.naturalWidth || img.width || 32)));
    const height = Math.max(1, Math.min(MAX_SIZE, Math.floor(img.naturalHeight || img.height || 32)));
    const c=document.createElement('canvas'); c.width=width; c.height=height;
    const ctx=c.getContext('2d',{willReadFrequently:true}); ctx.imageSmoothingEnabled=false; ctx.clearRect(0,0,width,height); ctx.drawImage(img,0,0,width,height);
    const raw=ctx.getImageData(0,0,width,height).data, px=makePixels(width,height);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++){const i=(y*width+x)*4;px[y][x]=[raw[i],raw[i+1],raw[i+2],raw[i+3]];}
    return {width,height,pixels:px};
  }

  function fitPixelArray(source,w,h){
    const out=makePixels(w,h);if(!Array.isArray(source))return out;
    for(let y=0;y<Math.min(h,source.length);y++)for(let x=0;x<Math.min(w,source[y]?.length||0);x++)out[y][x]=[...(source[y][x]||transparent())];
    return out;
  }
  function bindFrameLayers(frame){
    const width=Math.max(1,Number(frame.width)||32),height=Math.max(1,Number(frame.height)||32);
    let sourcePixels=frame.pixels;
    if(!Array.isArray(frame.layers)||!frame.layers.length)frame.layers=[{name:'Layer 1',visible:true,opacity:1,pixels:Array.isArray(sourcePixels)?sourcePixels:makePixels(width,height)}];
    frame.layers=frame.layers.map((layer,i)=>({
      name:String(layer?.name||`Layer ${i+1}`),visible:layer?.visible!==false,opacity:clamp(Number(layer?.opacity??1),0,1),
      pixels:fitPixelArray(layer?.pixels||((i===0)?sourcePixels:null),width,height),__cache:null
    }));
    frame.width=width;frame.height=height;
    frame.activeLayer=clamp(Math.floor(Number(frame.activeLayer)||0),0,frame.layers.length-1);
    try{Object.defineProperty(frame,'pixels',{configurable:true,enumerable:true,get(){return this.layers?.[this.activeLayer]?.pixels||makePixels(this.width,this.height);},set(value){const l=this.layers?.[this.activeLayer];if(l){l.pixels=value;l.__cache=null;}else this.__pixels=value;}});}catch{}
    return frame;
  }
  function cloneFrameModel(frame){
    const layers=Array.isArray(frame.layers)&&frame.layers.length?frame.layers.map((l,i)=>({name:l.name||`Layer ${i+1}`,visible:l.visible!==false,opacity:Number(l.opacity??1),pixels:clonePixels(l.pixels||makePixels(frame.width,frame.height))})): [{name:'Layer 1',visible:true,opacity:1,pixels:clonePixels(frame.pixels)}];
    return bindFrameLayers({name:frame.name,width:frame.width,height:frame.height,sourceAsset:frame.sourceAsset||null,layers,activeLayer:Number(frame.activeLayer)||0});
  }
  function normalizeFrameSizes(frames){
    const models=frames.map(bindFrameLayers),maxW=Math.max(1,...models.map(f=>f.width||1)),maxH=Math.max(1,...models.map(f=>f.height||1));
    return models.map(f=>bindFrameLayers({name:f.name,width:maxW,height:maxH,sourceAsset:f.sourceAsset||null,activeLayer:f.activeLayer,layers:f.layers.map(l=>({...l,pixels:fitPixelArray(l.pixels,maxW,maxH),__cache:null}))}));
  }
  async function frameFromAsset(sourceAsset){
    const base=await imageToPixels(sourceAsset.value),frame={name:assetStem(sourceAsset),width:base.width,height:base.height,sourceAsset};
    if(Array.isArray(sourceAsset.spriteLayers)&&sourceAsset.spriteLayers.length){
      const layers=[];
      for(let i=0;i<sourceAsset.spriteLayers.length;i++){
        const meta=sourceAsset.spriteLayers[i];
        try{const image=await imageToPixels(meta.value);layers.push({name:meta.name||`Layer ${i+1}`,visible:meta.visible!==false,opacity:Number(meta.opacity??1),pixels:fitPixelArray(image.pixels,base.width,base.height)});}
        catch{layers.push({name:meta.name||`Layer ${i+1}`,visible:meta.visible!==false,opacity:Number(meta.opacity??1),pixels:makePixels(base.width,base.height)});}
      }
      if(layers.length)return bindFrameLayers({...frame,layers,activeLayer:Number(sourceAsset.activeLayer)||0});
    }
    return bindFrameLayers({...frame,pixels:base.pixels,layers:[{name:'Layer 1',visible:true,opacity:1,pixels:base.pixels}],activeLayer:0});
  }

  async function openEditMany(assets) {
    const list=Array.isArray(assets)?assets.filter(Boolean):[];
    if(!list.length)return;
    const frames=[];
    for(const sourceAsset of list){
      try{frames.push(await frameFromAsset(sourceAsset));}
      catch{frames.push(bindFrameLayers({name:assetStem(sourceAsset),width:32,height:32,pixels:makePixels(32,32),sourceAsset}));}
    }
    const normalized=normalizeFrameSizes(frames), first=list[0];
    openEditor({name:assetStem(first),sourceAssets:list,frames:normalized,fps:8,width:normalized[0]?.width||32,height:normalized[0]?.height||32,pixelWidth:normalized[0]?.width||32,pixelHeight:normalized[0]?.height||32,multiSource:true});
  }

  async function openEdit(asset) {
    const group = frameGroupFor(asset), frames=[];
    for(const sourceAsset of group){
      try{frames.push(await frameFromAsset(sourceAsset));}
      catch{frames.push(bindFrameLayers({name:assetStem(sourceAsset),width:32,height:32,pixels:makePixels(32,32),sourceAsset}));}
    }
    const normalized=normalizeFrameSizes(frames);
    const parsed=frameSuffix(assetStem(group[0]));
    const targetIndex=Math.max(0,group.findIndex(sourceAsset=>sourceAsset===asset||(sourceAsset?.value&&asset?.value&&sourceAsset.value===asset.value&&assetStem(sourceAsset).toLowerCase()===assetStem(asset).toLowerCase())));
    const pixelWidth=Math.max(1,Math.floor(normalized[0]?.width||32));
    const pixelHeight=Math.max(1,Math.floor(normalized[0]?.height||32));
    openEditor({name:parsed.number==null?assetStem(group[0]):parsed.base,groupBaseName:parsed.number==null?null:parsed.base,sourceAssets:group,frames:normalized,initialFrameIndex:targetIndex,fps:8,width:pixelWidth,height:pixelHeight,pixelWidth,pixelHeight});
  }

  function openEditor(config) {
    const modal=makeModal('sprite-paint-modal',`
      <div class="sprite-editor-header">
        <div class="sprite-editor-heading"><strong>Sprite Editor</strong><span data-editor-subtitle>Width and Height are pixel dimensions.</span></div>
        <div class="sprite-editor-header-actions"><button class="btn active" type="button" data-sprite-toggle-preview>▧ Preview</button><button class="btn" type="button" data-sprite-toggle-inspector>▤ Layers</button><button class="btn" type="button" data-sprite-action="undo" title="Undo" aria-label="Undo">${glyph('undo')}Undo</button><button class="btn" type="button" data-sprite-action="redo" title="Redo" aria-label="Redo">${glyph('redo')}Redo</button><button class="btn" type="button" data-sprite-cancel>Cancel</button><button class="btn primary" type="button" data-sprite-save>${glyph('save')}Save PNG</button></div>
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
            <label class="sprite-strength-row"><span>Strength</span><input data-sprite-brush-strength type="range" min="0" max="100" value="100"><b data-sprite-brush-strength-label>100%</b></label>
            <div class="sprite-mini-hint">Strength controls paint opacity and erasing amount.</div>
          </section>
          <section class="sprite-tool-section" data-pencil-settings hidden>
            <div class="sprite-section-title">Pencil</div>
            <label class="sprite-texture-setting-row"><span>Shape</span><select data-pencil-shape><option>Box</option><option>Circle</option></select></label>
          </section>
          <section class="sprite-tool-section sprite-texture-controls" data-texture-brush-controls hidden>
            <div class="sprite-section-title">Texture Brush</div>
            <div class="sprite-texture-brush-row"><span data-texture-brush-name>No sprite selected</span><button class="btn" type="button" data-texture-brush-select>Select Sprite</button></div>
            <div class="sprite-mini-hint">Color tints the Sprite. Override Brush Size keeps its original pixel dimensions.</div>
            <div class="sprite-texture-settings-title">Texture brush settings</div>
            <label class="sprite-texture-setting-check"><input type="checkbox" data-texture-setting="overrideBrushSize"><span>Override Brush Size</span></label>
            <label class="sprite-texture-setting-check"><input type="checkbox" data-texture-setting="blendColor"><span>Blend Color</span></label>
            <label class="sprite-texture-setting-row"><span>Blend By</span><select data-texture-setting="blendBy"><option>Alpha</option><option>Color</option><option selected>Both</option></select></label>
            <label class="sprite-texture-setting-check"><input type="checkbox" data-texture-setting="mixColor"><span>Mix Color</span></label>
            <label class="sprite-texture-setting-row" data-texture-mix-options><span>Mix By</span><select data-texture-setting="mixBy"><option>Multiply</option><option>Average</option><option>Add</option><option>Screen</option><option>Overlay</option></select></label>
            <label class="sprite-texture-setting-check"><input type="checkbox" data-texture-setting="randomizeBrush"><span>Randomize Brush</span></label>
            <div data-texture-randomize-options hidden>
              <label class="sprite-texture-setting-row"><span>Randomize</span><select data-texture-setting="randomize"><option>Pixel</option><option>Sprite</option></select></label>
              <div data-texture-sprite-random-options hidden>
                <label class="sprite-texture-setting-check"><input type="checkbox" data-texture-setting="overlap"><span>Overlap</span></label>
                <label class="sprite-texture-setting-check"><input type="checkbox" data-texture-setting="randRotation"><span>Rand Rotation</span></label>
                <label class="sprite-texture-setting-check"><input type="checkbox" data-texture-setting="randPosition"><span>Rand Position</span></label>
              </div>
            </div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Color</div>
            <div class="sprite-color-row"><span class="sprite-color-swatch" data-sprite-color-swatch></span><input data-sprite-color type="text" value="#FFFFFFFF" spellcheck="false"></div>
          </section>
          <section class="sprite-tool-section sprite-modulation-section">
            <div class="sprite-section-title">Modulation</div>
            <div class="sprite-color-row"><span class="sprite-color-swatch" data-modulate-color-swatch title="Choose modulation color"></span><input data-modulate-color type="text" value="#FFFFFFFF" spellcheck="false" aria-label="Modulation color"></div>
            <label class="sprite-strength-row"><span>Strength</span><input data-modulate-strength type="range" min="0" max="100" value="100"><b data-modulate-strength-label>100%</b></label>
            <div class="sprite-modulate-actions"><button class="btn" type="button" data-sprite-action="modulate">Modulate</button><button class="btn" type="button" data-sprite-action="modulate-all">All Frames</button></div>
            <div class="sprite-mini-hint">Multiplies the selected layer by the chosen color. All Frames applies it to every layer in every frame.</div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Mirror Painting</div>
            <div class="sprite-button-column">
              <button class="btn toggle-btn" data-mirror="x" type="button">Mirror X: Off</button>
              <button class="btn toggle-btn" data-mirror="y" type="button">Mirror Y: Off</button>
            </div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Editor</div>
            <div class="sprite-edit-grid">
              <button class="btn" data-sprite-action="grid" type="button">${glyph('grid')}Grid</button>
              <button class="btn" data-sprite-action="center" type="button">${glyph('center')}Center</button>
            </div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Edit · Active Layer Only</div>
            <div class="sprite-edit-grid">
              <button class="btn" data-sprite-action="flipx" type="button">${glyph('flipx')}Flip X</button>
              <button class="btn" data-sprite-action="flipy" type="button">${glyph('flipy')}Flip Y</button>
              <button class="btn" data-sprite-action="rotate" type="button">${glyph('rotate')}Rotate 90°</button>
              <button class="btn" data-sprite-action="invert" type="button">Invert</button>
              <button class="btn" data-sprite-action="trim" type="button" title="Trim transparent edges of the active layer and keep the sprite canvas size">Trim</button>
              <button class="btn" data-sprite-action="clear" type="button">Clear</button>
            </div>
            <div class="sprite-mini-hint">Flip, Rotate, Invert, Trim and Clear affect only the selected layer. Trim moves the remaining pixels to the top-left without resizing the shared frame.</div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Reposition · Active Layer</div>
            <label class="sprite-texture-setting-row"><span>Pos</span><select data-reposition-position><option>Left</option><option>Right</option><option>Top</option><option>Down</option><option selected>Center</option></select></label>
            <button class="btn" type="button" data-sprite-action="reposition">Reposition</button>
            <div class="sprite-mini-hint">Moves the current layer's visible drawing while keeping the canvas size unchanged.</div>
          </section>
          <section class="sprite-tool-section">
            <div class="sprite-section-title">Selection</div>
            <div class="sprite-selection-mode-grid"><button class="btn" data-lasso-mode="set" type="button">Set</button><button class="btn" data-lasso-mode="add" type="button">Add</button><button class="btn" data-lasso-mode="subtract" type="button">Subtract</button></div>
            <div class="sprite-selection-grid">
              <button class="btn" data-sprite-selection="selectall" type="button">Select All</button>
              <button class="btn" data-sprite-selection="copy" type="button">${glyph('copy')}Copy</button>
              <button class="btn" data-sprite-selection="cut" type="button">${glyph('cut')}Cut</button>
              <button class="btn" data-sprite-selection="paste" type="button">${glyph('paste')}Paste</button>
              <button class="btn" data-sprite-selection="delete" type="button">${glyph('delete')}Delete</button>
              <button class="btn" data-sprite-selection="cancel" type="button">Cancel</button>
            </div>
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
          <section class="sprite-inspector-section sprite-layers-section" data-layer-section>
            <div class="sprite-frames-heading"><strong>Layers <span data-layer-frame-label>· Frame 1</span></strong><span data-layer-count>1</span></div>
            <div class="sprite-layer-list" data-layer-list></div>
            <div class="sprite-layer-actions">
              <button class="btn" type="button" data-layer-action="add">＋ Layer</button><button class="btn" type="button" data-layer-action="duplicate">Duplicate</button>
              <button class="btn" type="button" data-layer-action="copy">Copy</button><button class="btn" type="button" data-layer-action="paste">Paste</button>
              <button class="btn" type="button" data-layer-action="merge">Merge Down</button><button class="btn danger" type="button" data-layer-action="delete">Delete</button>
            </div>
            <div class="sprite-frame-hint">Each frame has its own layers. Copy a layer, switch frames, then paste it there. Drag or use ↑ ↓ to reorder.</div>
          </section>
          <section class="sprite-inspector-section">
            <div class="sprite-section-title">Sprite</div>
            <div class="property-row"><span class="property-label">Name</span><div class="property-control"><input data-sprite-name type="text"></div></div>
            <div class="sprite-size-pair"><label><span class="property-label">Width</span><input data-sprite-width type="number" min="1" max="4096"></label><label><span class="property-label">Height</span><input data-sprite-height type="number" min="1" max="4096"></label></div>
          </section>
          <section class="sprite-inspector-section">
            <div class="sprite-frames-heading"><strong>Frames</strong><span data-frame-count>1</span></div>
            <label class="sprite-frame-name-row"><span class="property-label">Frame Name</span><input data-frame-name type="text" autocomplete="off" spellcheck="false"></label>
            <div class="sprite-frame-list" data-frame-list></div>
            <div class="sprite-frame-actions"><button class="btn" data-frame-action="duplicate" type="button">${glyph('copy')}Duplicate</button><button class="btn" data-frame-action="add" type="button">${glyph('add')}Add Frame</button><button class="btn" data-frame-action="merge-down" type="button" title="Merge the selected frame with the frame below it as separate editable layers">Merge Down</button><button class="btn" data-frame-action="import" type="button">＋ Import Sprite</button></div>
            <div class="sprite-play-row"><button class="btn" data-frame-action="prev" type="button" aria-label="Previous frame">${glyph('prev')}</button><button class="btn" data-frame-action="play" type="button">${glyph('play')}Play</button><button class="btn" data-frame-action="next" type="button" aria-label="Next frame">${glyph('next')}</button><label><span>FPS</span><input data-sprite-fps type="number" min="1" max="120" value="8"></label></div>
            <div class="sprite-frame-hint">Drag frames to reorder. PNGs show the composite; layer stacks remain editable in the project.</div>
          </section>
        </aside>
      </div>`);

    const frames=(config.frames||[]).map(cloneFrameModel);
    const ed={
      modal,name:config.name||'Sprite',groupBaseName:config.groupBaseName||null,sourceAssets:config.sourceAssets||[],multiSource:!!config.multiSource,frames:frames.length?frames:[bindFrameLayers({name:config.name||'Sprite',width:config.width||32,height:config.height||32,pixels:makePixels(config.width||32,config.height||32),sourceAsset:null})],
      frameIndex:clamp(Number(config.initialFrameIndex)||0,0,Math.max(0,frames.length-1)),fps:config.fps||8,playing:false,playTimer:null,tool:'pencil',brushSize:1,brushStrength:100,brushShape:'Box',showPreview:true,color:[255,255,255,255],textureBrush:null,textureSettings:{overrideBrushSize:false,blendColor:false,blendBy:'Both',mixColor:false,mixBy:'Multiply',randomizeBrush:false,randomize:'Pixel',overlap:false,randRotation:false,randPosition:false},showGrid:true,
      zoom:4,pan:{x:0,y:0},mirrorX:false,mirrorY:false,undo:[],redo:[],drawing:false,drawStart:null,lastCell:null,lastPaintCell:null,
      panelWidths:{left:190,right:235},leftCollapsed:false,rightCollapsed:false,
      pointers:new Map(),pinch:null,panDrag:null,spacePan:false,ruler:null,pointerDrawingId:null,lastPointerCellKey:'',perfectShape:false,points:[],pointDragIndex:-1,
      lassoPoints:[],lassoDrawing:false,selection:null,selectionMode:'set',selectionGestureMode:'set',selectionRect:null,clipboard:null,layerClipboard:null,modulateColor:[255,255,255,255],modulateStrength:100,canvasRenderRaf:0,selectionDrag:null
    };
    bindEditor(ed);
    enablePanelControls(ed);
    setPreviewVisibility(ed,true);
    activeEditor=ed;
    requestAnimationFrame(()=>{modal.focus?.({preventScroll:true});fitEditor(ed);render(ed);});
  }

  const currentFrame = ed => ed.frames[ed.frameIndex];
  const activePixels = ed => currentFrame(ed).pixels;

  function renderTools(ed){
    const basic=ed.modal.querySelector('[data-basic-tools]'), shapes=ed.modal.querySelector('[data-shape-tools]');
    basic.innerHTML='';shapes.innerHTML='';
    [['pencil','pencil','Pencil'],['eyedropper','eyedropper','Eyedropper'],['texture','texture','Texture Brush'],['eraser','eraser','Eraser'],['fill','bucket','Bucket'],['line','line','Line'],['point','point','Point'],['lasso','lasso','Lasso'],['box','rect','Box Select']].forEach(([name,g,label])=>basic.append(toolButton(ed,name,g,label)));
    [['rect','rect','Rect'],['ellipse','circle','Circle'],['triangle','triangle','Triangle']].forEach(([name,g,label])=>shapes.append(toolButton(ed,name,g,label)));
  }
  function toolButton(ed,name,g,label){
    const b=document.createElement('button');b.type='button';b.className='sprite-tool';b.dataset.tool=name;b.innerHTML=`${glyph(g)}<span>${label}</span>`;
    b.addEventListener('click',()=>{
      if(ed.selection?.floating&&name!=='lasso')commitFloatingSelection(ed,false);
      if(name==='texture'){chooseTextureBrush(ed);return;}
      if(ed.tool==='point' && name!=='point') commitPointPath(ed);
      if(ed.tool==='lasso' && name!=='lasso') clearSelectionPath(ed);if(ed.tool==='box' && name!=='box') ed.selectionRect=null;
      ed.tool=name;ed.ruler=null;render(ed);
    });
    return b;
  }

  function chooseTextureBrush(ed){
    const open=window.UIXApp?.openAssetSelector;
    if(typeof open!=='function'){window.UIXApp?.status?.('Sprite selector is unavailable');return;}
    open('Sprite',async asset=>{
      if(!asset?.value)return;
      try{
        const source=await imageToPixels(asset.value);
        ed.textureBrush={name:String(asset.name||asset.filename||'Sprite'),src:asset.value,width:source.width,height:source.height,pixels:source.pixels,stampKey:'',stamp:null};
        ed.tool='texture';ed.ruler=null;render(ed);window.UIXApp?.status?.(`Texture Brush: ${ed.textureBrush.name}`);
      }catch(error){window.UIXApp?.status?.(`Texture Brush could not load this sprite: ${String(error?.message||error)}`);}
    });
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
    q('[data-frame-name]').value=currentFrame(ed)?.name||ed.name;
    renderTools(ed);

    q('[data-sprite-size]').addEventListener('input',e=>{ed.brushSize=clamp(Number(e.target.value)||1,1,32);render(ed);});
    q('[data-sprite-brush-strength]').addEventListener('input',e=>{ed.brushStrength=clamp(Number(e.target.value)||0,0,100);q('[data-sprite-brush-strength-label]').textContent=`${ed.brushStrength}%`;});
    q('[data-pencil-shape]').addEventListener('change',e=>{ed.brushShape=e.target.value==='Circle'?'Circle':'Box';render(ed);});
    q('[data-reposition-position]').value='Center';
    q('[data-texture-brush-select]')?.addEventListener('click',()=>chooseTextureBrush(ed));
    ed.modal.addEventListener('change',e=>{
      const input=e.target.closest('[data-texture-setting]');if(!input)return;
      const key=input.dataset.textureSetting;if(!key||!ed.textureSettings)return;
      ed.textureSettings[key]=input.type==='checkbox'?!!input.checked:String(input.value);
      if(ed.textureBrush)ed.textureBrush.stampKey='';
      renderTextureSettings(ed);render(ed);
    });
    q('[data-perfect-shape]').addEventListener('change',e=>{ed.perfectShape=e.target.checked;render(ed);});
    q('[data-sprite-color]').addEventListener('change',()=>{try{ed.color=parseHex(q('[data-sprite-color]').value);if(ed.textureBrush)ed.textureBrush.stampKey='';syncColor(ed);render(ed);}catch{q('[data-sprite-color]').value=rgbaToHex(ed.color);}});
    q('[data-sprite-color-swatch]').addEventListener('click',()=>window.UIXApp?.openColorModal?.(rgbaToHex(ed.color),v=>{try{ed.color=parseHex(v);if(ed.textureBrush)ed.textureBrush.stampKey='';syncColor(ed);render(ed);}catch{}},'Sprite Color'));
    q('[data-sprite-color]').addEventListener('click',()=>window.UIXApp?.openColorModal?.(rgbaToHex(ed.color),v=>{try{ed.color=parseHex(v);if(ed.textureBrush)ed.textureBrush.stampKey='';syncColor(ed);render(ed);}catch{}},'Sprite Color'));
    q('[data-modulate-color]').addEventListener('change',()=>{try{ed.modulateColor=parseHex(q('[data-modulate-color]').value);render(ed);}catch{q('[data-modulate-color]').value=rgbaToHex(ed.modulateColor);}});
    q('[data-modulate-color]').addEventListener('click',()=>window.UIXApp?.openColorModal?.(rgbaToHex(ed.modulateColor),v=>{try{ed.modulateColor=parseHex(v);render(ed);}catch{}},'Sprite Modulation'));
    q('[data-modulate-color-swatch]').addEventListener('click',()=>window.UIXApp?.openColorModal?.(rgbaToHex(ed.modulateColor),v=>{try{ed.modulateColor=parseHex(v);render(ed);}catch{}},'Sprite Modulation'));
    q('[data-modulate-strength]').addEventListener('input',e=>{ed.modulateStrength=clamp(Number(e.target.value)||0,0,100);const lab=q('[data-modulate-strength-label]');if(lab)lab.textContent=`${ed.modulateStrength}%`;});
    q('[data-preview-close]').addEventListener('click',()=>setPreviewVisibility(ed,false));
    q('[data-sprite-toggle-preview]').addEventListener('click',()=>setPreviewVisibility(ed,!ed.showPreview));
    q('[data-sprite-toggle-inspector]').addEventListener('click',()=>{const panel=q('.sprite-inspector-panel');if(window.matchMedia('(max-width: 900px)').matches){const opened=panel.classList.toggle('mobile-visible');if(opened)q('[data-layer-section]')?.scrollIntoView({block:'start',behavior:'smooth'});q('[data-sprite-toggle-inspector]').textContent=opened?'Hide Inspector':'▤ Layers';}else{q('[data-layer-section]')?.scrollIntoView({block:'nearest',behavior:'smooth'});}});
    q('[data-layer-list]').addEventListener('click',e=>{const b=e.target.closest('[data-layer-select]');if(b){selectLayer(ed,Number(b.dataset.layerSelect));return;}const action=e.target.closest('[data-layer-row-action]');if(action){e.preventDefault();e.stopPropagation();layerAction(ed,action.dataset.layerRowAction,Number(action.dataset.layerIndex));}});
    q('[data-layer-list]').addEventListener('input',e=>{const input=e.target.closest('[data-layer-opacity]');if(!input)return;const f=currentFrame(ed),i=Number(input.dataset.layerOpacity),layer=f.layers[i];if(!layer)return;if(!input.dataset.undoPushed){pushUndo(ed,true);input.dataset.undoPushed='1';}layer.opacity=clamp(Number(input.value)/100,0,1);const row=input.closest('.sprite-layer-row'),value=row?.querySelector('[data-layer-opacity-value]');if(value)value.textContent=`${Math.round(layer.opacity*100)}%`;if(f.activeLayer!==i){f.activeLayer=i;ed.selection=null;q('[data-layer-list]').querySelectorAll('.sprite-layer-row').forEach(r=>r.classList.toggle('selected',Number(r.dataset.layerIndex)===i));const merge=ed.modal.querySelector('[data-layer-action="merge"]');if(merge)merge.disabled=i===0;}renderCanvasOnly(ed);renderPreview(ed);renderFrameList(ed);});
    q('[data-layer-list]').addEventListener('change',e=>{const opacity=e.target.closest('[data-layer-opacity]');if(opacity){renderLayerList(ed);return;}const input=e.target.closest('[data-layer-name]');if(!input)return;const l=currentFrame(ed).layers[Number(input.dataset.layerName)];if(l){const next=input.value.trim()||`Layer ${Number(input.dataset.layerName)+1}`;if(next!==l.name){pushUndo(ed,true);l.name=next;}input.value=l.name;renderLayerList(ed);}});
    q('[data-layer-list]').addEventListener('dragstart',e=>{const row=e.target.closest('[data-layer-index]');if(!row)return;e.dataTransfer.setData('text/plain',row.dataset.layerIndex);e.dataTransfer.effectAllowed='move';});
    q('[data-layer-list]').addEventListener('dragover',e=>{if(e.target.closest('[data-layer-index]'))e.preventDefault();});
    q('[data-layer-list]').addEventListener('drop',e=>{const row=e.target.closest('[data-layer-index]');if(!row)return;e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain')),to=Number(row.dataset.layerIndex);moveLayer(ed,from,to);});
    ed.modal.querySelectorAll('[data-layer-action]').forEach(b=>b.addEventListener('click',e=>{e.preventDefault();layerAction(ed,b.dataset.layerAction);}));
    q('[data-sprite-name]').addEventListener('input',e=>{ed.name=e.target.value.trim()||'Sprite';render(ed);});
    q('[data-frame-name]').addEventListener('change',e=>renameCurrentFrame(ed,e.target.value));
    q('[data-frame-name]').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();renameCurrentFrame(ed,e.currentTarget.value);e.currentTarget.blur();}});
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
      if(e.key==='Enter'&&ed.selection?.floating&&!e.target.closest('input,select,textarea,button')){e.preventDefault();commitFloatingSelection(ed);return;}
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
      const paintCell=(x,y)=>ed.tool==='texture'&&!erase?paintTexture(ed,{x,y}):paint(ed,{x,y},erase);
      if(ed.lastPaintCell)lineCells(ed.lastPaintCell,cell,paintCell);
      else paintCell(cell.x,cell.y);
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
      if(ed.selection?.floating&&!pointInSelection(ed,cell))commitFloatingSelection(ed,false);
      if(ed.tool==='eyedropper'){ed.color=sampleCompositePixel(currentFrame(ed),cell.x,cell.y);syncColor(ed);renderStatus(ed,cell);render(ed);return;}
      if((ed.tool==='lasso'||ed.tool==='box') && ed.selection && pointInSelection(ed,cell) && e.button===0){
        if(ed.selection.floating){const sel=ed.selection;ed.selectionDrag={floating:true,pointerX:e.clientX,pointerY:e.clientY,baseSelection:{x:sel.x,y:sel.y,width:sel.width,height:sel.height,mask:new Set(sel.mask),pixels:clonePixels(sel.pixels)}};}
        else {pushUndo(ed);ed.selectionDrag={pointerX:e.clientX,pointerY:e.clientY,dx:0,dy:0,basePixels:clonePixels(currentFrame(ed).pixels),baseSelection:JSON.parse(JSON.stringify({x:ed.selection.x,y:ed.selection.y,width:ed.selection.width,height:ed.selection.height,mask:[...ed.selection.mask],pixels:ed.selection.pixels}))};}
        return;
      }
      if(ed.tool==='lasso'){ed.selectionGestureMode=e.altKey?'subtract':(e.shiftKey?'add':(ed.selectionMode||'set'));ed.lassoDrawing=true;ed.lassoPoints=[{...cell}];ed.lastCell=cell;scheduleCanvasRender(ed);return;}
      if(ed.tool==='box'){ed.selectionGestureMode=e.altKey?'subtract':(e.shiftKey?'add':(ed.selectionMode||'set'));ed.selectionRect={a:{...cell},b:{...cell}};scheduleCanvasRender(ed);return;}
      if(ed.tool==='point'){handlePointDown(e,cell);return;}
      if(ed.tool==='fill'){pushUndo(ed);fill(ed,cell);ed.lastCell=cell;renderStatus(ed,cell);render(ed);return;}
      ed.pointerDrawingId=e.pointerId;ed.drawing=true;ed.drawStart=cell;ed.lastCell=cell;ed.lastPaintCell=null;ed.lastPointerCellKey='';
      if(['pencil','eraser','texture'].includes(ed.tool)){pushUndo(ed);strokeFromCell(cell,ed.tool==='eraser');}
      else if(['line','rect','ellipse','triangle'].includes(ed.tool)){render(ed);}
    };

    const processPointerMove=e=>{
      if(ed.pointers.has(e.pointerId))ed.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(ed.pointers.size>=2&&ed.pinch){updatePinch(ed);return;}
      if(ed.panDrag){ed.pan.x=ed.panDrag.px+e.clientX-ed.panDrag.x;ed.pan.y=ed.panDrag.py+e.clientY-ed.panDrag.y;scheduleCanvasRender(ed);return;}
      if(ed.selectionDrag?.floating&&ed.selectionDrag.baseSelection){
        const c=clientToCell(ed,e.clientX,e.clientY);if(c){
          const d=ed.selectionDrag,base=d.baseSelection,f=currentFrame(ed);
          const dx=Math.round((e.clientX-d.pointerX)/ed.zoom),dy=Math.round((e.clientY-d.pointerY)/ed.zoom);
          const nx=clamp(base.x+dx,0,Math.max(0,f.width-base.width)),ny=clamp(base.y+dy,0,Math.max(0,f.height-base.height));
          const sel=ed.selection;if(sel){sel.x=nx;sel.y=ny;sel.width=base.width;sel.height=base.height;sel.pixels=base.pixels;sel.floating=true;sel.mask=new Set();for(const key of base.mask){const [x,y]=key.split(',').map(Number),tx=x+(nx-base.x),ty=y+(ny-base.y);if(tx>=0&&ty>=0&&tx<f.width&&ty<f.height)sel.mask.add(`${tx},${ty}`);}}
          scheduleCanvasRender(ed);
        }return;
      }
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
      for(const ev of events){const cell=clientToCell(ed,ev.clientX,ev.clientY);if(!cell)continue;ed.lastCell=cell;if(ed.tool==='pencil'||ed.tool==='texture')strokeFromCell(cell,false);else if(ed.tool==='eraser')strokeFromCell(cell,true);else if(['line','rect','ellipse','triangle'].includes(ed.tool))scheduleCanvasRender(ed);}
    };

    const onPointerMove=e=>{e.preventDefault();processPointerMove(e);};

    const onPointerUp=e=>{
      const hadTwo=ed.pointers.size>=2;ed.pointers.delete(e.pointerId);
      if(hadTwo){if(ed.pointers.size<2)ed.pinch=null;return;}
      if(ed.panDrag){ed.panDrag=null;return;}
      if(ed.selectionDrag){if(ed.selectionDrag.floating){ed.selectionDrag=null;render(ed);}else commitSelectionDrag(ed,false);return;}
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

  function captureFrameSnapshot(ed,frameIndex=ed.frameIndex){const f=ed.frames[frameIndex];return{kind:'layers',frameIndex,name:f.name,sourceAsset:f.sourceAsset||null,width:f.width,height:f.height,activeLayer:f.activeLayer,layers:f.layers.map(l=>({name:l.name,visible:l.visible!==false,opacity:Number(l.opacity??1),pixels:clonePixels(l.pixels)}))};}
  function captureAllFramesSnapshot(ed){return{kind:'allFrames',frameIndex:ed.frameIndex,frames:ed.frames.map((f,i)=>captureFrameSnapshot(ed,i))};}
  function pushUndoAllFrames(ed){ed.undo.push(captureAllFramesSnapshot(ed));if(ed.undo.length>100)ed.undo.shift();ed.redo=[];}
  function pushUndo(ed,allLayers=false){const f=currentFrame(ed);if(allLayers)ed.undo.push(captureFrameSnapshot(ed));else ed.undo.push({kind:'pixels',frameIndex:ed.frameIndex,layerIndex:f.activeLayer,width:f.width,height:f.height,pixels:clonePixels(f.pixels)});if(ed.undo.length>100)ed.undo.shift();ed.redo=[];}
  function captureUndoState(ed,entry){if(entry?.kind==='allFrames')return captureAllFramesSnapshot(ed);const f=ed.frames[entry?.frameIndex??ed.frameIndex];if(!f)return captureFrameSnapshot(ed);if(entry?.kind==='layers')return captureFrameSnapshot(ed,entry.frameIndex);const index=clamp(Number(entry?.layerIndex)||0,0,f.layers.length-1);return{kind:'pixels',frameIndex:entry?.frameIndex??ed.frameIndex,layerIndex:index,width:f.width,height:f.height,pixels:clonePixels(f.layers[index].pixels)};}
  function restoreUndoState(ed,entry){if(!entry)return;if(entry.kind==='allFrames'){ed.frames=entry.frames.map(s=>bindFrameLayers({name:s.name||ed.name,sourceAsset:s.sourceAsset||null,width:s.width,height:s.height,activeLayer:s.activeLayer,layers:s.layers.map(l=>({name:l.name,visible:l.visible!==false,opacity:Number(l.opacity??1),pixels:clonePixels(l.pixels),__cache:null}))}));ed.frameIndex=clamp(entry.frameIndex,0,ed.frames.length-1);ed.selection=null;ed.frames.forEach(f=>f.layers.forEach(l=>l.__cache=null));fitEditor(ed);return;}const f=ed.frames[entry.frameIndex];if(!f)return;const oldW=f.width,oldH=f.height;ed.frameIndex=entry.frameIndex;if(entry.kind==='layers'){f.name=entry.name||f.name;f.sourceAsset=entry.sourceAsset||null;f.width=entry.width;f.height=entry.height;f.layers=entry.layers.map(l=>({name:l.name,visible:l.visible!==false,opacity:Number(l.opacity??1),pixels:clonePixels(l.pixels),__cache:null}));f.activeLayer=clamp(Number(entry.activeLayer)||0,0,f.layers.length-1);bindFrameLayers(f);}else{f.width=entry.width;f.height=entry.height;f.activeLayer=clamp(Number(entry.layerIndex)||0,0,f.layers.length-1);f.pixels=clonePixels(entry.pixels);}f.layers.forEach(l=>l.__cache=null);invalidateCache(f);ed.selection=null;if(oldW!==f.width||oldH!==f.height)fitEditor(ed);}
  function layerCache(layer){return layer.__cache || (layer.__cache={canvas:null,ctx:null,pixelsRef:null});}
  function frameCache(f){const layer=f.layers?.[f.activeLayer];return layer?layerCache(layer):(f.__cache||(f.__cache={canvas:null,ctx:null,pixelsRef:null}));}
  function invalidateCache(f){const cache=frameCache(f);if(cache){cache.canvas=null;cache.ctx=null;cache.pixelsRef=null;}if(f&&f.__cache){f.__cache.canvas=null;f.__cache.ctx=null;}}
  function ensureLayerCache(layer,w,h){
    const cache=layerCache(layer),pixels=layer.pixels;
    if(cache.canvas&&cache.canvas.width===w&&cache.canvas.height===h&&cache.pixelsRef===pixels)return cache;
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d',{alpha:true});ctx.imageSmoothingEnabled=false;
    const image=ctx.createImageData(w,h);let p=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const px=pixels[y]?.[x]||transparent();image.data[p++]=px[0];image.data[p++]=px[1];image.data[p++]=px[2];image.data[p++]=px[3];}
    ctx.putImageData(image,0,0);cache.canvas=canvas;cache.ctx=ctx;cache.pixelsRef=pixels;return cache;
  }
  function ensureFrameCache(f){const layer=f.layers?.[f.activeLayer];if(layer)return ensureLayerCache(layer,f.width,f.height);return ensureLayerCache({pixels:f.pixels,__cache:f.__cache||null},f.width,f.height);}
  function drawLayerStack(ctx,f,x,y,skipIndex=-1){
    ctx.imageSmoothingEnabled=false;
    (f.layers||[{pixels:f.pixels,visible:true,opacity:1}]).forEach((layer,i)=>{
      if(i===skipIndex||layer.visible===false||Number(layer.opacity??1)<=0)return;
      const cache=ensureLayerCache(layer,f.width,f.height);if(!cache.canvas)return;
      ctx.save();ctx.globalAlpha=clamp(Number(layer.opacity??1),0,1);ctx.drawImage(cache.canvas,x,y);ctx.restore();
    });
  }
  function updateCachePixel(f,x,y,pixel){
    const cache=ensureFrameCache(f);
    cache.ctx.clearRect(x,y,1,1);if(pixel[3]>0){cache.ctx.fillStyle=cssRgba(pixel);cache.ctx.fillRect(x,y,1,1);}
  }
  function sampleCompositePixel(f,x,y){
    let out=[0,0,0,0];
    for(const layer of (f.layers||[])){
      if(layer.visible===false)continue;
      const px=layer.pixels?.[y]?.[x]||transparent();
      const sa=clamp(Number(px[3]||0)/255,0,1)*clamp(Number(layer.opacity??1),0,1);
      if(sa<=0)continue;
      const da=clamp(Number(out[3]||0)/255,0,1),oa=sa+da*(1-sa);
      if(oa<=0){out=[0,0,0,0];continue;}
      out=[Math.round((Number(px[0]||0)*sa+out[0]*da*(1-sa))/oa),Math.round((Number(px[1]||0)*sa+out[1]*da*(1-sa))/oa),Math.round((Number(px[2]||0)*sa+out[2]*da*(1-sa))/oa),Math.round(oa*255)];
    }
    return out;
  }
  function applyPixel(ed,x,y,erase){const f=currentFrame(ed);if(x<0||y<0||x>=f.width||y>=f.height)return;const pixel=erase?transparent():[...ed.color];f.pixels[y][x]=pixel;updateCachePixel(f,x,y,pixel);}
  function sourceOverPixel(destination,source,opacity=1){const dst=destination||transparent(),src=source||transparent(),sa=clamp((Number(src[3])||0)/255*opacity,0,1),da=clamp((Number(dst[3])||0)/255,0,1);if(sa<=0)return [...dst];const outA=sa+da*(1-sa);if(outA<=0)return transparent();return [Math.round((src[0]*sa+dst[0]*da*(1-sa))/outA),Math.round((src[1]*sa+dst[1]*da*(1-sa))/outA),Math.round((src[2]*sa+dst[2]*da*(1-sa))/outA),Math.round(outA*255)];}
  function applyBrushPixel(ed,x,y,erase){const f=currentFrame(ed);if(x<0||y<0||x>=f.width||y>=f.height)return;const strength=clamp(Number(ed.brushStrength??100)/100,0,1);if(strength<=0)return;const dst=f.pixels[y][x]||transparent();let pixel;if(erase){pixel=[...dst];pixel[3]=Math.round(pixel[3]*(1-strength));if(pixel[3]===0)pixel=transparent();}else pixel=sourceOverPixel(dst,ed.color,strength);f.pixels[y][x]=pixel;updateCachePixel(f,x,y,pixel);}
  function paint(ed,cell,erase){const f=currentFrame(ed),rad=Math.max(1,Math.floor(ed.brushSize)),off=Math.floor(rad/2),shape=ed.tool==='pencil'?ed.brushShape:'Box',cx=(rad-1)/2,cy=(rad-1)/2,radius=Math.max(.5,rad/2-.25);for(let yy=0;yy<rad;yy++)for(let xx=0;xx<rad;xx++){if(shape==='Circle'&&((xx-cx)**2+(yy-cy)**2)>radius*radius)continue;const x=cell.x+xx-off,y=cell.y+yy-off;const xs=[x],ys=[y];if(ed.mirrorX)xs.push(f.width-1-x);if(ed.mirrorY)ys.push(f.height-1-y);for(const a of xs)for(const b of ys)applyBrushPixel(ed,a,b,erase);}}
  function mixTextureChannel(source,tint,mode){
    const a=clamp(Number(source)||0,0,255),b=clamp(Number(tint)||0,0,255);
    switch(mode){
      case 'Average':return Math.round((a+b)/2);
      case 'Add':return Math.min(255,a+b);
      case 'Screen':return Math.round(255-(255-a)*(255-b)/255);
      case 'Overlay':return a<128?Math.round(2*a*b/255):Math.round(255-2*(255-a)*(255-b)/255);
      case 'Multiply':default:return Math.round(a*b/255);
    }
  }
  function textureTintPixels(source,w,h,ed){
    const tint=(ed.color||[255,255,255,255]).map(v=>clamp(Math.round(Number(v)||0),0,255));
    const settings=ed.textureSettings||{},out=makePixels(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const src=source[y]?.[x]||transparent();
      const blend=settings.mixColor?settings.mixBy:'Multiply';
      out[y][x]=[
        mixTextureChannel(src[0],tint[0],blend),
        mixTextureChannel(src[1],tint[1],blend),
        mixTextureChannel(src[2],tint[2],blend),
        Math.round(src[3]*tint[3]/255)
      ];
    }
    return out;
  }
  function randomizePixelArrangement(pixels,w,h){
    const points=[];let minX=w,minY=h,maxX=-1,maxY=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++)if((pixels[y]?.[x]?.[3]||0)>0){points.push([...pixels[y][x]]);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    if(points.length<2||maxX<minX)return pixels;
    const slots=[];for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)slots.push([x,y]);
    for(let i=slots.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[slots[i],slots[j]]=[slots[j],slots[i]];}
    const out=makePixels(w,h);for(let i=0;i<points.length&&i<slots.length;i++){const [x,y]=slots[i];out[y][x]=points[i];}
    return out;
  }
  function extractTextureComponents(pixels,w,h){
    const seen=new Uint8Array(w*h),components=[];
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const start=y*w+x;if(seen[start]||(pixels[y]?.[x]?.[3]||0)===0)continue;
      const stack=[[x,y]],pts=[];seen[start]=1;let minX=x,minY=y,maxX=x,maxY=y;
      while(stack.length){const [px,py]=stack.pop();pts.push([px,py,[...pixels[py][px]]]);minX=Math.min(minX,px);minY=Math.min(minY,py);maxX=Math.max(maxX,px);maxY=Math.max(maxY,py);
        for(const [nx,ny] of [[px+1,py],[px-1,py],[px,py+1],[px,py-1]]){if(nx<0||ny<0||nx>=w||ny>=h)continue;const idx=ny*w+nx;if(seen[idx]||(pixels[ny]?.[nx]?.[3]||0)===0)continue;seen[idx]=1;stack.push([nx,ny]);}
      }
      const cw=maxX-minX+1,ch=maxY-minY+1,cp=makePixels(cw,ch);for(const [px,py,col] of pts)cp[py-minY][px-minX]=col;
      components.push({x:minX,y:minY,width:cw,height:ch,pixels:cp,centerX:(minX+maxX+1)/2,centerY:(minY+maxY+1)/2});
    }
    return components;
  }
  function rotateTextureComponent(component,turns){
    let pixels=clonePixels(component.pixels),w=component.width,h=component.height;
    for(let turn=0;turn<turns;turn++){const next=makePixels(h,w);for(let y=0;y<h;y++)for(let x=0;x<w;x++)next[x][h-1-y]=[...(pixels[y]?.[x]||transparent())];pixels=next;[w,h]=[h,w];}
    return {pixels,width:w,height:h};
  }
  function randomizeSpriteArrangement(pixels,w,h,settings){
    const components=extractTextureComponents(pixels,w,h);if(!components.length)return pixels;
    const out=makePixels(w,h),occupied=new Uint8Array(w*h);
    const canPlace=(part,x,y)=>{for(let py=0;py<part.height;py++)for(let px=0;px<part.width;px++){if((part.pixels[py]?.[px]?.[3]||0)===0)continue;const dx=x+px,dy=y+py;if(dx>=0&&dy>=0&&dx<w&&dy<h&&occupied[dy*w+dx])return false;}return true;};
    for(const comp of components){
      const turns=settings.randRotation?Math.floor(Math.random()*4):0,part=rotateTextureComponent(comp,turns);
      const originX=Math.round(comp.centerX-part.width/2),originY=Math.round(comp.centerY-part.height/2);
      let px=originX,py=originY,placed=false;
      const maxX=Math.max(0,w-part.width),maxY=Math.max(0,h-part.height),attempts=settings.randPosition?48:(turns?24:1);
      for(let attempt=0;attempt<attempts;attempt++){
        if(settings.randPosition){px=Math.floor(Math.random()*(maxX+1));py=Math.floor(Math.random()*(maxY+1));}
        else if(attempt>0){px=Math.floor(Math.random()*(maxX+1));py=Math.floor(Math.random()*(maxY+1));}
        if(settings.overlap||canPlace(part,px,py)){placed=true;break;}
      }
      if(!placed)continue;
      for(let y=0;y<part.height;y++)for(let x=0;x<part.width;x++){
        const pixel=part.pixels[y]?.[x]||transparent();if(pixel[3]===0)continue;const dx=px+x,dy=py+y;if(dx<0||dy<0||dx>=w||dy>=h)continue;
        if(!settings.overlap&&occupied[dy*w+dx])continue;
        out[dy][dx]=[...pixel];occupied[dy*w+dx]=1;
      }
    }
    return out;
  }
  function textureStampForBrush(ed){
    const brush=ed.textureBrush;if(!brush?.pixels?.length)return null;
    const settings=ed.textureSettings||{},sw=Math.max(1,Number(brush.width)||1),sh=Math.max(1,Number(brush.height)||1),size=Math.max(1,Math.floor(Number(ed.brushSize)||1));
    const scale=settings.overrideBrushSize?1:size/Math.max(sw,sh),w=Math.max(1,Math.round(sw*scale)),h=Math.max(1,Math.round(sh*scale));
    const staticKey=`${w}x${h}:${ed.color.join(',')}:${settings.mixColor}:${settings.mixBy}:${settings.randomizeBrush}:${settings.randomize}:${settings.randRotation}:${settings.randPosition}:${settings.overlap}`;
    if(!settings.randomizeBrush&&brush.stampKey===staticKey&&brush.stamp)return brush.stamp;
    const source=makePixels(w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const sx=Math.min(sw-1,Math.floor((x+.5)*sw/w)),sy=Math.min(sh-1,Math.floor((y+.5)*sh/h));source[y][x]=[...(brush.pixels[sy]?.[sx]||transparent())];}
    let pixels=textureTintPixels(source,w,h,ed);
    if(settings.randomizeBrush){
      if(settings.randomize==='Sprite')pixels=randomizeSpriteArrangement(pixels,w,h,settings);
      else pixels=randomizePixelArrangement(pixels,w,h);
    }
    const stamp={width:w,height:h,pixels};
    if(!settings.randomizeBrush){brush.stampKey=staticKey;brush.stamp=stamp;}else{brush.stampKey='';brush.stamp=null;}
    return stamp;
  }
  function blendTexturePixel(destination,source,blendBy){
    const dst=destination||transparent(),src=source||transparent(),sa=clamp(src[3]/255,0,1),da=clamp(dst[3]/255,0,1);
    if(sa<=0)return [...dst];
    if(blendBy==='Alpha'){
      const outA=sa+da*(1-sa);return [dst[3]>0?dst[0]:src[0],dst[3]>0?dst[1]:src[1],dst[3]>0?dst[2]:src[2],Math.round(outA*255)];
    }
    if(blendBy==='Color'){
      if(da<=0)return [...src];
      return [Math.round(src[0]*sa+dst[0]*(1-sa)),Math.round(src[1]*sa+dst[1]*(1-sa)),Math.round(src[2]*sa+dst[2]*(1-sa)),dst[3]];
    }
    const outA=sa+da*(1-sa);if(outA<=0)return transparent();
    return [Math.round((src[0]*sa+dst[0]*da*(1-sa))/outA),Math.round((src[1]*sa+dst[1]*da*(1-sa))/outA),Math.round((src[2]*sa+dst[2]*da*(1-sa))/outA),Math.round(outA*255)];
  }
  function paintTexture(ed,cell){
    const f=currentFrame(ed),stamp=textureStampForBrush(ed);if(!stamp)return;
    const ox=cell.x-Math.floor(stamp.width/2),oy=cell.y-Math.floor(stamp.height/2),copies=[{mx:false,my:false}];
    if(ed.mirrorX)copies.push({mx:true,my:false});if(ed.mirrorY)copies.push({mx:false,my:true});if(ed.mirrorX&&ed.mirrorY)copies.push({mx:true,my:true});
    const changed=new Set(),settings=ed.textureSettings||{};
    for(const copy of copies)for(let sy=0;sy<stamp.height;sy++)for(let sx=0;sx<stamp.width;sx++){
      const srcX=copy.mx?stamp.width-1-sx:sx,srcY=copy.my?stamp.height-1-sy:sy,src=stamp.pixels[srcY][srcX];if(!src||src[3]<=0)continue;
      const x0=ox+sx,y0=oy+sy,x=copy.mx?f.width-1-x0:x0,y=copy.my?f.height-1-y0:y0;
      if(x<0||y<0||x>=f.width||y>=f.height)continue;const key=`${x},${y}`;if(changed.has(key))continue;changed.add(key);
      const strength=clamp(Number(ed.brushStrength??100)/100,0,1);if(strength<=0)continue;const paintSrc=[src[0],src[1],src[2],Math.round(src[3]*strength)];
      const pixel=settings.blendColor?blendTexturePixel(f.pixels[y][x],paintSrc,settings.blendBy):(strength<1?blendTexturePixel(f.pixels[y][x],paintSrc,'Both'):[...src]);f.pixels[y][x]=pixel;updateCachePixel(f,x,y,pixel);
    }
  }
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
  function repositionActiveLayer(ed,position='Center'){
    const f=currentFrame(ed),layer=currentLayer(ed);if(!layer)return false;
    let minX=f.width,minY=f.height,maxX=-1,maxY=-1;
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)if((layer.pixels[y]?.[x]?.[3]||0)>0){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
    if(maxX<0){window.UIXApp?.status?.('The active layer has no visible drawing to reposition');return false;}
    const bw=maxX-minX+1,bh=maxY-minY+1;let dx=0,dy=0;
    if(position==='Left')dx=-minX;else if(position==='Right')dx=f.width-1-maxX;else if(position==='Top')dy=-minY;else if(position==='Down')dy=f.height-1-maxY;else {dx=Math.floor((f.width-bw)/2)-minX;dy=Math.floor((f.height-bh)/2)-minY;}
    if(dx===0&&dy===0)return false;
    pushUndo(ed);const out=makePixels(f.width,f.height);
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const px=layer.pixels[y]?.[x]||transparent();if(px[3]===0)continue;const tx=x+dx,ty=y+dy;if(tx>=0&&ty>=0&&tx<f.width&&ty<f.height)out[ty][tx]=[...px];}
    layer.pixels=out;layer.__cache=null;invalidateCache(f);ensureFrameCache(f);return true;
  }
  function invertFrame(ed){
    const f=currentFrame(ed),layer=currentLayer(ed);if(!layer)return false;pushUndo(ed);
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const px=layer.pixels[y]?.[x];if(px&&px[3]>0){px[0]=255-px[0];px[1]=255-px[1];px[2]=255-px[2];}}
    layer.__cache=null;invalidateCache(f);ensureFrameCache(f);return true;
  }
  function trimFrame(ed){
    const f=currentFrame(ed),layer=currentLayer(ed);if(!layer)return false;
    let minX=f.width,minY=f.height,maxX=-1,maxY=-1;
    for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const px=layer.pixels[y]?.[x];if(px&&px[3]>0){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
    if(maxX<0){const alreadyClear=layer.pixels.every(row=>row.every(px=>!px||px[3]===0));if(alreadyClear)return false;pushUndo(ed);layer.pixels=makePixels(f.width,f.height);layer.__cache=null;invalidateCache(f);ensureFrameCache(f);return true;}
    if(minX===0&&minY===0&&maxX===f.width-1&&maxY===f.height-1)return false;
    pushUndo(ed);const source=clonePixels(layer.pixels),out=makePixels(f.width,f.height),nw=maxX-minX+1,nh=maxY-minY+1;
    for(let y=0;y<nh;y++)for(let x=0;x<nw;x++)out[y][x]=[...(source[minY+y]?.[minX+x]||transparent())];
    layer.pixels=out;layer.__cache=null;ed.selection=null;clearSelectionPath(ed);ed.selectionRect=null;invalidateCache(f);ensureFrameCache(f);return true;
  }
  function selectAll(ed){
    const f=currentFrame(ed),mask=new Set();for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)mask.add(`${x},${y}`);
    ed.selection={x:0,y:0,width:f.width,height:f.height,pixels:clonePixels(f.pixels),mask};clearSelectionPath(ed);ed.selectionRect=null;
  }
  function spriteAction(ed,a){const f=currentFrame(ed);
    if(a==='grid'){ed.showGrid=!ed.showGrid;return render(ed);}
    if(a==='center'){fitEditor(ed);return render(ed);}
    if(a==='clear'){pushUndo(ed);f.pixels=makePixels(f.width,f.height);invalidateCache(f);return render(ed);}
    if(a==='invert'){invertFrame(ed);return render(ed);}
    if(a==='trim'){trimFrame(ed);return render(ed);}
    if(a==='reposition'){repositionActiveLayer(ed,ed.modal.querySelector('[data-reposition-position]')?.value||'Center');return render(ed);}
    if(a==='undo'){if(ed.selection?.floating){ed.selection=null;ed.selectionDrag=null;return render(ed);}if(ed.undo.length){const state=ed.undo.pop();ed.redo.push(captureUndoState(ed,state));restoreUndoState(ed,state);}return render(ed);}
    if(a==='redo'){if(ed.redo.length){const state=ed.redo.pop();ed.undo.push(captureUndoState(ed,state));restoreUndoState(ed,state);}return render(ed);}
    if(a==='modulate'){pushUndo(ed);applyModulationToLayer(ed,currentLayer(ed));invalidateCache(f);return render(ed);}
    if(a==='modulate-all'){ed.undo.push(captureAllFramesSnapshot(ed));if(ed.undo.length>100)ed.undo.shift();ed.redo=[];applyModulationToAll(ed);window.UIXApp?.status?.('Modulation applied to every layer in every frame');return render(ed);}
    if(a==='flipx'){if(ed.selection?.mask?.size)flipSelection(ed,'x');else{const layer=currentLayer(ed);if(layer){pushUndo(ed);layer.pixels=layer.pixels.map(row=>[...row].reverse());layer.__cache=null;invalidateCache(f);}}return render(ed);}
    if(a==='flipy'){if(ed.selection?.mask?.size)flipSelection(ed,'y');else{const layer=currentLayer(ed);if(layer){pushUndo(ed);layer.pixels=[...layer.pixels].reverse();layer.__cache=null;invalidateCache(f);}}return render(ed);}
    if(a==='rotate'){if(ed.selection?.mask?.size)rotateSelection(ed);else{const layer=currentLayer(ed);if(layer){pushUndo(ed);const rotated=makePixels(f.height,f.width);for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++)rotated[x][f.height-1-y]=[...(layer.pixels[y]?.[x]||transparent())];const out=makePixels(f.width,f.height),ox=Math.floor((f.width-rotated[0].length)/2),oy=Math.floor((f.height-rotated.length)/2);for(let y=0;y<rotated.length;y++)for(let x=0;x<rotated[y].length;x++){const tx=ox+x,ty=oy+y;if(tx>=0&&ty>=0&&tx<f.width&&ty<f.height)out[ty][tx]=[...rotated[y][x]];}layer.pixels=out;layer.__cache=null;invalidateCache(f);ensureFrameCache(f);}}return render(ed);}
  }

  function chooseImportMode(width,height,baseW,baseH){
    return new Promise(resolve=>{
      const modal=makeModal('sprite-import-choice-modal',`<div class="modal-header"><div><h3>Sprite is larger</h3><p>${width}×${height} is larger than the current ${baseW}×${baseH} frame.</p></div><button class="modal-close" type="button" data-import-choice-close>×</button></div><div class="modal-actions sprite-import-choice-actions"><button class="btn" type="button" data-import-choice="cancel">Cancel</button><button class="btn" type="button" data-import-choice="crop">Crop</button><button class="btn" type="button" data-import-choice="expand">Expand Canvas</button><button class="btn primary" type="button" data-import-choice="shrink">Shrink (Keep Aspect Ratio)</button></div>`);
      const done=value=>{window.UIXApp?.closeModal?.(modal);modal.remove();resolve(value);};modal.querySelectorAll('[data-import-choice]').forEach(b=>b.onclick=()=>done(b.dataset.importChoice));modal.querySelector('[data-import-choice-close]').onclick=()=>done('cancel');
    });
  }
  function fitPixelsToFrame(source,w,h,mode){
    const out=makePixels(w,h),sw=source.width,sh=source.height;
    let drawW=sw,drawH=sh,sx=0,sy=0;
    if(mode==='shrink'){
      const scale=Math.min(w/sw,h/sh,1);drawW=Math.max(1,Math.round(sw*scale));drawH=Math.max(1,Math.round(sh*scale));sx=Math.floor((sw-drawW)/2);sy=Math.floor((sh-drawH)/2);
    }else if(mode==='crop'){
      const cropW=Math.min(sw,w),cropH=Math.min(sh,h);sx=Math.floor((sw-cropW)/2);sy=Math.floor((sh-cropH)/2);drawW=cropW;drawH=cropH;
    }else{drawW=Math.min(sw,w);drawH=Math.min(sh,h);sx=Math.floor((sw-drawW)/2);sy=Math.floor((sh-drawH)/2);}
    const ox=Math.floor((w-drawW)/2),oy=Math.floor((h-drawH)/2);
    if(mode==='shrink' || drawW===sw&&drawH===sh){for(let y=0;y<drawH;y++)for(let x=0;x<drawW;x++){const srcX=Math.min(sw-1,sx+Math.floor(x*(sw/drawW))),srcY=Math.min(sh-1,sy+Math.floor(y*(sh/drawH)));out[oy+y][ox+x]=[...source.pixels[srcY][srcX]];}}
    else for(let y=0;y<drawH;y++)for(let x=0;x<drawW;x++)out[oy+y][ox+x]=[...source.pixels[sy+y][sx+x]];
    return out;
  }
  async function importSpriteAssetIntoEditor(ed,asset,insertAt=ed.frameIndex+1){
    if(!asset?.value)return;
    try{
      const source=await imageToPixels(asset.value),base=currentFrame(ed),baseW=base.width,baseH=base.height;
      let mode='center',w=baseW,h=baseH;
      if(source.width>baseW||source.height>baseH){
        mode=await chooseImportMode(source.width,source.height,baseW,baseH);
        if(mode==='cancel')return;
        if(mode==='expand'){w=Math.max(baseW,source.width);h=Math.max(baseH,source.height);}
      }
      let frame;
      try{frame=await frameFromAsset(asset);if(frame.width!==source.width||frame.height!==source.height)frame=bindFrameLayers({...frame,width:source.width,height:source.height,layers:frame.layers.map(l=>({...l,pixels:fitPixelArray(l.pixels,source.width,source.height)}))});}
      catch{frame=bindFrameLayers({name:assetStem(asset),width:source.width,height:source.height,pixels:source.pixels,sourceAsset:null});}
      if(w!==source.width||h!==source.height||mode!=='center'){frame=bindFrameLayers({name:assetStem(asset),width:w,height:h,sourceAsset:null,layers:frame.layers.map(l=>({...l,pixels:fitPixelsToFrame({width:source.width,height:source.height,pixels:l.pixels},w,h,mode)})),activeLayer:frame.activeLayer});}
      frame.name=uniqueFrameName(ed,assetStem(asset));frame.sourceAsset=asset;
      pushUndoAllFrames(ed);ed.frames.splice(insertAt,0,frame);ed.frameIndex=insertAt;ed.selection=null;fitEditor(ed);render(ed);
    }catch(err){window.UIXApp?.status?.(`Could not import Sprite: ${err?.message||err}`);}
  }
  async function importSpriteAssetsIntoEditor(ed,assets){
    const list=Array.isArray(assets)?assets.filter(a=>a?.value):[];
    if(!list.length)return;
    let index=ed.frameIndex+1;
    for(const asset of list){
      const before=ed.frames.length;
      await importSpriteAssetIntoEditor(ed,asset,index);
      if(ed.frames.length>before)index=ed.frameIndex+1;
    }
  }
  function openSpriteImport(ed,isMulti=false){window.UIXApp?.openAssetSelector?.('Sprite',value=>isMulti?importSpriteAssetsIntoEditor(ed,value):importSpriteAssetIntoEditor(ed,value),{isMulti});}

  function currentLayer(ed){const f=currentFrame(ed);return f.layers[f.activeLayer]||f.layers[0];}
  function selectLayer(ed,index){const f=currentFrame(ed);if(!Number.isInteger(index)||index<0||index>=f.layers.length||index===f.activeLayer)return;f.activeLayer=index;ed.selection=null;ed.lassoPoints=[];ed.selectionRect=null;render(ed);}
  function moveLayer(ed,from,to){const f=currentFrame(ed);if(!Number.isInteger(from)||!Number.isInteger(to)||from===to||from<0||to<0||from>=f.layers.length||to>=f.layers.length)return;pushUndo(ed,true);const [layer]=f.layers.splice(from,1);f.layers.splice(to,0,layer);if(f.activeLayer===from)f.activeLayer=to;else if(from<f.activeLayer&&to>=f.activeLayer)f.activeLayer--;else if(from>f.activeLayer&&to<=f.activeLayer)f.activeLayer++;f.layers.forEach(l=>l.__cache=null);render(ed);}
  function layerAction(ed,action,index=currentFrame(ed).activeLayer){
    const f=currentFrame(ed);let i=Number.isInteger(index)?index:f.activeLayer; i=clamp(i,0,f.layers.length-1);
    if(action==='add'){pushUndo(ed,true);const layer={name:`Layer ${f.layers.length+1}`,visible:true,opacity:1,pixels:makePixels(f.width,f.height)};f.layers.splice(i+1,0,layer);f.activeLayer=i+1;}
    else if(action==='duplicate'){pushUndo(ed,true);const l=f.layers[i];f.layers.splice(i+1,0,{name:`${l.name||`Layer ${i+1}`} Copy`,visible:l.visible!==false,opacity:Number(l.opacity??1),pixels:clonePixels(l.pixels)});f.activeLayer=i+1;}
    else if(action==='copy'){const l=f.layers[i];ed.layerClipboard={name:l.name||`Layer ${i+1}`,visible:l.visible!==false,opacity:Number(l.opacity??1),width:f.width,height:f.height,pixels:clonePixels(l.pixels)};window.UIXApp?.status?.(`Copied ${ed.layerClipboard.name}`);renderLayerList(ed);return;}
    else if(action==='paste'){if(!ed.layerClipboard){window.UIXApp?.status?.('Copy a layer first');return;}pushUndo(ed,true);const clip=ed.layerClipboard;const layer={name:clip.name||'Pasted Layer',visible:clip.visible!==false,opacity:Number(clip.opacity??1),pixels:fitPixelArray(clip.pixels,f.width,f.height)};f.layers.splice(i+1,0,layer);f.activeLayer=i+1;}
    else if(action==='delete'){pushUndo(ed,true);if(f.layers.length===1){f.layers[0].pixels=makePixels(f.width,f.height);f.layers[0].__cache=null;}else{f.layers.splice(i,1);f.activeLayer=clamp(i-1,0,f.layers.length-1);}}
    else if(action==='merge'){if(i<=0){window.UIXApp?.status?.('There is no layer below to merge into');return;}pushUndo(ed,true);const top=f.layers[i],under=f.layers[i-1];if(top.visible!==false){const topOpacity=clamp(Number(top.opacity??1),0,1),underOpacity=clamp(Number(under.opacity??1),0,1);for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){const a=top.pixels[y][x],b=under.pixels[y][x],sa=(a[3]/255)*topOpacity,da=(b[3]/255)*underOpacity,outA=sa+da*(1-sa);if(outA<=0){under.pixels[y][x]=transparent();continue;}under.pixels[y][x]=[Math.round((a[0]*sa+b[0]*da*(1-sa))/outA),Math.round((a[1]*sa+b[1]*da*(1-sa))/outA),Math.round((a[2]*sa+b[2]*da*(1-sa))/outA),Math.round(outA*255)];}under.opacity=1;}under.visible=under.visible!==false||top.visible!==false;under.__cache=null;f.layers.splice(i,1);f.activeLayer=i-1;}
    else if(action==='up'){moveLayer(ed,i,Math.min(f.layers.length-1,i+1));return;}
    else if(action==='down'){moveLayer(ed,i,Math.max(0,i-1));return;}
    else if(action==='toggle'){pushUndo(ed,true);f.layers[i].visible=f.layers[i].visible===false;}
    else return;
    f.layers.forEach(l=>{l.__cache=null;});ed.selection=null;render(ed);
  }
  function drawLayerThumbnail(canvas,layer,f){
    const ctx=canvas.getContext('2d');if(!ctx)return;const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);const step=6;
    for(let y=0;y<h;y+=step)for(let x=0;x<w;x+=step){ctx.fillStyle=((Math.floor(x/step)+Math.floor(y/step))%2)?'#303030':'#484848';ctx.fillRect(x,y,step,step);}
    const scale=Math.min((w-6)/Math.max(1,f.width),(h-6)/Math.max(1,f.height));const dw=f.width*scale,dh=f.height*scale;const x=(w-dw)/2,y=(h-dh)/2;const cache=ensureLayerCache(layer,f.width,f.height);
    if(cache.canvas){ctx.save();ctx.globalAlpha=clamp(Number(layer.opacity??1),0,1);ctx.imageSmoothingEnabled=false;ctx.drawImage(cache.canvas,x,y,dw,dh);ctx.restore();}
    ctx.strokeStyle='#555';ctx.lineWidth=1;ctx.strokeRect(.5,.5,w-1,h-1);
  }
  function renderLayerList(ed){
    const host=ed.modal.querySelector('[data-layer-list]');if(!host)return;const f=currentFrame(ed);host.innerHTML='';
    const label=ed.modal.querySelector('[data-layer-frame-label]');if(label)label.textContent=`· Frame ${ed.frameIndex+1}`;const count=ed.modal.querySelector('[data-layer-count]');if(count)count.textContent=String(f.layers.length);
    f.layers.map((_,i)=>i).reverse().forEach(i=>{
      const layer=f.layers[i];const row=document.createElement('div');row.className=`sprite-layer-row${i===f.activeLayer?' selected':''}${layer.visible===false?' layer-hidden':''}`;row.draggable=true;row.dataset.layerIndex=String(i);
      const thumb=document.createElement('canvas');thumb.className='sprite-layer-thumb';thumb.width=44;thumb.height=44;thumb.setAttribute('aria-label',`${layer.name||`Layer ${i+1}`} preview`);drawLayerThumbnail(thumb,layer,f);
      const select=document.createElement('button');select.type='button';select.className='sprite-layer-eye';select.dataset.layerRowAction='toggle';select.dataset.layerIndex=String(i);select.title=layer.visible===false?'Show layer':'Hide layer';select.textContent=layer.visible===false?'○':'◉';
      const name=document.createElement('input');name.type='text';name.className='sprite-layer-name';name.value=layer.name||`Layer ${i+1}`;name.dataset.layerName=String(i);name.setAttribute('aria-label',`Layer ${i+1} name`);name.title='Rename layer';name.addEventListener('focus',()=>{if(f.activeLayer!==i){f.activeLayer=i;ed.selection=null;q('[data-layer-list]').querySelectorAll('.sprite-layer-row').forEach(r=>r.classList.toggle('selected',Number(r.dataset.layerIndex)===i));const merge=ed.modal.querySelector('[data-layer-action=\"merge\"]');if(merge)merge.disabled=i===0;}});
      const up=document.createElement('button');up.type='button';up.className='sprite-layer-move';up.textContent='↑';up.title='Move layer up';up.disabled=i===f.layers.length-1;up.dataset.layerRowAction='up';up.dataset.layerIndex=String(i);
      const down=document.createElement('button');down.type='button';down.className='sprite-layer-move';down.textContent='↓';down.title='Move layer down';down.disabled=i===0;down.dataset.layerRowAction='down';down.dataset.layerIndex=String(i);
      const opacityWrap=document.createElement('label');opacityWrap.className='sprite-layer-opacity';opacityWrap.title='Layer opacity';
      const opacityLabel=document.createElement('span');opacityLabel.textContent='Opacity';
      const opacity=document.createElement('input');opacity.type='range';opacity.min='0';opacity.max='100';opacity.value=String(Math.round(clamp(Number(layer.opacity??1),0,1)*100));opacity.dataset.layerOpacity=String(i);opacity.setAttribute('aria-label',`${layer.name||`Layer ${i+1}`} opacity`);
      const opacityValue=document.createElement('b');opacityValue.dataset.layerOpacityValue='true';opacityValue.textContent=`${opacity.value}%`;
      opacityWrap.append(opacityLabel,opacity,opacityValue);row.append(thumb,select,name,up,down,opacityWrap);row.addEventListener('click',e=>{if(e.target.closest('button,input'))return;selectLayer(ed,i);});
      host.append(row);
    });
    const paste=ed.modal.querySelector('[data-layer-action="paste"]');if(paste)paste.disabled=!ed.layerClipboard;
    const merge=ed.modal.querySelector('[data-layer-action="merge"]');if(merge)merge.disabled=f.activeLayer===0;
    const del=ed.modal.querySelector('[data-layer-action="delete"]');if(del)del.textContent=f.layers.length===1?'Clear Layer':'Delete Layer';
  }
  function applyModulationToLayer(ed,layer){if(!layer)return;const c=ed.modulateColor,s=clamp(Number(ed.modulateStrength)/100,0,1);if(s<=0)return;for(let y=0;y<layer.pixels.length;y++)for(let x=0;x<(layer.pixels[y]?.length||0);x++){const p=layer.pixels[y][x];if(!p||p[3]===0)continue;p[0]=Math.round(p[0]*(1-s+(c[0]/255)*s));p[1]=Math.round(p[1]*(1-s+(c[1]/255)*s));p[2]=Math.round(p[2]*(1-s+(c[2]/255)*s));p[3]=Math.round(p[3]*(1-s+(c[3]/255)*s));}layer.__cache=null;}
  function applyModulationToAll(ed){for(const f of ed.frames){for(const layer of f.layers)applyModulationToLayer(ed,layer);}}

  function frameNameKey(value){return String(value||'').trim().replace(/\.[^.]+$/,'').toLocaleLowerCase();}
  function frameNameExists(ed,value,exceptIndex=-1){
    const key=frameNameKey(value);if(!key)return true;
    if(ed.frames.some((f,i)=>i!==exceptIndex&&frameNameKey(f.name)===key))return true;
    // Frame names behave like local file names, across all project asset kinds.
    const allAssets=window.UIXAssets?.Assets||{};
    const assets=Object.values(allAssets).flatMap(list=>Array.isArray(list)?list:[]);
    const self=ed.frames[exceptIndex]?.sourceAsset;
    return assets.some(asset=>asset!==self&&[asset?.filename,asset?.name,asset?.title].some(name=>name&&frameNameKey(name)===key));
  }
  function uniqueFrameName(ed,base,exceptIndex=-1){
    const root=String(base||'Frame').trim()||'Frame';let candidate=root,n=2;
    while(frameNameExists(ed,candidate,exceptIndex))candidate=`${root} ${n++}`;
    return candidate;
  }
  function renameCurrentFrame(ed,value){
    const f=currentFrame(ed);if(!f)return;
    const name=String(value||'').trim().replace(/\.(png|webp|jpe?g)$/i,'');
    const input=ed.modal.querySelector('[data-frame-name]');
    if(!name){if(input)input.value=f.name||ed.name;window.UIXApp?.status?.('Frame name cannot be empty');return;}
    if(name!==f.name&&frameNameExists(ed,name,ed.frameIndex)){
      if(input)input.value=f.name||ed.name;
      window.UIXApp?.status?.(`Frame name “${name}” already exists in this project`);return;
    }
    if(name===f.name){if(input)input.value=name;return;}
    pushUndoAllFrames(ed);
    f.name=name; // Keep sourceAsset so Save can replace the original file by identity.
    if(input)input.value=name;
    if(ed.groupBaseName){
      const visible=visibleFrameIndices(ed);
      if(!visible.includes(ed.frameIndex)&&visible.length){
        ed.frameIndex=visible.reduce((best,index)=>Math.abs(index-ed.frameIndex)<Math.abs(best-ed.frameIndex)?index:best,visible[0]);
        ed.selection=null;ed.selectionDrag=null;fitEditor(ed);
      }
    }
    render(ed);
  }
  function frameAction(ed,a){
    if(ed.selection?.floating)commitFloatingSelection(ed,false);
    if(a==='duplicate'||a==='copy'){
      const f=currentFrame(ed);if(!f)return;pushUndoAllFrames(ed);
      const copy=cloneFrameModel(f);
      copy.name=ed.groupBaseName?nextGroupedFrameName(ed):uniqueFrameName(ed,`${f.name||ed.name} Copy`);
      copy.sourceAsset=null;
      ed.frames.splice(ed.frameIndex+1,0,copy);ed.frameIndex++;ed.selection=null;return render(ed);
    }
    if(a==='add'){
      const f=currentFrame(ed);if(!f)return;
      const w=Math.max(1,Number(f.width)||1),h=Math.max(1,Number(f.height)||1);pushUndoAllFrames(ed);
      const proposed=ed.groupBaseName?nextGroupedFrameName(ed):`${ed.name||'Sprite'}${ed.frames.length+1}`;
      const baseName=uniqueFrameName(ed,proposed);
      ed.frames.splice(ed.frameIndex+1,0,bindFrameLayers({name:baseName,width:w,height:h,layers:[{name:'Layer 1',visible:true,opacity:1,pixels:makePixels(w,h)}],sourceAsset:null}));
      ed.frameIndex++;ed.selection=null;fitEditor(ed);return render(ed);
    }
    if(a==='merge-down'){
      const i=ed.frameIndex,belowIndex=frameBelowIndex(ed,i);
      if(i<0||belowIndex<0){window.UIXApp?.status?.('There is no frame below to merge with');return;}
      const merged=mergeFrameModels(ed,i,belowIndex);
      pushUndoAllFrames(ed);
      ed.frames[i]=merged;ed.frames.splice(belowIndex,1);ed.frameIndex=i;ed.selection=null;ed.selectionDrag=null;fitEditor(ed);render(ed);window.UIXApp?.status?.('Merged with the frame below as separate editable layers. Use Undo to reverse.');return;
    }
    if(a==='import'){return openSpriteImport(ed,false);}
    if(a==='prev'||a==='next'){
      const visible=visibleFrameIndices(ed);if(!visible.length)return;
      let position=visible.indexOf(ed.frameIndex);if(position<0)position=0;
      position=(position+(a==='prev'?-1:1)+visible.length)%visible.length;
      return selectFrame(ed,visible[position]);
    }
    if(a==='play'){if(ed.playing){stopPlayback(ed);render(ed);}else startPlayback(ed);}
  }
  function mergeFrameModels(ed,selectedIndex,belowIndex){
    const selected=ed.frames[selectedIndex],below=ed.frames[belowIndex];
    const w=Math.max(selected.width,below.width),h=Math.max(selected.height,below.height);
    // The visible row below supplies the lower layers; selected frame layers stay above.
    const belowLayers=below.layers.map((l,j)=>({name:`${below.name||`Frame ${belowIndex+1}`} · ${l.name||`Layer ${j+1}`}`,visible:l.visible!==false,opacity:Number(l.opacity??1),pixels:fitPixelArray(l.pixels,w,h)}));
    const selectedLayers=selected.layers.map((l,j)=>({name:`${selected.name||`Frame ${selectedIndex+1}`} · ${l.name||`Layer ${j+1}`}`,visible:l.visible!==false,opacity:Number(l.opacity??1),pixels:fitPixelArray(l.pixels,w,h)}));
    const activeLayer=belowLayers.length+clamp(Number(selected.activeLayer)||0,0,Math.max(0,selectedLayers.length-1));
    return bindFrameLayers({name:selected.name||`${ed.name}${selectedIndex+1}`,width:w,height:h,sourceAsset:selected.sourceAsset||null,layers:[...belowLayers,...selectedLayers],activeLayer});
  }
  function selectFrame(ed,i){if(ed.selection?.floating)commitFloatingSelection(ed,false);ed.frameIndex=clamp(i,0,ed.frames.length-1);fitEditor(ed);render(ed);}
  function deleteFrame(ed,index){
    if(ed.frames.length<=1||!Number.isInteger(index)||index<0||index>=ed.frames.length)return;
    pushUndoAllFrames(ed);ed.frames.splice(index,1);
    if(index<ed.frameIndex)ed.frameIndex--;
    else if(index===ed.frameIndex)ed.frameIndex=Math.min(index,ed.frames.length-1);
    const visible=visibleFrameIndices(ed);if(ed.groupBaseName&&visible.length&&!visible.includes(ed.frameIndex))ed.frameIndex=visible[Math.min(visible.length-1,Math.max(0,visible.findIndex(i=>i>=ed.frameIndex)))];
    ed.selection=null;ed.selectionDrag=null;clearSelectionPath(ed);fitEditor(ed);render(ed);
  }
  function moveFrame(ed,from,to){
    if(!Number.isInteger(from)||!Number.isInteger(to)||from===to||from<0||to<0||from>=ed.frames.length||to>=ed.frames.length)return;
    pushUndoAllFrames(ed);const [frame]=ed.frames.splice(from,1);ed.frames.splice(to,0,frame);
    if(ed.frameIndex===from)ed.frameIndex=to;
    else if(from<ed.frameIndex&&to>=ed.frameIndex)ed.frameIndex--;
    else if(from>ed.frameIndex&&to<=ed.frameIndex)ed.frameIndex++;
    ed.frames.forEach(f=>f.layers.forEach(l=>l.__cache=null));fitEditor(ed);render(ed);
  }
  function startPlayback(ed){
    const visible=visibleFrameIndices(ed);if(visible.length<2){window.UIXApp?.status?.('Add at least two visible frames to play an animation');return;}
    stopPlayback(ed);ed.playing=true;
    const tick=()=>{const frames=visibleFrameIndices(ed);if(frames.length<2){stopPlayback(ed);render(ed);return;}let pos=frames.indexOf(ed.frameIndex);if(pos<0)pos=-1;selectFrame(ed,frames[(pos+1)%frames.length]);};
    ed.playTimer=setInterval(tick,Math.max(8,1000/clamp(Number(ed.fps)||8,1,120)));render(ed);
  }
  function stopPlayback(ed){if(ed?.playTimer!=null){clearInterval(ed.playTimer);ed.playTimer=null;}if(ed)ed.playing=false;}

  function resizeSprite(ed,w,h){const f=currentFrame(ed);w=clamp(Math.floor(w)||f.width,1,MAX_SIZE);h=clamp(Math.floor(h)||f.height,1,MAX_SIZE);pushUndo(ed,true);f.layers.forEach(l=>{l.pixels=fitPixelArray(l.pixels,w,h);l.__cache=null;});f.width=w;f.height=h;invalidateCache(f);syncFrameFields(ed);fitEditor(ed);render(ed);}

  function drawChecker(ctx,w,h,size=12){for(let y=0;y<h;y+=size)for(let x=0;x<w;x+=size){ctx.fillStyle=((x/size+y/size)&1)?'#2a2a2a':'#333';ctx.fillRect(x,y,size,size);}}
  function drawFrame(ctx,f,ed){ctx.imageSmoothingEnabled=false;const x0=-f.width/2,y0=-f.height/2;drawLayerStack(ctx,f,x0,y0);if(ed.showGrid&&ed.zoom>=4){ctx.strokeStyle='rgba(150,150,150,.22)';ctx.lineWidth=1/ed.zoom;ctx.beginPath();for(let x=0;x<=f.width;x++){const xx=x0+x;ctx.moveTo(xx,y0);ctx.lineTo(xx,y0+f.height);}for(let y=0;y<=f.height;y++){const yy=y0+y;ctx.moveTo(x0,yy);ctx.lineTo(x0+f.width,yy);}ctx.stroke();}ctx.strokeStyle='rgba(220,220,220,.75)';ctx.lineWidth=1/ed.zoom;ctx.strokeRect(x0,y0,f.width,f.height);}
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
  function selectionAction(ed,a){
    if(a==='selectall'){if(ed.selection?.floating)commitFloatingSelection(ed,false);selectAll(ed);render(ed);return;}
    if(a==='delete'){requestDeleteSelection(ed);return;}
    const sel=ed.selection,f=currentFrame(ed);
    if(a==='cancel'){ed.lassoPoints=[];ed.lassoDrawing=false;ed.selectionRect=null;ed.selection=null;ed.selectionDrag=null;ed.selectionMode='set';ed.selectionGestureMode='set';render(ed);return;}
    if(a==='copy'){
      if(!sel)return;
      ed.clipboard={width:sel.width,height:sel.height,pixels:clonePixels(sel.pixels),mask:[...sel.mask].map(key=>{const [x,y]=key.split(',').map(Number);return [x-sel.x,y-sel.y];})};render(ed);return;
    }
    if(a==='cut'){
      if(!sel)return;
      ed.clipboard={width:sel.width,height:sel.height,pixels:clonePixels(sel.pixels),mask:[...sel.mask].map(key=>{const [x,y]=key.split(',').map(Number);return [x-sel.x,y-sel.y];})};
      if(sel.floating){ed.selection=null;ed.selectionDrag=null;render(ed);return;}
      pushUndo(ed);for(const key of sel.mask){const [x,y]=key.split(',').map(Number);if(x>=0&&y>=0&&x<f.width&&y<f.height){f.pixels[y][x]=transparent();updateCachePixel(f,x,y,f.pixels[y][x]);}}
      invalidateCache(f);ensureFrameCache(f);ed.selection=null;render(ed);return;
    }
    if(a==='paste'){
      if(!ed.clipboard)return;
      if(ed.selection?.floating)ed.selection=null;
      const center=ed.lastCell||{x:Math.floor(f.width/2),y:Math.floor(f.height/2)},clip=ed.clipboard;
      const ox=clamp(Math.round(center.x-clip.width/2),0,Math.max(0,f.width-clip.width)),oy=clamp(Math.round(center.y-clip.height/2),0,Math.max(0,f.height-clip.height));
      const srcMask=Array.isArray(clip.mask)&&clip.mask.length?clip.mask:Array.from({length:clip.height},(_,y)=>Array.from({length:clip.width},(_,x)=>[x,y])).flat();
      const mask=new Set();for(const pair of srcMask){const cx=Number(pair?.[0]),cy=Number(pair?.[1]),x=ox+cx,y=oy+cy;if(Number.isFinite(x)&&Number.isFinite(y)&&cx>=0&&cy>=0&&cx<clip.width&&cy<clip.height&&x>=0&&y>=0&&x<f.width&&y<f.height)mask.add(`${x},${y}`);}
      ed.selection={x:ox,y:oy,width:clip.width,height:clip.height,pixels:clonePixels(clip.pixels),mask,floating:true};ed.selectionDrag=null;ed.tool='lasso';ed.lassoPoints=[];ed.lassoDrawing=false;render(ed);return;
    }
  }
  function commitFloatingSelection(ed,renderAfter=true){
    const sel=ed.selection;if(!sel?.floating)return false;
    const f=currentFrame(ed);pushUndo(ed);
    for(const key of sel.mask){const [x,y]=key.split(',').map(Number),px=sel.pixels?.[y-sel.y]?.[x-sel.x];if(!px||px[3]===0||x<0||y<0||x>=f.width||y>=f.height)continue;f.pixels[y][x]=sourceOverPixel(f.pixels[y][x],px,1);}
    invalidateCache(f);ensureFrameCache(f);ed.selection=null;ed.selectionDrag=null;if(renderAfter)render(ed);return true;
  }

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
      if(s.floating){for(const key of mask){const [mx,my]=key.split(',').map(Number),px=s.pixels?.[my-s.y]?.[mx-s.x];if(!px||px[3]===0)continue;ctx.fillStyle=cssRgba(px);ctx.fillRect(mx-f.width/2,my-f.height/2,1,1);}}
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
  function renderTextureSettings(ed){
    const q=s=>ed.modal.querySelector(s),settings=ed.textureSettings||{};
    ed.modal.querySelectorAll('[data-texture-setting]').forEach(input=>{const key=input.dataset.textureSetting;if(input.type==='checkbox')input.checked=!!settings[key];else input.value=String(settings[key]??input.value);});
    const mix=q('[data-texture-mix-options]'),randomize=q('[data-texture-randomize-options]'),spriteRandom=q('[data-texture-sprite-random-options]');
    if(mix)mix.hidden=!settings.mixColor;if(randomize)randomize.hidden=!settings.randomizeBrush;if(spriteRandom)spriteRandom.hidden=!settings.randomizeBrush||settings.randomize!=='Sprite';
  }
  function render(ed){
    renderCanvasOnly(ed);
    const q=s=>ed.modal.querySelector(s); if(!q('[data-sprite-paint]'))return;
    const f=currentFrame(ed);
    q('[data-editor-subtitle]').textContent=`${ed.name} · ${f.width}×${f.height}`;
    q('[data-sprite-zoom]').textContent=`${Math.round(ed.zoom*100)}%`;q('[data-sprite-coord]').textContent=ed.lastCell?`${ed.lastCell.x}, ${ed.lastCell.y}`:'—, —';q('[data-sprite-size-label]').textContent=String(ed.brushSize);q('[data-sprite-brush-strength]').value=String(ed.brushStrength);q('[data-sprite-brush-strength-label]').textContent=`${ed.brushStrength}%`;q('[data-pencil-shape]').value=ed.brushShape;const pencilSettings=q('[data-pencil-settings]');if(pencilSettings)pencilSettings.hidden=ed.tool!=='pencil';
    const colorLabel=q('[data-sprite-color-label]');if(colorLabel)colorLabel.textContent=rgbaToHex(ed.color);q('[data-sprite-color-swatch]').style.background=cssRgba(ed.color);
    q('[data-mirror="x"]').textContent=`Mirror X: ${ed.mirrorX?'On':'Off'}`;q('[data-mirror="y"]').textContent=`Mirror Y: ${ed.mirrorY?'On':'Off'}`;q('[data-mirror="x"]').classList.toggle('active',ed.mirrorX);q('[data-mirror="y"]').classList.toggle('active',ed.mirrorY);q('[data-perfect-shape]').checked=!!ed.perfectShape;
    q('[data-sprite-name]').value=ed.name;q('[data-frame-name]').value=currentFrame(ed)?.name||ed.name;syncFrameFields(ed);ed.modal.querySelectorAll('.sprite-tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===ed.tool));
    const texControls=q('[data-texture-brush-controls]'),texName=q('[data-texture-brush-name]'),texButton=q('.sprite-tool[data-tool="texture"]');if(texControls)texControls.hidden=ed.tool!=='texture';if(texName)texName.textContent=ed.textureBrush?.name||'No sprite selected';if(texButton)texButton.title=ed.textureBrush?`Texture Brush: ${ed.textureBrush.name}`:'Choose a sprite texture to brush';renderTextureSettings(ed);
    ed.modal.querySelectorAll('[data-sprite-selection]').forEach(b=>{if(b.dataset.spriteSelection==='paste')b.disabled=!ed.clipboard;else if(b.dataset.spriteSelection==='cancel')b.disabled=!ed.selection&&!ed.lassoDrawing&&!ed.lassoPoints.length&&!ed.selectionRect;else b.disabled=!ed.selection;});ed.modal.querySelectorAll('[data-lasso-mode]').forEach(b=>b.classList.toggle('active',b.dataset.lassoMode===(ed.selectionMode||'set')));
    const play=q('[data-frame-action="play"]');if(play)play.innerHTML=`${glyph(ed.playing?'pause':'play')}${ed.playing?'Pause':'Play'}`;
    const mq=q('[data-modulate-color]');if(mq)mq.value=rgbaToHex(ed.modulateColor);const ms=q('[data-modulate-color-swatch]');if(ms)ms.style.background=cssRgba(ed.modulateColor);const strength=q('[data-modulate-strength]');if(strength)strength.value=String(ed.modulateStrength);const sl=q('[data-modulate-strength-label]');if(sl)sl.textContent=`${ed.modulateStrength}%`;
    const previewToggle=q('[data-sprite-toggle-preview]');if(previewToggle){previewToggle.textContent=ed.showPreview?'▧ Preview':'▧ Preview Off';previewToggle.classList.toggle('active',!!ed.showPreview);}const mergeFrame=q('[data-frame-action="merge-down"]');if(mergeFrame)mergeFrame.disabled=frameBelowIndex(ed,ed.frameIndex)<0;
    const inspectorToggle=q('[data-sprite-toggle-inspector]');if(inspectorToggle)inspectorToggle.textContent=ed.modal.querySelector('.sprite-inspector-panel')?.classList.contains('mobile-visible')?'Hide Inspector':'▤ Layers';
    renderPreview(ed);renderFrameList(ed);renderLayerList(ed);
  }
  function syncFrameFields(ed){const f=currentFrame(ed),q=s=>ed.modal.querySelector(s);q('[data-sprite-width]').value=f.width;q('[data-sprite-height]').value=f.height;q('[data-sprite-fps]').value=ed.fps;q('[data-frame-count]').textContent=String(visibleFrameIndices(ed).length);}
  function renderFrameList(ed){
    const host=ed.modal.querySelector('[data-frame-list]');if(!host)return;host.innerHTML='';
    const indices=visibleFrameIndices(ed);
    if(!indices.length){const note=document.createElement('div');note.className='sprite-frame-hint';note.textContent=`No frames match “${ed.groupBaseName}”. Rename this frame back to the sequence name or Undo to restore it; it remains available to save as its own asset.`;host.append(note);return;}
    indices.forEach((i,visiblePosition)=>{const f=ed.frames[i];const row=document.createElement('div');row.className=`sprite-frame-row${i===ed.frameIndex?' selected':''}`;row.draggable=true;row.dataset.frameIndex=i;const thumb=document.createElement('canvas');thumb.width=56;thumb.height=56;thumb.className='sprite-frame-thumb';drawPreview(thumb,f);const info=document.createElement('div');info.className='sprite-frame-info';info.innerHTML=`<strong>Frame ${visiblePosition+1}</strong><span>${esc(f.name||ed.name)}</span>`;const del=document.createElement('button');del.type='button';del.className='mini-action danger sprite-frame-delete';del.title='Delete frame';del.textContent='×';del.disabled=ed.frames.length===1;del.addEventListener('click',e=>{e.stopPropagation();deleteFrame(ed,i);});row.append(thumb,info,del);row.addEventListener('click',()=>selectFrame(ed,i));row.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain',String(i)));row.addEventListener('dragover',e=>e.preventDefault());row.addEventListener('drop',e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain'));if(Number.isInteger(from))moveFrame(ed,from,i);});host.append(row);});
  }
  function drawPreview(canvas,f){const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;drawChecker(ctx,w,h,8);const s=Math.min((w-8)/Math.max(1,f.width),(h-8)/Math.max(1,f.height));ctx.imageSmoothingEnabled=false;ctx.save();ctx.translate((w-f.width*s)/2,(h-f.height*s)/2);ctx.scale(s,s);drawLayerStack(ctx,f,0,0);ctx.restore();}
  function setPreviewVisibility(ed,visible){ed.showPreview=!!visible;const card=ed.modal.querySelector('[data-preview-card]');if(card)card.classList.toggle('hidden-preview',!ed.showPreview);const button=ed.modal.querySelector('[data-sprite-toggle-preview]');if(button){button.textContent=ed.showPreview?'▧ Preview':'▧ Preview Off';button.classList.toggle('active',ed.showPreview);}}
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
    drawLayerStack(ctx,f,0,0);
    ctx.restore();
  }
  function renderStatus(ed,cell){const e=ed.modal.querySelector('[data-sprite-coord]');if(e)e.textContent=cell?`${cell.x}, ${cell.y}`:'—, —';}
  function syncColor(ed){const h=rgbaToHex(ed.color),q=s=>ed.modal.querySelector(s);q('[data-sprite-color]').value=h;q('[data-sprite-color-swatch]').style.background=cssRgba(ed.color);}

  function pixelsToDataURL(pixels,w,h){const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d'),data=ctx.createImageData(w,h);let i=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const px=pixels[y]?.[x]||transparent();data.data[i++]=px[0];data.data[i++]=px[1];data.data[i++]=px[2];data.data[i++]=px[3];}ctx.putImageData(data,0,0);return c.toDataURL('image/png');}
  function toPngAsset(ed,f,index){
    const c=document.createElement('canvas');c.width=f.width;c.height=f.height;const ctx=c.getContext('2d');ctx.clearRect(0,0,f.width,f.height);drawLayerStack(ctx,f,0,0);
    const stem=(ed.name.trim()||'Sprite');const multi=ed.frames.length>1;const suffix=/\d$/.test(stem)?'_':'';const named=String(f.name||'').trim().replace(/\.(png|webp|jpe?g)$/i,'').replace(/[\\/:*?"<>|]/g,'_');const fileBase=named|| (multi?`${stem}${suffix}${index+1}`:stem);
    const spriteLayers=f.layers.map(l=>({name:l.name,visible:l.visible!==false,opacity:clamp(Number(l.opacity??1),0,1),value:pixelsToDataURL(l.pixels,f.width,f.height)}));
    return{name:`${fileBase}.png`,value:c.toDataURL('image/png'),type:'image/png',kind:'Raster',editable:true,width:f.width,height:f.height,filename:`${fileBase}.png`,spriteLayers,activeLayer:f.activeLayer||0};
  }
  function saveEditor(ed){stopPlayback(ed);if(ed.selection?.floating)commitFloatingSelection(ed,false);if(ed.tool==='point')commitPointPath(ed);const frames=ed.frames.map((f,i)=>toPngAsset(ed,f,i));const sources=ed.frames.map(f=>f.sourceAsset||null);const app=window.UIXApp;if(app?.saveSpriteFrames)app.saveSpriteFrames(ed.sourceAssets,frames,sources);else frames.forEach(f=>app?.addSpriteAsset?.(f));app?.status?.(`${frames.length} frame${frames.length===1?'':'s'} saved as PNG`);closeEditor(ed);}
  function closeEditor(ed){if(activeEditor===ed)activeEditor=null;stopPlayback(ed);ed.modal._resizeObserver?.disconnect();window.UIXApp?.closeModal?.(ed.modal);ed.modal.remove();}

  function requestDeleteSelection(ed){
    if(!ed?.selection?.mask?.size)return;
    if(ed.selection.floating){ed.selection=null;ed.selectionDrag=null;render(ed);return;}
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
      case'escape':if(ed.selection||ed.lassoDrawing||ed.lassoPoints.length||ed.selectionRect)selectionAction(ed,'cancel');else closeEditor(ed);break;
      case'delete':requestDeleteSelection(ed);break;
    }
  }
  window.UIXSpriteEditor={openCreate,openEdit,openEditMany,handleShortcut,importSpriteAsset:importSpriteAssetIntoEditor};
})();
