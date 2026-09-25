(() => {
  'use strict';

  const { NodeSettings, COMPONENT_LABELS, createComponent, createNode, normalizeNode } = window.UIXNodeConfig;
  const { Assets } = window.UIXAssets;
  const { scriptNodes } = window.UIXScriptNodes;
  const { createJoystick } = window.UIXUIComponents;

  const state = {
    project: { name: 'Untitled Node2D', created: false },
    scenes: [],
    currentSceneId: '',
    selectedId: 'scene-camera',
    mode: 'select',
    panels: { selectionPanel: true, componentPanel: true },
    nextNodeId: 1,
    nextVariableId: 1,
    globalVariables: [],
    sceneVariablesByScene: Object.create(null),
    localVarsByNode: Object.create(null),
    uiComponentsByScene: Object.create(null),
    assets: Assets,
    activeAssetTab: 'Sprite',
    pan: { x: 0, y: 0 },
    zoom: 1,
    panelWidths: { dock: 570, split: 50, selection: 285, component: 285 },
    color: null,
    animationEdit: null,
    assetSelection: null,
    componentClipboard: null,
    nodeClipboard: null,
    selectedIds: [],
    selectionAnchorId: null,
    history: { undo: [], redo: [], busy: false },
    camera: {
      enabled: true,
      followId: 'this',
      horizontal: 0,
      vertical: 0,
      animation: 'Smooth',
      speed: 300,
      bgColor: '#202020',
      scale: 1,
      transform: { position: [0, 0], angle: [0] }
    },
    script: {
      nodeId: null, selectedNodeId: null, selectedNodeIds: [], selectionAnchorId: null, pan: { x: 0, y: 0 }, zoom: 1,
      nodesByNode: Object.create(null), connectionsByNode: Object.create(null), viewsByNode: Object.create(null),
      editingInput: null, clipboard: null, panelWidths:{left:260,right:250}, leftCollapsed:false, rightCollapsed:false
    },
    dragTree: null,
    runtime: { running: false, debug: false, bodies: [], camera: null, timers: [], intervalStates: Object.create(null), audio: [], lastError: '', events: { key: Object.create(null), lastKey: '' }, mic: { enabled: false, decibel: -100, speech: '', stream: null, audioContext: null, source: null, analyser: null, buffer: null, speechRecognition: null, speechActive: false, pickupActive: false } },
    game: { preferredSceneId: '', screenType: 'Windowboxing', requirements: { 'Use Mic': false }, mic: { speechLanguage: 'en-US', continuous: true, interimResults: true } },
    ui: {
      componentCollapsed: Object.create(null),
      globalVariablesCollapsed: false,
      sceneVariablesCollapsed: false,
      localVariablesCollapsed: false,
      scriptGroupCollapsed: Object.create(null),
      expressionGroupCollapsed: Object.create(null),
      variableCollapsed: Object.create(null),
      selectedComponentKey: ''
    }
  };

  let longPressTimer = null;
  let modalStack = [];
  let confirmAction = null;
  let suppressClickUntil = 0;
  let assetImageCache = new Map();
  let dpr = 1;
  let editorAnimationRAF = 0;
  const EDITOR_SETTINGS_STORE='uix.editor.settings.v1';
  const CURRENT_PROJECT_SESSION_NAME='uix.currentProject.name';
  const CURRENT_PROJECT_SESSION_ID='uix.currentProject.localNdcId';
  const DEFAULT_EDITOR_SETTINGS={moveScaleSnap:1,rotateSnap:0,autoSave:false,autoSaveIntervalSec:30};
  let autoSaveTimer=0;
  function getEditorSettings(){
    let out={...DEFAULT_EDITOR_SETTINGS};
    try{const saved=JSON.parse(localStorage.getItem(EDITOR_SETTINGS_STORE)||'null');if(saved&&typeof saved==='object'){Object.keys(DEFAULT_EDITOR_SETTINGS).forEach(k=>{if(Object.prototype.hasOwnProperty.call(saved,k))out[k]=saved[k];});out.moveScaleSnap=Number.isFinite(Number(out.moveScaleSnap))?Math.max(0,Number(out.moveScaleSnap)):DEFAULT_EDITOR_SETTINGS.moveScaleSnap;out.rotateSnap=Number.isFinite(Number(out.rotateSnap))?Math.max(0,Number(out.rotateSnap)):DEFAULT_EDITOR_SETTINGS.rotateSnap;out.autoSave=!!out.autoSave;out.autoSaveIntervalSec=Number.isFinite(Number(out.autoSaveIntervalSec))?clamp(Number(out.autoSaveIntervalSec),1,86400):DEFAULT_EDITOR_SETTINGS.autoSaveIntervalSec;}}catch{}
    return out;
  }
  function saveEditorSettings(settings){const value={...getEditorSettings(),moveScaleSnap:Math.max(0,Number(settings?.moveScaleSnap)||0),rotateSnap:Math.max(0,Number(settings?.rotateSnap)||0),autoSave:!!settings?.autoSave,autoSaveIntervalSec:clamp(Number(settings?.autoSaveIntervalSec)||30,1,86400)};try{localStorage.setItem(EDITOR_SETTINGS_STORE,JSON.stringify(value));}catch{}resetAutoSaveTimer();return value;}
  function resetAutoSaveTimer(){clearTimeout(autoSaveTimer);autoSaveTimer=0;const st=getEditorSettings();if(!st.autoSave||!hasLoadedProject())return;autoSaveTimer=setTimeout(async()=>{if(hasLoadedProject()){await saveProjectToProjectStorage(true);}resetAutoSaveTimer();},Math.max(1,Number(st.autoSaveIntervalSec)||30)*1000);}
  function rememberCurrentProjectSession(){try{if(!state.project?.created){sessionStorage.removeItem(CURRENT_PROJECT_SESSION_NAME);sessionStorage.removeItem(CURRENT_PROJECT_SESSION_ID);return;}sessionStorage.setItem(CURRENT_PROJECT_SESSION_NAME,String(state.project.name||'Untitled Node2D'));if(state.project.localNdcId)sessionStorage.setItem(CURRENT_PROJECT_SESSION_ID,String(state.project.localNdcId));else sessionStorage.removeItem(CURRENT_PROJECT_SESSION_ID);}catch{}}
  function clearCurrentProjectSession(){try{sessionStorage.removeItem(CURRENT_PROJECT_SESSION_NAME);sessionStorage.removeItem(CURRENT_PROJECT_SESSION_ID);}catch{}}
  function readCurrentProjectSession(){try{return{name:sessionStorage.getItem(CURRENT_PROJECT_SESSION_NAME)||'',id:sessionStorage.getItem(CURRENT_PROJECT_SESSION_ID)||''};}catch{return{name:'',id:''};}}
  function snapEditorValue(value,step){const n=Number(value);if(!Number.isFinite(n)||!step||step<=0)return n;return Number((Math.round(n/step)*step).toFixed(12));}

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const clone = v => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(clone);
    const out = {};
    Object.keys(v).forEach(k => { out[k] = clone(v[k]); });
    return out;
  };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

  const SCREEN_TYPES=['Stretch','Windowboxing','Crop','Smart Camera'];
  function normalizeScreenType(v){ return SCREEN_TYPES.includes(v)?v:'Windowboxing'; }
  function defaultCamera(){ return { enabled:true, followId:'this', horizontal:0, vertical:0, animation:'Smooth', speed:300, bgColor:'#202020', scale:1, transform:{position:[0,0],angle:[0]} }; }
  function ensureSceneCamera(scene){ if(!scene)return defaultCamera(); if(!scene.camera) scene.camera=defaultCamera(); return scene.camera; }
  function syncSceneCamera(){ const scene=currentScene(); if(scene){ state.camera=ensureSceneCamera(scene); } }
  function makeScene(name) {
    return { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'scene'}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, nodes: [], camera: defaultCamera() };
  }
  function currentScene() { return state.scenes.find(s => s.id === state.currentSceneId) || state.scenes[0]; }

  function allNodes(scene = currentScene()) {
    const out = [];
    const walk = (items, parent = null) => (Array.isArray(items) ? items : []).forEach(node => {
      out.push({ node, parent });
      if (node.type === 'folder') walk(node.children, node);
    });
    walk(scene?.nodes);
    return out;
  }
  function findNode(id) { return allNodes().find(x => x.node.id === id)?.node || null; }
  function findContainer(id, items = currentScene()?.nodes) {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      if (item.id === id) return items;
      if (item.type === 'folder') {
        const result = findContainer(id, item.children);
        if (result) return result;
      }
    }
    return null;
  }
  function isDescendant(folder, id) {
    return folder?.type === 'folder' && (Array.isArray(folder.children) ? folder.children : []).some(child => child.id === id || (child.type === 'folder' && isDescendant(child, id)));
  }
  function nodeComponents(node) {
    if (!node) return [];
    normalizeNode(node);
    return Array.isArray(node.components) ? node.components : [];
  }
  function component(node, type) { return nodeComponents(node).find(c => c.type === type); }
  function selectedNode() {
    const value = currentSelection();
    return value && !value.special && value.type === 'node' ? value : null;
  }
  function currentSelection() {
    if (state.selectedId === 'scene-camera') return { special: 'camera', name: 'Scene Camera', id: 'scene-camera' };
    if (state.selectedId === 'global-variables') return { special: 'global', name: 'Global Variables', id: 'global-variables' };
    if (state.selectedId === 'ui-components') return { special: 'ui', name: 'UI Components', id: 'ui-components' };
    const joystick = sceneJoysticks().find(j => j.id === state.selectedId);
    if (joystick) return { special: 'joystick', name: `Joystick · ${joystick.variable || 'joystick'}`, id: joystick.id, joystick };
    return findNode(state.selectedId);
  }
  function selectionLabel() { return currentSelection()?.name || 'Nothing'; }
  function visibleTreeItems(scene=currentScene()){
    const out=[];
    const walk=(items)=>{(Array.isArray(items)?items:[]).forEach(n=>{out.push(n);if(n.type==='folder'&&!n.collapsed)walk(n.children);});};
    walk(scene?.nodes);return out;
  }
  function selectedSceneNodes(){
    const ids=new Set(Array.isArray(state.selectedIds)?state.selectedIds:[]);
    return visibleTreeItems().filter(n=>ids.has(n.id));
  }
  function normalizeSelectionState(){
    const valid=new Set(allNodes().map(x=>x.node.id));
    state.selectedIds=(Array.isArray(state.selectedIds)?state.selectedIds:[]).filter(id=>valid.has(id));
    if(state.selectedId&&!valid.has(state.selectedId)&&!['scene-camera','global-variables','ui-components'].includes(state.selectedId))state.selectedId=state.selectedIds.at(-1)||'scene-camera';
    if(state.selectionAnchorId&&!valid.has(state.selectionAnchorId))state.selectionAnchorId=null;
    if(state.selectedIds.length===1)state.selectedId=state.selectedIds[0];
  }
  function setNodeSelection(node,e={}){
    const id=node?.id;if(!id)return;
    const list=visibleTreeItems();const ids=list.map(n=>n.id);const primary=state.selectedId;
    if(e.shiftKey&&state.selectionAnchorId&&ids.includes(state.selectionAnchorId)){
      const a=ids.indexOf(state.selectionAnchorId),b=ids.indexOf(id),lo=Math.min(a,b),hi=Math.max(a,b);state.selectedIds=ids.slice(lo,hi+1);state.selectedId=id;
    }else if(e.ctrlKey||e.metaKey){
      const set=new Set(state.selectedIds||[]);if(set.has(id))set.delete(id);else set.add(id);state.selectedIds=list.filter(n=>set.has(n.id)).map(n=>n.id);state.selectedId=set.has(id)?id:(state.selectedIds.at(-1)||null);
    }else{state.selectedIds=[id];state.selectedId=id;}
    state.selectionAnchorId=id;state.ui.selectedComponentKey='';
    return primary!==state.selectedId||state.selectedIds.length>1;
  }
  function clearNodeSelection(fallback='scene-camera'){if(fallback&&findNode(fallback)){state.selectedIds=[fallback];state.selectionAnchorId=fallback;}else{state.selectedIds=[];state.selectionAnchorId=null;}state.selectedId=fallback;state.ui.selectedComponentKey='';}
  function topLevelSelectedItems(){
    const items=selectedSceneNodes(),set=new Set(items.map(n=>n.id));
    return items.filter(item=>!items.some(parent=>parent!==item&&parent.type==='folder'&&set.has(parent.id)&&isDescendant(parent,item.id)));
  }
  function packTreeScripts(item,out={}){
    if(!item)return out;
    if(item.type==='folder'){(item.children||[]).forEach(child=>packTreeScripts(child,out));}
    else out[item.id]={nodes:clone(state.script.nodesByNode[item.id]||[]),connections:clone(state.script.connectionsByNode[item.id]||[])};
    return out;
  }
  function packClipboardItem(item){const data=clone(item);return {sourceId:item.id,item:data,scripts:packTreeScripts(item)};}
  function remapPastedTree(item,packed,map){
    const old=item.id;item.id=`${item.type==='folder'?'folder':'node'}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;item.numericId=nextNodeNumericId();map.set(old,item.id);
    if(item.type==='folder'){item.children=(Array.isArray(item.children)?item.children:[]).map(ch=>remapPastedTree(ch,packed,map));}
    else normalizeNode(item);
    return item;
  }
  function restorePackedScripts(packed,map){
    const source=packed?.scripts||{};
    Object.entries(source).forEach(([oldId,g])=>{
      const newId=map.get(oldId);if(!newId)return;
      const scripts=clone(g.nodes||[]),con=clone(g.connections||[]),sm=new Map();
      scripts.forEach(sn=>{const old=sn.id;sn.id=`snode-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;sm.set(old,sn.id);});
      state.script.nodesByNode[newId]=scripts;state.script.connectionsByNode[newId]=con.map(c=>({...c,from:sm.get(c.from)||c.from,to:sm.get(c.to)||c.to}));
    });
  }
  function selectedMainItemsForCommand(){
    const selected=topLevelSelectedItems();return selected.length?selected:(selectedNode()?[selectedNode()]:[]);
  }

  function sceneUIComponents(scene = currentScene()) {
    const key = scene?.id || '__none__';
    return state.uiComponentsByScene[key] ||= { joysticks: [] };
  }
  function sceneJoysticks(scene = currentScene()) {
    const data = sceneUIComponents(scene);
    data.joysticks = Array.isArray(data.joysticks) ? data.joysticks : [];
    return data.joysticks;
  }
  function hasJoystickVariable(name, ignore = null) {
    const wanted = String(name || '').trim().toLowerCase();
    return !!wanted && sceneJoysticks().some(j => j !== ignore && String(j.variable || '').trim().toLowerCase() === wanted);
  }
  function addJoystick() {
    const list = sceneJoysticks();
    let i = 1, variable = i === 1 ? 'joystick' : `joystick${i}`;
    while (hasJoystickVariable(variable)) { i++; variable = `joystick${i}`; }
    const joystick = createJoystick(i);
    joystick.variable = variable;
    list.push(joystick);
    state.selectedId = 'ui-components';
    state.ui.selectedComponentKey = `joystick:${joystick.id}`;
    renderSelectionTree(); renderComponentPanel(); drawWorkplace();
    status('Joystick added');
  }
  function removeJoystick(joystick) {
    const list = sceneJoysticks();
    askConfirm('Delete Joystick', `Delete “${joystick.variable || 'joystick'}”?`, () => {
      const i = list.indexOf(joystick); if (i >= 0) list.splice(i, 1);
      renderComponentPanel(); drawWorkplace(); status('Joystick removed');
    });
  }
  function renderUIComponents(host) {
    const list = sceneJoysticks();
    const section = document.createElement('section'); section.className='ui-component-section';
    const head = document.createElement('button'); head.className='library-group-header'; head.type='button';
    head.innerHTML='<span>−</span>Joystick';
    const body = document.createElement('div'); body.className='ui-component-body';
    const groupKey='ui:joystick:group'; const groupCollapsed=!!state.ui.componentCollapsed[groupKey]; body.classList.toggle('hidden',groupCollapsed); head.firstElementChild.textContent=groupCollapsed?'+':'−';
    head.onclick=e=>{e.stopPropagation();state.ui.componentCollapsed[groupKey]=!state.ui.componentCollapsed[groupKey];body.classList.toggle('hidden',state.ui.componentCollapsed[groupKey]);head.firstElementChild.textContent=state.ui.componentCollapsed[groupKey]?'+':'−';};
    list.forEach((joystick, index) => {
      const key=`joystick:${joystick.id}`;
      const card=document.createElement('section'); card.className='component-card ui-joystick-card';
      const header=document.createElement('div'); header.className='component-card-header';
      const title=document.createElement('strong'); title.textContent=`Joystick · ${joystick.variable || index+1}`;
      const acts=document.createElement('div'); acts.className='comp-actions';
      const fold=document.createElement('button'); fold.textContent=state.ui.componentCollapsed[key]?'+':'−'; fold.title='Collapse';
      const del=document.createElement('button'); del.className='delete-component'; del.title='Delete Joystick'; del.textContent='×'; del.onclick=e=>{e.stopPropagation();removeJoystick(joystick);};
      acts.append(fold,del); header.append(title,acts); card.append(header);
      const content=document.createElement('div'); content.className='component-body'; const collapsed=!!state.ui.componentCollapsed[key]; content.classList.toggle('hidden',collapsed);
      fold.onclick=e=>{e.stopPropagation();state.ui.componentCollapsed[key]=!state.ui.componentCollapsed[key];content.classList.toggle('hidden',state.ui.componentCollapsed[key]);fold.textContent=state.ui.componentCollapsed[key]?'+':'−';};
      content.append(field('Variable',joystick.variable,'text',v=>{const n=String(v||'').trim();if(!n)return status('Joystick variable cannot be empty');if(hasJoystickVariable(n,joystick))return status('A joystick variable with that name already exists in this scene');joystick.variable=n;title.textContent=`Joystick · ${n}`;}));
      content.append(colorField('BG Color',joystick.bgColor,v=>{joystick.bgColor=v;drawWorkplace();}));
      content.append(colorField('Knob Color',joystick.knobColor,v=>{joystick.knobColor=v;drawWorkplace();}));
      content.append(axisVectorField('Size',joystick.size,(x,y)=>{joystick.size=[Math.max(1,x),Math.max(1,y)];drawWorkplace();}));
      ['left','top','right','bottom'].forEach(anchor=>content.append(field(anchor[0].toUpperCase()+anchor.slice(1),joystick.position[anchor] ?? '','text',v=>{joystick.position[anchor]=String(v).trim()===''?null:Number(v);drawWorkplace();})));
      card.append(content); body.append(card);
    });
    const add=document.createElement('button'); add.className='add-component-button'; add.innerHTML='<span>＋</span>Add Joystick'; add.onclick=addJoystick; body.append(add);
    section.append(head,body); host.append(section);
  }

  function status(message) {
    const el = $('#stageStatus'); if (!el) return;
    el.textContent = message;
    clearTimeout(status.timer);
    status.timer = setTimeout(() => el.textContent = 'Ready', 1800);
  }
  function showOfflineToast(message='Loaded in Offline Mode'){
    let el=$('#uixOfflineToast');
    if(!el){
      el=document.createElement('div');el.id='uixOfflineToast';el.className='uix-offline-toast';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.append(el);
    }
    el.textContent=message;el.classList.add('open');clearTimeout(showOfflineToast.timer);showOfflineToast.timer=setTimeout(()=>el.classList.remove('open'),2600);
  }
  let node2DInstallPrompt=null;
  function isNode2DInstalled(){
    try{
      return !!(window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || window.matchMedia?.('(display-mode: window-controls-overlay)').matches || navigator.standalone===true);
    }catch{return false;}
  }
  function updateNode2DInstallUI(){
    const hidden=isNode2DInstalled() || !node2DInstallPrompt;
    $$('[data-node2d-install]').forEach(el=>{el.hidden=hidden;});
  }
  async function installNode2DApp(){
    if(isNode2DInstalled()){updateNode2DInstallUI();return;}
    const prompt=node2DInstallPrompt;
    if(!prompt){status('Node2D installation is not available here');return;}
    try{
      await prompt.prompt();
      const choice=await prompt.userChoice;
      node2DInstallPrompt=null;
      updateNode2DInstallUI();
      if(choice?.outcome==='accepted')status('Node2D is installing…');
    }catch{
      node2DInstallPrompt=null;
      updateNode2DInstallUI();
      status('Use the browser install option to install Node2D');
    }
  }
  function setupNode2DInstall(){
    if(window.__UIXInstallHooksInstalled)return;
    window.__UIXInstallHooksInstalled=true;
    window.addEventListener('beforeinstallprompt',e=>{
      node2DInstallPrompt=e;
      updateNode2DInstallUI();
    });
    window.addEventListener('appinstalled',()=>{
      node2DInstallPrompt=null;
      updateNode2DInstallUI();
    });
    window.addEventListener('pageshow',updateNode2DInstallUI);
    updateNode2DInstallUI();
  }
  function installEditorServiceWorker(){
    setupNode2DInstall();
    if(window.__UIXServiceWorkerInstalled)return;
    window.__UIXServiceWorkerInstalled=true;
    if(!('serviceWorker' in navigator))return;
    navigator.serviceWorker.addEventListener('message',e=>{
      if(e.data?.type==='uix-offline-mode')showOfflineToast('Loaded in Offline Mode');
      if(e.data?.type==='uix-online-update')showOfflineToast('Online — newest files are being saved');
    });
    window.addEventListener('offline',()=>showOfflineToast('Offline Mode'));
    navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{
      reg.update().catch(()=>{});
      if(!navigator.onLine)showOfflineToast('Loaded in Offline Mode');
    }).catch(()=>{});
  }

  function historySnapshot(){return clone({scenes:state.scenes,currentSceneId:state.currentSceneId,selectedId:state.selectedId,selectedIds:state.selectedIds,selectionAnchorId:state.selectionAnchorId,globalVariables:state.globalVariables,sceneVariablesByScene:state.sceneVariablesByScene,localVarsByNode:state.localVarsByNode,uiComponentsByScene:state.uiComponentsByScene,script:{nodesByNode:state.script.nodesByNode,connectionsByNode:state.script.connectionsByNode},game:state.game});}
  function restoreHistorySnapshot(snap){if(!snap)return;state.scenes=clone(snap.scenes||[]);state.currentSceneId=snap.currentSceneId||state.scenes[0]?.id||'';state.selectedId=snap.selectedId||'scene-camera';state.selectedIds=clone(snap.selectedIds||[]);state.selectionAnchorId=snap.selectionAnchorId||state.selectedId;state.globalVariables=clone(snap.globalVariables||[]);state.sceneVariablesByScene=clone(snap.sceneVariablesByScene||{});state.localVarsByNode=clone(snap.localVarsByNode||{});state.uiComponentsByScene=clone(snap.uiComponentsByScene||{});state.script.nodesByNode=clone(snap.script?.nodesByNode||{});state.script.connectionsByNode=clone(snap.script?.connectionsByNode||{});state.game=clone(snap.game||{preferredSceneId:'',screenType:'Windowboxing'});state.game.screenType=normalizeScreenType(state.game.screenType);state.ui.selectedComponentKey='';syncSceneCamera();renderAll();}
  function pushHistory(){if(state.history.busy)return;state.history.undo.push(historySnapshot());if(state.history.undo.length>80)state.history.undo.shift();state.history.redo=[];}
  function undo(){const prev=state.history.undo.pop();if(!prev)return status('Nothing to undo');state.history.busy=true;state.history.redo.push(historySnapshot());restoreHistorySnapshot(prev);state.history.busy=false;status('Undo');}
  function redo(){const next=state.history.redo.pop();if(!next)return status('Nothing to redo');state.history.busy=true;state.history.undo.push(historySnapshot());restoreHistorySnapshot(next);state.history.busy=false;status('Redo');}
  function nextNodeNumericId(){const used=new Set(allNodes().map(({node})=>node.numericId).filter(Number.isFinite));let n=Math.max(1,state.nextNodeId||1);while(used.has(n))n++;state.nextNodeId=n+1;return n;}
  function uniqueNodeName(base,items){const names=new Set((items||[]).map(n=>String(n.name||'').toLowerCase()));let name=base||'Node';if(!names.has(name.toLowerCase()))return name;let i=2;while(names.has(`${name} ${i}`.toLowerCase()))i++;return `${name} ${i}`;}
  function remapScriptNodeIds(sourceId,targetId){const nodes=clone(state.script.nodesByNode[sourceId]||[]),con=clone(state.script.connectionsByNode[sourceId]||[]),map=new Map();nodes.forEach(sn=>{const old=sn.id;sn.id=`snode-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;map.set(old,sn.id);});state.script.nodesByNode[targetId]=nodes;state.script.connectionsByNode[targetId]=con.map(x=>({...x,from:map.get(x.from)||x.from,to:map.get(x.to)||x.to}));}
  function isNodeItem(item){ return !!item && (item.type === 'node' || item.type === 'folder'); }
  function copyNode(node=null){
    const items=selectedMainItemsForCommand().filter(isNodeItem);
    if(!items.length)return status('Nothing selected to copy');
    state.nodeClipboard={items:items.map(packClipboardItem),sourceIds:items.map(x=>x.id)};
    status(items.length===1?`${items[0].name} copied`:`${items.length} items copied`);
  }
  function cutNode(node=null){
    const items=topLevelSelectedItems().filter(isNodeItem);
    if(!items.length)return status('Nothing selected to cut');
    state.selectedIds=items.map(x=>x.id);state.selectedId=items.at(-1)?.id||node?.id||state.selectedId;copyNode();
    const names=items.map(x=>x.name).join(', ');
    askConfirm('Cut Selection',`Cut ${items.length===1?'“'+names+'”':items.length+' selected items'}?`,()=>deleteSelectedNodesNow(items), 'Cut');
  }
  function cloneTreeItem(item, options={}){
    if(!item)return null;
    const sourceId=item.id;
    const copy=clone(item);
    copy.id=`${item.type==='folder'?'folder':'node'}-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    copy.numericId=nextNodeNumericId();
    copy.name=uniqueNodeName(`${item.name|| (item.type==='folder'?'Folder':'Node')} Copy`, options.siblingItems||[]);
    if(item.type==='folder'){
      copy.collapsed=false;
      copy.children=(Array.isArray(item.children)?item.children:[]).map(child=>cloneTreeItem(child,{siblingItems:copy.children}));
    }else{
      normalizeNode(copy);
      const copiedScripts=clone(state.script.nodesByNode[sourceId]||[]);
      const copiedConnections=clone(state.script.connectionsByNode[sourceId]||[]);
      const map=new Map();
      copiedScripts.forEach(sn=>{const old=sn.id;sn.id=`snode-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;map.set(old,sn.id);});
      state.script.nodesByNode[copy.id]=copiedScripts;
      state.script.connectionsByNode[copy.id]=copiedConnections.map(c=>({...c,from:map.get(c.from)||c.from,to:map.get(c.to)||c.to}));
    }
    return copy;
  }
  function cloneFolder(folder){
    if(folder?.type!=='folder')return status('Select a Folder to clone');
    const scene=currentScene(); if(!scene)return;
    const container=findContainer(folder.id)||scene.nodes; const copy=cloneTreeItem(folder,{siblingItems:container});
    pushHistory(); const at=Math.max(0,container.findIndex(x=>x.id===folder.id)+1); container.splice(at,0,copy); clearNodeSelection(copy.id); renderAll(); status(`${copy.name} cloned`);
  }
  function pasteNode(){
    const clips=Array.isArray(state.nodeClipboard?.items)?state.nodeClipboard.items:state.nodeClipboard?.node?[{sourceId:state.nodeClipboard.sourceId,item:state.nodeClipboard.node,scripts:{[state.nodeClipboard.sourceId]:{nodes:clone(state.script.nodesByNode[state.nodeClipboard.sourceId]||[]),connections:clone(state.script.connectionsByNode[state.nodeClipboard.sourceId]||[])}}}]:[];
    if(!clips.length)return status('Paste is disabled until something is copied');
    const scene=currentScene();if(!scene)return;
    const selected=currentSelection();
    const targetContainer=selected?.type==='folder'?(selected.children ||= []):selectedNode()?findContainer(selectedNode().id)||scene.nodes:scene.nodes;
    pushHistory();
    const inserted=[];
    clips.forEach((packed,index)=>{
      const data=clone(packed.item);const oldName=data.name;const map=new Map();remapPastedTree(data,packed,map);data.name=uniqueNodeName(index===0?oldName:`${oldName}`,targetContainer);restorePackedScripts(packed,map);
      const anchor=selectedNode();const at=anchor&&targetContainer.findIndex(n=>n.id===anchor.id)>=0?targetContainer.findIndex(n=>n.id===anchor.id)+1+inserted.length:targetContainer.length;
      targetContainer.splice(at,0,data);inserted.push(data);
    });
    state.selectedIds=inserted.map(x=>x.id);state.selectionAnchorId=inserted.at(-1)?.id||null;state.selectedId=inserted.at(-1)?.id||state.selectedId;renderAll();status(inserted.length===1?`${inserted[0].name} pasted`:`${inserted.length} items pasted`);
  }
  function deleteSelectedNodesNow(items=selectedMainItemsForCommand()){
    const scene=currentScene();if(!scene)return;
    const targets=items.filter(x=>findNode(x.id));if(!targets.length)return;
    pushHistory();
    targets.forEach(node=>{const source=findContainer(node.id);if(!source)return;const i=source.findIndex(x=>x.id===node.id);if(i>=0)source.splice(i,1);delete state.script.nodesByNode[node.id];delete state.script.connectionsByNode[node.id];});
    clearNodeSelection('scene-camera');renderAll();status(targets.length===1?`${targets[0].name} deleted`:`${targets.length} items deleted`);
  }
  function deleteSelectedNodes(){
    const targets=topLevelSelectedItems();if(!targets.length){const n=selectedNode();if(n)targets.push(n);}
    if(!targets.length)return status('Nothing selected');
    askConfirm('Delete Selection',`Delete ${targets.length===1?'“'+targets[0].name+'”':targets.length+' selected items'}${targets.some(x=>x.type==='folder')?' and everything inside the selected folders':''}?`,()=>deleteSelectedNodesNow(targets));
  }
  function ensureGameSettings(){
    if(!state.game||typeof state.game!=='object')state.game={preferredSceneId:'',screenType:'Windowboxing'};
    state.game.screenType=normalizeScreenType(state.game.screenType);
    state.game.requirements=state.game.requirements&&typeof state.game.requirements==='object'?state.game.requirements:{};
    state.game.mic=state.game.mic&&typeof state.game.mic==='object'?state.game.mic:{};
    if(!state.game.mic.speechLanguage)state.game.mic.speechLanguage='en-US';
    state.game.mic.continuous=state.game.mic.continuous!==false;
    state.game.mic.interimResults=state.game.mic.interimResults!==false;
    new Set(scriptNodes.map(n=>n.require).filter(Boolean)).forEach(req=>{if(typeof state.game.requirements[req]!=='boolean')state.game.requirements[req]=false;});
    return state.game;
  }
  function scriptRequirementEnabled(def){ensureGameSettings();return !def?.require||state.game.requirements?.[def.require]===true;}
  function showScriptRequirementPrompt(def){const req=String(def?.require||'').trim();if(!req)return;askConfirm('ScriptNode Disabled',`“${def.name}” requires “${req}”. Go to Game Settings and enable it?`,()=>openGameSettings(),'Game Settings');}
  function enableScriptNodeRequirement(req,enabled){ensureGameSettings();state.game.requirements[req]=!!enabled;renderScriptLibrary();renderScriptCanvas();resetAutoSaveTimer();status(`${req}: ${enabled?'Enabled':'Disabled'}`);}

  function ensureProject() {
    ensureGameSettings();
    if (!state.scenes.length) {
      const scene = makeScene('Main');
      state.scenes = [scene]; state.currentSceneId = scene.id; state.game.preferredSceneId = scene.id; state.camera = scene.camera;
    } else {
      state.game.screenType = normalizeScreenType(state.game.screenType);
      if (!state.game.preferredSceneId || !state.scenes.some(s => s.id === state.game.preferredSceneId)) state.game.preferredSceneId = state.scenes[0].id;
      syncSceneCamera();
    }
  }

  function openProjectNameModal(){
    const input=$('#projectNameInput');
    if(input){input.value='';setTimeout(()=>input.focus(),0);}
    showModal($('#projectNameModal'));
  }

  function createProject(name='Untitled Node2D') {
    $('#appShell').classList.remove('exited');
    const scene = makeScene('Main');
    state.project.created = true;
    state.project.localNdcId = null;
    state.project.name = String(name||'Untitled Node2D').trim()||'Untitled Node2D';
    state.scenes = [scene]; state.currentSceneId = scene.id; state.selectedId = 'scene-camera'; state.game = { preferredSceneId: scene.id, screenType: 'Windowboxing', requirements:{'Use Mic':false}, mic:{speechLanguage:'en-US',continuous:true,interimResults:true} }; ensureGameSettings(); syncSceneCamera();
    state.nextNodeId = 1; state.nextVariableId = 1; state.globalVariables = [];
    state.sceneVariablesByScene = Object.create(null);
    state.localVarsByNode = Object.create(null);
    state.uiComponentsByScene = Object.create(null);
    state.pan = { x: 0, y: 0 }; state.zoom = 1;
    state.script = { nodeId: null, selectedNodeId: null, pan: { x: 0, y: 0 }, zoom: 1, nodesByNode: Object.create(null), connectionsByNode: Object.create(null), editingInput: null };
    state.history={undo:[],redo:[],busy:false}; state.nodeClipboard=null; state.componentClipboard=null; state.ui.selectedComponentKey='';
    hideAllModals(); renderAll(); rememberCurrentProjectSession(); resetAutoSaveTimer(); status('New Node2D project created');
  }

  function addScene() {
    ensureProject(); pushHistory();
    let i = 1, name = `Scene ${i}`;
    while (state.scenes.some(s => s.name === name)) name = `Scene ${++i}`;
    const scene = makeScene(name); state.scenes.push(scene); state.currentSceneId = scene.id; state.selectedId = 'scene-camera'; syncSceneCamera();
    closeMenus(); renderAll(); status(`${name} added`);
  }

  function addNode(name = null, configure = null) {
    ensureProject(); pushHistory();
    const used = new Set(allNodes().map(x => x.node.numericId).filter(Number.isFinite));
    let id = state.nextNodeId; while (used.has(id)) id++;
    state.nextNodeId = id + 1;
    const node = createNode(`node-${Date.now()}-${id}`, id, name || `Node ${id}`);
    configure?.(node);
    currentScene().nodes.push(node); state.selectedId = node.id;
    renderAll(); status(`${node.name} added`); return node;
  }

  function addNodeFromSprite(asset) {
    if (!asset?.value) return;
    const node = addNode(null, target => {
      const sprite = createComponent('sprite');
      sprite.name = asset.name || '';
      sprite.src = asset.value;
      sprite.sourceType = 'Sprite';
      sprite.animation = '';
      target.components.push(sprite);
      normalizeNode(target);
    });
    closeModal($('#assetModal'));
    status(`${node.name} created with Sprite ${asset.name || ''}`.trim());
    return node;
  }

  function addFolder(name = null) {
    ensureProject(); pushHistory();
    const id = state.nextNodeId++;
    const folder = { id: `folder-${Date.now()}-${id}`, type: 'folder', numericId: id, name: name || `Folder ${id}`, children: [], collapsed: false };
    currentScene().nodes.push(folder); state.selectedId = folder.id; renderAll(); status(`${folder.name} added`); return folder;
  }

  function renameScene(id) {
    const scene = state.scenes.find(s => s.id === id); if (!scene) return;
    promptModal('Rename Scene', 'Scene name', scene.name, value => { value = value.trim(); if (!value) return; scene.name = value; renderAll(); status('Scene renamed'); });
  }
  function deleteScene(id) {
    if (state.scenes.length <= 1) return status('At least one scene is required');
    const scene = state.scenes.find(s => s.id === id); if (!scene) return;
    askConfirm('Delete Scene', `Delete “${scene.name}”?`, () => {
      state.scenes = state.scenes.filter(s => s.id !== id); if (state.currentSceneId === id) state.currentSceneId = state.scenes[0].id;
      state.selectedId = 'scene-camera'; renderAll(); status('Scene deleted');
    });
  }

  function renderWorkplace(){ resizeWorkplaceCanvas(); drawWorkplace(); }

  function renderAll() {
    ensureProject(); applyTopbarAnchors(); renderScenes(); renderSelectionTree(); renderComponentPanel(); renderWorkplace();
    $('#stageSceneName').textContent = currentScene().name; $('#activeModeLabel').textContent = modeLabel(state.mode);
    applyPanelState(); updateZoomLabel(); resizeWorkplaceCanvas(); drawWorkplace();
  }
  function renderScenes() {
    const host = $('#sceneList'); host.innerHTML = '';
    state.scenes.forEach(scene => {
      const row = document.createElement('div'); row.className = `scene-row${scene.id === state.currentSceneId ? ' active' : ''}`; row.dataset.sceneId = scene.id;
      row.innerHTML = `<span class="node-icon">◇</span><span class="scene-row-name">${esc(scene.name)}</span><span class="scene-row-actions"><button class="mini-action" title="Rename">✎</button><button class="mini-action danger" title="Delete">×</button></span>`;
      $('.mini-action', row).addEventListener('click', e => { e.stopPropagation(); renameScene(scene.id); });
      $$('.mini-action', row)[1].addEventListener('click', e => { e.stopPropagation(); deleteScene(scene.id); });
      row.addEventListener('click', () => { state.currentSceneId = scene.id; state.selectedId = 'scene-camera'; syncSceneCamera(); closeMenus(); renderAll(); status(`Scene: ${scene.name}`); });
      host.append(row);
    });
  }

  function renderSelectionTree() {
    const host = $('#selectionTree'); host.innerHTML = '';
    const special = [
      ['scene-camera', '◉', 'Scene Camera'], ['global-variables', '◆', 'Global Variables'], ['ui-components', '▣', 'UI Components']
    ];
    special.forEach(([id, icon, name]) => {
      const selectedSpecial = state.selectedId === id || (id === 'ui-components' && !!sceneJoysticks().find(j => j.id === state.selectedId));
      const row = document.createElement('div'); row.className = `tree-node special-node${selectedSpecial ? ' selected' : ''}${id === 'ui-components' ? ' future-node' : ''}`; row.dataset.nodeId = id;
      row.innerHTML = `<div class="node-row" role="button" aria-selected="${state.selectedId === id}"><span class="twisty">+</span><span class="node-icon">${icon}</span><span class="node-name">${name}</span></div>`;
      row.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); clearNodeSelection(id); renderAll(); status(`Selected ${name}`); });
      row.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu([{ label: 'Select', action: () => { state.selectedId = id; renderAll(); } }], e.clientX, e.clientY); });
      host.append(row);
    });
    const separator = document.createElement('div'); separator.className = 'tree-separator'; host.append(separator);
    const label = document.createElement('div'); label.className = 'nodes-label'; label.textContent = 'Nodes'; host.append(label);
    const nodesHost = document.createElement('div'); nodesHost.id = 'sceneNodes'; host.append(nodesHost);
    renderTreeItems(nodesHost, currentScene().nodes, 0);
    const rootDrop = document.createElement('div'); rootDrop.className = 'root-drop'; rootDrop.innerHTML = '<span>↳</span> Drop here to place at scene root'; host.append(rootDrop);
    rootDrop.addEventListener('dragover', e => { e.preventDefault(); rootDrop.classList.add('drag-over'); });
    rootDrop.addEventListener('dragleave', () => rootDrop.classList.remove('drag-over'));
    rootDrop.addEventListener('drop', e => { e.preventDefault(); rootDrop.classList.remove('drag-over'); if (state.dragTree?.nodeId) moveToRoot(state.dragTree.nodeId); });
    const add = document.createElement('button'); add.className = 'add-folder'; add.innerHTML = '<span class="folder-plus-icon">▰＋</span>Add folder'; add.addEventListener('click', () => addFolder()); host.append(add);
  }

  function renderTreeItems(host, items, depth) {
    (Array.isArray(items) ? items : []).forEach(node => {
      normalizeSelectionState(); const wrap = document.createElement('div'); wrap.className = `tree-node scene-node${state.selectedIds.includes(node.id) ? ' selected' : ''}${state.selectedIds.length>1 && state.selectedIds.includes(node.id) ? ' multi-selected' : ''}`; wrap.dataset.nodeId = node.id; wrap.dataset.nodeType = node.type; wrap.draggable = true; wrap.style.paddingLeft = `${depth * 12}px`;
      wrap.style.width = '100%';
      const folder = node.type === 'folder'; const hasChildren = folder && Array.isArray(node.children) && node.children.length;
      wrap.innerHTML = `<div class="node-row"><span class="twisty">${folder ? (hasChildren ? (node.collapsed ? '+' : '−') : '·') : ''}</span><span class="node-icon ${folder ? 'folder-node-icon' : 'node-node-icon'}">${folder ? '▰' : '◇'}</span><span class="node-name">${esc(node.name)}</span><button type="button" class="tree-delete" title="Delete">×</button></div>`;
      $('.tree-delete', wrap).addEventListener('click', e => {e.stopPropagation();if(state.selectedIds.length>1&&state.selectedIds.includes(node.id))deleteSelectedNodes();else deleteTreeItem(node);});
      $('.node-row', wrap).addEventListener('contextmenu', e => {if(e.target.closest('.tree-delete'))return;});
      $('.node-row', wrap).addEventListener('click', e => {
        if (Date.now() < suppressClickUntil) return;
        if (e.target.closest('.tree-delete')) return;
        if (folder && e.target.closest('.twisty')) { node.collapsed = !node.collapsed; renderSelectionTree(); return; }
        setNodeSelection(node,e); renderSelectionTree(); renderComponentPanel(); drawWorkplace(); status(state.selectedIds.length>1?`${state.selectedIds.length} items selected`:`Selected ${node.name}`);
      });
      wrap.addEventListener('dragstart', e => { state.dragTree = { nodeId: node.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); wrap.classList.add('dragging'); });
      wrap.addEventListener('dragend', () => { state.dragTree = null; $$('.drag-over').forEach(x => x.classList.remove('drag-over')); wrap.classList.remove('dragging'); });
      wrap.addEventListener('dragover', e => { e.preventDefault(); if (state.dragTree?.nodeId !== node.id) wrap.classList.add('drag-over'); });
      wrap.addEventListener('dragleave', () => wrap.classList.remove('drag-over'));
      wrap.addEventListener('drop', e => { e.preventDefault(); wrap.classList.remove('drag-over'); const moving = findNode(state.dragTree?.nodeId); if (!moving || moving.id === node.id) return; folder ? moveIntoFolder(moving, node) : moveToRoot(moving.id); });
      const openTreeContext=e=>{
        e.preventDefault(); e.stopPropagation();
        if(!state.selectedIds.includes(node.id)) clearNodeSelection(node.id); else state.selectedId=node.id;
        renderSelectionTree(); renderComponentPanel(); drawWorkplace();
        const count=topLevelSelectedItems().length;
        const items=folder ? [{label:'Clone Folder',icon:'⧉',shortcut:'',action:()=>cloneFolder(node)},{label:'Copy',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('copy','editor'),action:()=>copyNode(node)},{label:'Cut',icon:'✂',shortcut:window.UIXKeyBinds?.shortcutFor('cut','editor'),action:()=>cutNode(node)},{label:'Paste',icon:'▣',shortcut:window.UIXKeyBinds?.shortcutFor('paste','editor'),disabled:!state.nodeClipboard,action:()=>pasteNode()},{label:'Delete',icon:'×',shortcut:window.UIXKeyBinds?.shortcutFor('delete','editor'),action:()=>deleteSelectedNodes()}] : [{label:'Cut',icon:'✂',shortcut:window.UIXKeyBinds?.shortcutFor('cut','editor'),action:()=>cutNode(node)},{label:'Copy',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('copy','editor'),action:()=>copyNode(node)},{label:'Paste',icon:'▣',shortcut:window.UIXKeyBinds?.shortcutFor('paste','editor'),disabled:!state.nodeClipboard,action:()=>pasteNode()},{label:'Duplicate',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('duplicate','editor'),disabled:false,action:()=>{copyNode(node);pasteNode();}},{label:'Delete',icon:'×',shortcut:window.UIXKeyBinds?.shortcutFor('delete','editor'),action:()=>deleteSelectedNodes()},{label:'Snap to Node',icon:'⌖',shortcut:window.UIXKeyBinds?.shortcutFor('snap','editor'),action:()=>snapSelectedMainNode()}];
        if(count>1)items.unshift({label:`${count} selected`,icon:'☷',disabled:true});
        showContextMenu(items,e.clientX??0,e.clientY??0);
      };
      wrap.addEventListener('contextmenu', openTreeContext);
      setupLongPress(wrap, openTreeContext);
      host.append(wrap);
      if (folder && !node.collapsed) { const childHost = document.createElement('div'); host.append(childHost); renderTreeItems(childHost, node.children, depth + 1); }
    });
  }

  function moveIntoFolder(moving, folder) {
    pushHistory(); if (moving === folder || (moving.type === 'folder' && isDescendant(moving, folder.id))) return status('Cannot move a folder into itself');
    const source = findContainer(moving.id); if (!source) return;
    const i = source.findIndex(x => x.id === moving.id); if (i < 0) return;
    source.splice(i, 1); folder.children = Array.isArray(folder.children) ? folder.children : []; folder.children.push(moving); folder.collapsed = false; state.selectedId = moving.id; renderAll(); status(`${moving.name} moved into ${folder.name}`);
  }
  function moveToRoot(id) {
    pushHistory(); const moving = findNode(id); if (!moving) return; const source = findContainer(id), root = currentScene().nodes;
    if (source && source !== root) { const i = source.findIndex(x => x.id === id); if (i >= 0) source.splice(i, 1); root.push(moving); state.selectedId = id; renderAll(); status(`${moving.name} moved to scene root`); }
  }
  function deleteTreeItem(node,skipConfirm=false) {
    const source=findContainer(node.id); if(!source)return;
    const perform=()=>{pushHistory();const i=source.findIndex(x=>x.id===node.id);if(i>=0)source.splice(i,1);state.selectedIds=(state.selectedIds||[]).filter(id=>id!==node.id);if(state.selectedId===node.id){state.selectedId=state.selectedIds.at(-1)||'scene-camera';state.ui.selectedComponentKey='';}renderAll();status(`${node.name} deleted`);};
    if(skipConfirm)perform();else askConfirm(`Delete ${node.type==='folder'?'Folder':'Node'}`,`Delete “${node.name}”${node.type==='folder'?' and everything inside it':''}?`,perform);
  }

  function renderComponentPanel() {
    const host = $('#componentContent');
    const keepScroll = host?.scrollTop || 0;
    host.innerHTML = ''; const selection = currentSelection(); $('#componentTarget').textContent = selection?.name || 'Nothing';
    const idEl = $('#selectionId'); if (idEl) idEl.textContent = selection && !selection.special ? String(selection.numericId ?? '—') : '—';
    if (!selection) return host.append(empty('Nothing selected.'));
    if (selection.special === 'camera') return renderCameraInspector(host);
    if (selection.special === 'global') return renderVariables(host, true);
    if (selection.special === 'ui') return renderUIComponents(host);
    if (selection.special === 'joystick') {
      const wrap=document.createElement('div');
      renderUIComponents(wrap);
      host.append(...Array.from(wrap.children));
      return;
    }
    if (selection.type === 'folder') return host.append(componentCard('Folder', [field('Name', selection.name, 'text', v => { selection.name = v; renderSelectionTree(); $('#componentTarget').textContent = v || 'Folder'; })], false, null, `folder:${selection.id}`));
    normalizeNode(selection);
    host.append(renderNodeCard(selection));
    const comps=nodeComponents(selection);
    const scriptComp=comps.find(c=>c.type==='script');
    if(scriptComp) host.append(renderComponentCard(selection,scriptComp));
    const transformComp=comps.find(c=>c.type==='transform');
    if(transformComp) host.append(renderComponentCard(selection,transformComp));
    comps.forEach(comp=>{ if(!['node','script','transform'].includes(comp.type)) host.append(renderComponentCard(selection,comp)); });
    requestAnimationFrame(() => { if (host) host.scrollTop = keepScroll; });
  }

  function cameraFollowOptions(){
    const options=['This'];
    allNodes().forEach(({node})=>{ if(node.type==='node') options.push(`${node.name} [${node.numericId}]`); });
    return options;
  }
  function setCameraFollow(label){
    if(label==='This'){ state.camera.followId='this'; return; }
    const m=String(label).match(/\[(\d+)\]$/);
    const node=m ? allNodes().find(({node})=>node.type==='node' && node.numericId===Number(m[1]))?.node : null;
    state.camera.followId=node?.id||'this';
  }
  function cameraFollowLabel(){
    if(state.camera.followId==='this') return 'This';
    const node=findNode(state.camera.followId);
    return node ? `${node.name} [${node.numericId}]` : 'This';
  }
  function renderCameraInspector(host) {
    host.append(componentCard('Camera', [
      checkboxField('Enabled', state.camera.enabled, v => { state.camera.enabled = v; }),
      field('Follow', cameraFollowLabel(), 'custom-select', v => { setCameraFollow(v); drawWorkplace(); }, cameraFollowOptions()),
      field('Horizontal', state.camera.horizontal, 'number', v => { state.camera.horizontal=Number(v)||0; drawWorkplace(); }),
      field('Vertical', state.camera.vertical, 'number', v => { state.camera.vertical=Number(v)||0; drawWorkplace(); }),
      field('Animation', state.camera.animation, 'custom-select', v => { state.camera.animation=v; }, ['Quick','Smooth']),
      field('Speed', state.camera.speed, 'number', v => { state.camera.speed=Math.max(0,Number(v)||0); }),
      field('Scale', state.camera.scale, 'number', v => { state.camera.scale=Math.max(0.01,Number(v)||0.01); drawWorkplace(); }),
      colorField('BG Color', state.camera.bgColor, v => { state.camera.bgColor=v; drawWorkplace(); })
    ], false, null, 'camera'));
    const t = state.camera.transform;
    host.append(componentCard('Transform', [axisVectorField('Position', t.position, (x,y) => { t.position=[x,y]; drawWorkplace(); }), field('Angle', t.angle[0], 'number', v => { t.angle=[Number(v)||0]; drawWorkplace(); })], false, null, 'camera-transform'));
  }

  function renderNodeCard(node) {
    const body = document.createDocumentFragment();
    const row = document.createElement('div'); row.className = 'property-row property-row-stack';
    const name = labeledInput('Name', node.name, v => { node.name = v; renderSelectionTree(); renderWorkplace(); $('#componentTarget').textContent = v || 'Node'; });
    const id = labeledInput('Id', node.numericId, v => changeNodeId(node, Number(v)), 'number');
    row.append(name, id); body.append(row);
    const nodeComp=nodeComponents(node).find(c=>c.type==='node');
    return componentCard('Node', body, false, null, `node:${node.id}`, {node,comp:nodeComp});
  }

  function changeNodeId(node, value) {
    if (!Number.isInteger(value) || value < 1) return status('Id must be a positive whole number');
    const other = allNodes().find(x => x.node.type === 'node' && x.node !== node && x.node.numericId === value)?.node;
    if (other) { const old = node.numericId; node.numericId = value; other.numericId = old; status(`Id ${old} ↔ ${value}`); }
    else { node.numericId = value; state.nextNodeId = Math.max(state.nextNodeId, value + 1); }
    renderSelectionTree(); renderComponentPanel(); drawWorkplace();
  }

  function renderComponentCard(node, comp) {
    let rows = [];
    switch (comp.type) {
      case 'script': rows = [field('Name', comp.name || '', 'text', v => comp.name = v), field('Edit', 'Edit', 'button', () => openScriptEditor(node))]; break;
      case 'transform': rows = [axisVectorField('Position', comp.position, (x,y) => { comp.position=[Number(x)||0,Number(y)||0]; drawWorkplace(); }), axisVectorField('Scale', comp.scale, (x,y) => { comp.scale=[Number.isFinite(Number(x))?Number(x):1, Number.isFinite(Number(y))?Number(y):1]; drawWorkplace(); }), field('Angle', comp.angle[0], 'number', v => { comp.angle=[Number(v)||0]; drawWorkplace(); })]; break;
      case 'text': rows = renderTextRows(node, comp); break;
      case 'sprite': {
        const animComp=component(node,'animationsprite');
        rows=[field('Type',comp.sourceType||'Sprite','custom-select',v=>{comp.sourceType=v;renderComponentPanel();drawWorkplace();},['Sprite','Animation']),checkboxField('Pixelated',!!comp.pixelated,v=>{comp.pixelated=v;drawWorkplace();}),axisVectorField('Position',comp.position||[0,0],(x,y)=>{comp.position=[x,y];drawWorkplace();}),axisVectorField('Size',comp.size||[0,0],(x,y)=>{comp.size=[Math.max(0,Number(x)||0),Math.max(0,Number(y)||0)];drawWorkplace();})];
        if((comp.sourceType||'Sprite')==='Animation'){
          const opts=(animComp?.animations||[]).map(a=>a.name);rows.push(field('Animation',comp.animation||opts[0]||'','custom-select',v=>{comp.animation=v;drawWorkplace();},opts));
          if(!animComp)rows.push(readOnlyField('Animation','Add Animation Sprite component first'));
        } else rows.push(assetField('Sprite',comp.src,'Sprite',asset=>{comp.name=asset.name;comp.src=asset.value;comp.sourceType='Sprite';renderComponentPanel();drawWorkplace();}));
        break; }
      case 'animationsprite': rows = renderAnimationRows(node, comp); break;
      case 'progressbar': {
        const radius=Array.isArray(comp.cornerRadius)?comp.cornerRadius:[0,0,0,0];
        rows=[field('Width',comp.width,'number',v=>{comp.width=Math.max(1,Number(v)||1);drawWorkplace();}),field('Height',comp.height,'number',v=>{comp.height=Math.max(1,Number(v)||1);drawWorkplace();}),field('Value',comp.value,'number',v=>{comp.value=Number(v)||0;drawWorkplace();}),field('Min',comp.min,'number',v=>{comp.min=Number(v)||0;drawWorkplace();}),field('Max',comp.max,'number',v=>{comp.max=Number(v)||0;drawWorkplace();}),axisVectorField('Position',comp.position,(x,y)=>{comp.position=[x,y];drawWorkplace();}),colorField('BG Color',comp.bgCol,v=>{comp.bgCol=v;drawWorkplace();}),colorField('Fill Color',comp.fillCol,v=>{comp.fillCol=v;drawWorkplace();}),cornerRadiusFields(radius,v=>{comp.cornerRadius=v;drawWorkplace();}),colorField('Outline Color',comp.outline?.color||'#000000FF',v=>{comp.outline.color=v;drawWorkplace();}),field('Outline Size',comp.outline?.size??0,'number',v=>{comp.outline.size=Math.max(0,Number(v)||0);drawWorkplace();}),field('Direction',comp.direction,'custom-select',v=>{comp.direction=v;drawWorkplace();},['left','right'])];
        break; }
      case 'physics': rows = [field('Body', comp.body, 'custom-select', v => { comp.body=v; drawWorkplace(); }, ['Static','Kinematic','Dynamic']), field('Gravity', comp.gravity, 'number', v => comp.gravity=Number(v)||0), field('Friction', comp.friction, 'number', v => comp.friction=Math.max(0, Number(v)||0),), field('Bounciness', comp.bounciness, 'number', v => comp.bounciness=clamp(Number(v)||0,0,1)), checkboxField('Fixed Rotation', !!comp.fixedRotation, v => { comp.fixedRotation=!!v; drawWorkplace(); }), checkboxField('isCollider', !!comp.isCollider, v => { comp.isCollider=!!v; drawWorkplace(); })]; break;
      case 'collider': rows = [checkboxField('Collider', comp.collidable !== false, v => { comp.collidable=!!v; drawWorkplace(); }), axisVectorField('Position', comp.transform.position, (x,y) => { comp.transform.position=[Number(x)||0,Number(y)||0]; drawWorkplace(); }), axisVectorField('Scale', comp.transform.scale, (x,y) => { comp.transform.scale=[Number(x),Number(y)]; drawWorkplace(); }), field('Angle', comp.transform.angle[0], 'number', v => { comp.transform.angle=[Number(v)||0]; drawWorkplace(); }), field('Type', comp.shapeType || 'Rect', 'custom-select', v => { comp.shapeType=v; drawWorkplace(); }, ['Rect','Circle','Triangle'])]; break;
      default: rows = [readOnlyField('Status', 'Component not implemented')];
    }
    const removable = NodeSettings[comp.type]?.removable === true;
    return componentCard(COMPONENT_LABELS[comp.type] || comp.type, rows, removable, () => removeComponent(node, comp), `node:${node.id}:${comp.type}`, {node,comp});
  }

  function renderTextRows(node, comp) {
    const radius = Array.isArray(comp.border?.radius) ? comp.border.radius : [0,0,0,0];
    return [
      colorField('FG Color', comp.fgcol, v => { const old=comp.fgcol; if(!comp.border?.color||comp.border.color===old) comp.border.color=v; comp.fgcol=v; drawWorkplace(); }),
      colorField('BG Color', comp.bg, v => { comp.bg=v; drawWorkplace(); }),
      field('Text', comp.txt || '', 'textarea', v => { comp.txt=v; drawWorkplace(); }),
      field('Font Size', comp.fontSize || 32, 'number', v => { comp.fontSize=Math.max(1, Number(v)||1); drawWorkplace(); }),
      field('Font Family', comp.fontFamily || 'sans-serif', 'text', v => { comp.fontFamily=v || 'sans-serif'; drawWorkplace(); }),
      checkboxField('Border', !!comp.border?.enabled, v => { comp.border.enabled=v; drawWorkplace(); }),
      colorField('Border Color', comp.border?.color || comp.fgcol || '#FFFFFFFF', v => { comp.border.color=v; drawWorkplace(); }),
      field('Border Width', comp.border?.width ?? 1, 'number', v => { comp.border.width=Math.max(0,Number(v)||0); drawWorkplace(); }),
      cornerRadiusFields(radius, values => { comp.border.radius=values; drawWorkplace(); }),
      axisVectorField('Position', comp.position || [0,0], (x,y) => { comp.position=[x,y]; drawWorkplace(); })
    ];
  }
  function renderAnimationRows(node, comp) {
    normalizeNode(node);
    if(!Array.isArray(comp.animations)) comp.animations=[];
    if(!comp.animations.length) comp.animations.push({name:'Default',fps:8,sprites:[]});
    const rows=[];
    const activeName=comp.activeAnimation||comp.animations[0].name;
    comp.activeAnimation=activeName;
    comp.animations.forEach((anim,index)=>{
      const block=document.createElement('div');block.className='animation-block';
      const title=document.createElement('div');title.className='animation-block-head';
      const nameInput=document.createElement('input');nameInput.type='text';nameInput.value=anim.name;nameInput.className='animation-name-input';
      nameInput.addEventListener('change',()=>{const next=nameInput.value.trim()||`Animation ${index+1}`;const old=anim.name;anim.name=next;if(comp.activeAnimation===old)comp.activeAnimation=next;renderComponentPanel();});
      const del=document.createElement('button');del.type='button';del.className='mini-action danger';del.textContent='×';del.title='Delete Animation';
      del.addEventListener('click',()=>{if(comp.animations.length===1)return status('At least one animation is required');askConfirm('Delete Animation',`Delete “${anim.name}”?`,()=>{comp.animations.splice(index,1);if(comp.activeAnimation===anim.name)comp.activeAnimation=comp.animations[0].name;renderComponentPanel();});});
      title.append(nameInput,del);block.append(title);
      block.append(field('FPS',anim.fps||8,'number',v=>{anim.fps=Math.max(1,Number(v)||1);}));
      (Array.isArray(anim.sprites)?anim.sprites:[]).forEach((sprite,si)=>{
        const row=assetField(`Sprite ${si+1}`,sprite.src,'Sprite',asset=>{sprite.name=asset.name;sprite.src=asset.value;renderComponentPanel();drawWorkplace();});
        const remove=document.createElement('button');remove.type='button';remove.className='mini-action danger animation-sprite-remove';remove.textContent='×';remove.title='Remove Sprite';remove.onclick=()=>{anim.sprites.splice(si,1);renderComponentPanel();};
        row.querySelector('.property-control')?.append(remove);block.append(row);
      });
      const add=document.createElement('button');add.className='small-action';add.type='button';add.textContent='＋ Add Sprite';add.addEventListener('click',()=>openAssetSelector('Sprite',asset=>{anim.sprites.push({name:asset.name,src:asset.value});renderComponentPanel();drawWorkplace();}));block.append(add);
      const activate=document.createElement('button');activate.className='small-action';activate.type='button';activate.textContent=comp.activeAnimation===anim.name?'Active':'Use Animation';activate.disabled=comp.activeAnimation===anim.name;activate.addEventListener('click',()=>{comp.activeAnimation=anim.name;renderComponentPanel();drawWorkplace();});block.append(activate);
      rows.push(block);
    });
    const addAnim=document.createElement('button');addAnim.className='small-action';addAnim.type='button';addAnim.textContent='＋ New Anim';addAnim.addEventListener('click',()=>promptModal('New Animation','Animation name','Animation '+(comp.animations.length+1),name=>{name=String(name||'').trim();if(!name)return;if(comp.animations.some(a=>a.name.toLowerCase()===name.toLowerCase()))return status('Animation name already exists');comp.animations.push({name,fps:8,sprites:[]});comp.activeAnimation=name;renderComponentPanel();}));
    rows.push(addAnim);return rows;
  }

  function removeComponent(node, comp) {
    if (comp.removable === false) return status(`${COMPONENT_LABELS[comp.type]} cannot be removed`);
    askConfirm('Delete Component', `Delete ${COMPONENT_LABELS[comp.type]} from “${node.name}”?`, () => {
      node.components = nodeComponents(node).filter(c => c !== comp); renderComponentPanel(); drawWorkplace(); status(`${COMPONENT_LABELS[comp.type]} removed`);
    });
  }

  function copyComponent(target){
    if(!target?.comp)return status('Nothing to copy');
    const comp=clone(target.comp);const payload={component:comp,type:comp.type,sourceNodeId:target.node?.id||null};
    if(comp.type==='script'&&target.node){payload.scriptNodes=clone(state.script.nodesByNode[target.node.id]||[]);payload.connections=clone(state.script.connectionsByNode[target.node.id]||[]);}
    state.componentClipboard=payload;status(`${COMPONENT_LABELS[comp.type]||comp.type} copied`);
  }
  function pasteComponent(target){
    if(!state.componentClipboard?.component||!target?.node)return status('Nothing to paste');
    pushHistory(); const source=state.componentClipboard, node=target.node;const data=clone(source.component);data.type=source.type;data.removable=['node','script','transform'].includes(data.type)?false:data.removable!==false;
    node.components=nodeComponents(node);const idx=node.components.findIndex(c=>c.type===source.type);if(idx>=0)node.components[idx]=data;else node.components.push(data);
    if(source.type==='script'){
      const copiedNodes=clone(source.scriptNodes||[]),map=new Map();
      copiedNodes.forEach(sn=>{const oldId=sn.id;sn.id=`snode-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;map.set(oldId,sn.id);});
      state.script.nodesByNode[node.id]=copiedNodes;
      state.script.connectionsByNode[node.id]=clone(source.connections||[]).map(c=>({...c,from:map.get(c.from)||c.from,to:map.get(c.to)||c.to}));
    }
    normalizeNode(node);renderComponentPanel();renderSelectionTree();drawWorkplace();status(`${COMPONENT_LABELS[source.type]||source.type} pasted`);
  }
  function componentCard(title, content, removable, removeFn, foldKey = title, copyTarget = null) {
    const card = document.createElement('section'); card.className='component-card';
    card.dataset.componentCard = 'true'; card.dataset.componentKey = foldKey; card.classList.toggle('component-selected', state.ui.selectedComponentKey===foldKey);
    const header = document.createElement('div'); header.className='component-card-header';
    const strong = document.createElement('strong'); strong.textContent=title;
    const actions=document.createElement('div'); actions.className='comp-actions';
    const fold=document.createElement('button'); fold.title='Collapse';
    const body=document.createElement('div'); body.className='component-body';
    const collapsed=!!state.ui.componentCollapsed[foldKey];
    body.classList.toggle('hidden',collapsed); fold.textContent=collapsed?'+':'−';
    fold.addEventListener('click',()=>{state.ui.componentCollapsed[foldKey]=!state.ui.componentCollapsed[foldKey];body.classList.toggle('hidden',state.ui.componentCollapsed[foldKey]);fold.textContent=state.ui.componentCollapsed[foldKey]?'+':'−';}); actions.append(fold);
    if(removable){const del=document.createElement('button');del.className='delete-component';del.title='Delete component';del.textContent='×';del.addEventListener('click',()=>removeFn?.());actions.append(del);}
    header.append(strong,actions); card.append(header,body);
    if (content instanceof DocumentFragment) body.append(content); else if (Array.isArray(content)) content.forEach(x=>body.append(x)); else if (content) body.append(content);
    const selectThis=()=>{if(!copyTarget?.node||!copyTarget?.comp)return;state.ui.selectedComponentKey=foldKey;$$('.component-card.component-selected').forEach(el=>el.classList.remove('component-selected'));card.classList.add('component-selected');drawWorkplace();};
    const showComponentMenu=e=>{e.preventDefault();e.stopPropagation();selectThis();const items=[{label:'Copy',icon:'⧉',action:()=>copyComponent(copyTarget)},{label:'Paste',icon:'▣',disabled:!state.componentClipboard,action:()=>pasteComponent(copyTarget)}];if(removable)items.push({label:'Delete',icon:'×',action:()=>removeFn?.()});showContextMenu(items,e.clientX??0,e.clientY??0);};
    card.addEventListener('contextmenu',showComponentMenu);
    card.addEventListener('pointerdown',e=>{if(e.button===2){e.stopPropagation();return;}if(e.target.closest('.component-card-header,.component-body'))selectThis();},{capture:true});
    header.addEventListener('contextmenu',showComponentMenu);
    header.addEventListener('pointerup',e=>{
      if(e.target.closest('.comp-actions'))return;
      if(e.pointerType==='mouse' && e.button!==0 && e.button!==2)return;
      showComponentMenu(e);
    });
    header.addEventListener('click',e=>{if(e.target.closest('.comp-actions'))return;e.preventDefault();});
    setupLongPress(card,e=>showComponentMenu(e));
    setupLongPress(header,e=>showComponentMenu(e));
    return card;
  }

  function empty(text) { const el=document.createElement('div'); el.className='component-empty'; el.textContent=text; return el; }
  function readOnlyField(label,value){ return field(label,value,'readonly'); }
  function labeledInput(label,value,onChange,type='text'){
    const wrap=document.createElement('div');wrap.className='labeled-control';const l=document.createElement('div');l.className='property-label';l.textContent=label;const input=document.createElement('input');input.type=type;input.value=value??'';input.addEventListener('change',()=>onChange(type==='number'?Number(input.value):input.value));wrap.append(l,input);return wrap;
  }
  function field(label,value,type='text',onChange=()=>{},options=[]){
    const row=document.createElement('div');row.className='property-row';const l=document.createElement('span');l.className='property-label';l.textContent=label;const c=document.createElement('div');c.className='property-control';
    if(type==='readonly'){c.append(Object.assign(document.createElement('div'),{className:'readonly-value',textContent:value??''}));}
    else if(type==='textarea'){const i=document.createElement('textarea');i.value=value??'';i.addEventListener('change',()=>onChange(i.value));c.append(i);}
    else if(type==='button'){const b=document.createElement('button');b.className='script-button';b.textContent=value;b.addEventListener('click',onChange);c.append(b);}
    else if(type==='custom-select') c.append(customSelect(value,options,onChange));
    else {const i=document.createElement('input');i.type=type==='number'?'number':'text';i.value=value??'';i.addEventListener('change',()=>onChange(type==='number'?Number(i.value):i.value));c.append(i);}
    row.append(l,c);return row;
  }
  function axisVectorField(label, value, onChange){
    const wrap=document.createElement('div');
    wrap.className='property-vector';
    const title=document.createElement('div'); title.className='property-label'; title.textContent=label; wrap.append(title);
    const axis=document.createElement('div'); axis.className='axis-stack';
    const inputs=[];
    [['X',0],['Y',1]].forEach(([name,index])=>{
      const row=document.createElement('div'); row.className='axis-row';
      const l=document.createElement('span'); l.className='axis-name'; l.textContent=name+':';
      const input=document.createElement('input'); input.type='number'; input.step='any'; input.value=Number(value?.[index]??0);
      inputs[index]=input;
      input.addEventListener('change',()=>{
        const next=[Number(inputs[0]?.value??0),Number(inputs[1]?.value??0)];
        if(!Number.isFinite(next[index])) next[index]=0;
        onChange(next[0],next[1]);
      });
      row.append(l,input); axis.append(row);
    });
    wrap.append(axis); return wrap;
  }

  function pairField(label,value,onChange){
    value = Array.isArray(value) ? value : [0,0];
    const wrap=document.createElement('div');wrap.className='property-stack';const title=document.createElement('div');title.className='property-label';title.textContent=label;wrap.append(title);
    const axes=document.createElement('div');axes.className='axis-grid';
    ['X','Y'].forEach((axis,index)=>{const cell=document.createElement('div');cell.className='axis-cell';cell.innerHTML=`<span>${axis}</span>`;const i=document.createElement('input');i.type='number';i.value=Number(value[index]??0);cell.append(i);axes.append(cell);i.addEventListener('change',()=>onChange(Number(axes.children[0].querySelector('input').value)||0,Number(axes.children[1].querySelector('input').value)||0));});wrap.append(axes);return wrap;
  }
  function cornerRadiusFields(radius,onChange){
    const wrap=document.createElement('div');wrap.className='property-stack';const title=document.createElement('div');title.className='property-label';title.textContent='Corner Radius';wrap.append(title);const grid=document.createElement('div');grid.className='corner-stack';['TL','TR','BR','BL'].forEach((name,index)=>{const cell=document.createElement('div');cell.className='axis-cell';cell.innerHTML=`<span>${name}</span>`;const i=document.createElement('input');i.type='number';i.value=Number(radius[index]||0);i.addEventListener('change',()=>{radius[index]=Math.max(0,Number(i.value)||0);onChange([...radius]);});cell.append(i);grid.append(cell);});wrap.append(grid);return wrap;
  }
  function checkboxField(label,value,onChange){
    const row=document.createElement('div');row.className='property-row checkbox-row';
    const l=document.createElement('span');l.className='property-label';l.textContent=label;
    const c=document.createElement('div');c.className='property-control checkbox-control';
    const input=document.createElement('input');input.type='checkbox';input.checked=!!value;input.className='ui-checkbox';
    input.addEventListener('change',()=>{
      const componentScroll=$('#componentContent');
      const selectionTree=$('#selectionTree');
      const scriptLibrary=$('#scriptNodeLibrary');
      const scrolls=[[componentScroll,componentScroll?.scrollTop],[selectionTree,selectionTree?.scrollTop],[scriptLibrary,scriptLibrary?.scrollTop]];
      onChange(input.checked);
      requestAnimationFrame(()=>scrolls.forEach(([el,top])=>{if(el && Number.isFinite(top))el.scrollTop=top;}));
    });
    c.append(input);row.append(l,c);return row;
  }
  function colorField(label,value,onChange){
    const row=document.createElement('div');row.className='property-row';const l=document.createElement('span');l.className='property-label';l.textContent=label;const c=document.createElement('div');c.className='property-control';const b=document.createElement('button');b.className='color-button';const sw=document.createElement('span');sw.className='color-swatch';sw.style.background=colorCss(value,'transparent');const t=document.createElement('span');t.className='color-value';t.textContent=value||'transparent';b.append(sw,t);b.addEventListener('click',()=>openColorModal(value,onChange,label));c.append(b);row.append(l,c);return row;
  }
  function assetField(label,src,type,onSelect){
    const row=document.createElement('div');row.className='property-row';const l=document.createElement('span');l.className='property-label';l.textContent=label;const c=document.createElement('div');c.className='property-control';const b=document.createElement('button');b.className='asset-select-button';const found=(state.assets[type]||[]).find(a=>a.value===src);b.textContent=found?.name||`Select ${type}`;b.addEventListener('click',()=>openAssetSelector(type,onSelect));c.append(b);row.append(l,c);return row;
  }

  let activeSelectMenu=null;
  let activeNativeSelect=null;
  function positionFloatingElement(el, anchor, preferred='below'){
    el.style.visibility='hidden';el.hidden=false;el.style.position='fixed';el.style.left='0px';el.style.top='0px';
    const ar=anchor.getBoundingClientRect(), mr=el.getBoundingClientRect(), pad=6;
    let left=ar.left, top=preferred==='above'?ar.top-mr.height-2:ar.bottom+2;
    if(left+mr.width>window.innerWidth-pad) left=window.innerWidth-mr.width-pad;
    if(left<pad) left=pad;
    if(top+mr.height>window.innerHeight-pad) top=ar.top-mr.height-2;
    if(top<pad) top=Math.min(window.innerHeight-mr.height-pad,ar.bottom+2);
    el.style.left=`${Math.round(left)}px`;el.style.top=`${Math.round(top)}px`;el.style.visibility='visible';
  }
  function customSelect(value,options,onChange){
    const wrap=document.createElement('div');wrap.className='select-wrap';
    const b=document.createElement('button');b.className='select-button';b.type='button';b.innerHTML=`<span>${esc(value)}</span><span>⌄</span>`;
    const menu=document.createElement('div');menu.className='select-menu floating-select-menu';menu.hidden=true;menu.style.zIndex='2147483646';menu.style.pointerEvents='auto';
    options.forEach(option=>{const item=document.createElement('button');item.type='button';item.textContent=option;item.className=String(option)===String(value)?'active':'';item.addEventListener('pointerdown',e=>e.stopPropagation());item.addEventListener('click',e=>{e.stopPropagation();onChange(option);b.firstElementChild.textContent=option;closeMenus();});menu.append(item);});
    b.addEventListener('click',e=>{e.stopPropagation();if(activeSelectMenu===menu){closeMenus();return;}closeMenus();document.body.append(menu);activeSelectMenu=menu;positionFloatingElement(menu,b);});
    wrap.append(b);return wrap;
  }
  function openNativeSelect(select){
    if(!select||select.disabled)return;
    if(activeNativeSelect?.select===select){closeMenus();return;}
    closeMenus();
    const menu=document.createElement('div');menu.className='select-menu floating-select-menu native-select-menu';menu.hidden=true;menu.style.zIndex='2147483647';menu.style.pointerEvents='auto';
    menu.style.zIndex='2147483647';
    menu.style.pointerEvents='auto';
    [...select.options].forEach(option=>{
      const item=document.createElement('button');item.type='button';item.textContent=option.textContent;
      item.disabled=!!option.disabled; if(option.selected)item.classList.add('active');
      item.addEventListener('pointerdown',e=>e.stopPropagation());
      item.addEventListener('click',e=>{
        e.stopPropagation(); if(option.disabled)return;
        select.value=option.value;
        [...select.options].forEach(o=>o.selected=o===option);
        select.dispatchEvent(new Event('change',{bubbles:true}));
        closeMenus();
      });
      menu.append(item);
    });
    document.body.append(menu);activeNativeSelect={select,menu};
    select.setAttribute('aria-expanded','true');
    requestAnimationFrame(()=>positionFloatingElement(menu,select));
  }

  function sceneVariableList(scene=currentScene()){
    const key=scene?.id||'__none__';
    return state.sceneVariablesByScene[key] ||= [];
  }
  function variableList(scope){
    if(scope==='Local') return (state.localVarsByNode[state.script.nodeId] ||= []);
    if(scope==='Scene') return sceneVariableList();
    return state.globalVariables ||= [];
  }
  function variableExists(scope,name,ignore=null){
    const wanted=String(name??'').trim().toLowerCase();if(!wanted)return false;
    return variableList(scope).some(v=>v!==ignore&&String(v?.name??'').trim().toLowerCase()===wanted);
  }
  function nextVariableName(scope,base){
    let name=String(base||'Variable').trim()||'Variable',i=2;while(variableExists(scope,name))name=`${base}${i++}`;return name;
  }
  function enforceVariableUniqueness(){
    const fixList=list=>{
      if(!Array.isArray(list))return [];
      const seen=new Set();
      for(const v of list){
        let base=String(v?.name??'').trim()||'Variable',name=base,i=2,key=name.toLowerCase();
        while(seen.has(key)){name=`${base}${i++}`;key=name.toLowerCase();}
        v.name=name;seen.add(key);
      }
      return list;
    };
    fixList(state.globalVariables);
    Object.values(state.sceneVariablesByScene||{}).forEach(fixList);
    Object.values(state.localVarsByNode||{}).forEach(fixList);
  }
  function makeVariable(name,dataType,value,access='Scene',debug=false){return {id:`var-${Date.now()}-${state.nextVariableId++}`,name,dataType,value,access,debug:!!debug};}
  function addVariable(scopeOrGlobal){
    const scope=typeof scopeOrGlobal==='boolean'?(scopeOrGlobal?'Global':'Local'):scopeOrGlobal;
    const name=nextVariableName(scope,scope==='Local'?'localVariable':'NewVariable');
    variableList(scope).push(makeVariable(name,'String','',scope, true));
    scope==='Local'?renderLocalVariables():renderComponentPanel();
  }
  function renderVariableSection(host, title, scope, collapsedKey){
    const vars=variableList(scope);
    const section=document.createElement('section');section.className='variable-section';
    const head=document.createElement('button');head.className='library-group-header';head.type='button';
    const body=document.createElement('div');body.className='variable-section-body';
    const collapsed=!!state.ui[collapsedKey];body.classList.toggle('hidden',collapsed);
    head.innerHTML=`<span>${collapsed?'+':'−'}</span>${esc(title)}`;
    head.addEventListener('click',e=>{e.stopPropagation();state.ui[collapsedKey]=!state.ui[collapsedKey];const c=!!state.ui[collapsedKey];body.classList.toggle('hidden',c);head.firstElementChild.textContent=c?'+':'−';});
    if(!vars.length)body.append(empty(`No ${title.toLowerCase()} yet.`));
    vars.forEach(variable=>body.append(variableEditor(variable,scope)));
    const footer=document.createElement('div');footer.className='variable-footer';const add=document.createElement('button');add.className='add-component-button';add.innerHTML='<span>＋</span>Add Variable';add.addEventListener('click',e=>{e.stopPropagation();addVariable(scope);});footer.append(add);body.append(footer);
    section.append(head,body);host.append(section);
  }
  function renderVariables(host, globalSelection) {
    host.innerHTML='';
    renderVariableSection(host,'Global Variables','Global','globalVariablesCollapsed');
    renderVariableSection(host,'Scene Variables','Scene','sceneVariablesCollapsed');
  }
  function flashValidationError(el){
    if(!el)return;
    el.classList.remove('uix-validation-error-flash');
    void el.offsetWidth;
    el.classList.add('uix-validation-error-flash');
    clearTimeout(el.__uixValidationTimer);
    el.__uixValidationTimer=setTimeout(()=>el.classList.remove('uix-validation-error-flash'),700);
  }
  function variableEditor(v,scope){
    const global=scope==='Global';
    const card=document.createElement('div');card.className='variable-block';
    const head=document.createElement('div');head.className='variable-head';
    const title=document.createElement('strong');title.textContent=v.name||'Variable';
    const actions=document.createElement('div');actions.className='variable-head-actions';
    const toggle=document.createElement('button');toggle.className='mini-action variable-toggle';toggle.type='button';
    const del=document.createElement('button');del.className='mini-action danger';del.type='button';del.textContent='×';del.title='Delete Variable';
    const key=v.id||`${scope}:${v.name||'Variable'}`;const collapsed=!!state.ui.variableCollapsed[key];
    const body=document.createElement('div');body.className='variable-body';body.classList.toggle('hidden',collapsed);toggle.textContent=collapsed?'+':'−';toggle.title=collapsed?'Expand':'Collapse';
    toggle.addEventListener('click',e=>{e.stopPropagation();state.ui.variableCollapsed[key]=!state.ui.variableCollapsed[key];const c=!!state.ui.variableCollapsed[key];body.classList.toggle('hidden',c);toggle.textContent=c?'+':'−';toggle.title=c?'Expand':'Collapse';});
    del.addEventListener('click',e=>{e.stopPropagation();askConfirm('Delete Variable',`Delete “${v.name||'Variable'}”?`,()=>{const list=variableList(scope),i=list.indexOf(v);if(i>=0)list.splice(i,1);delete state.ui.variableCollapsed[key];scope==='Local'?renderLocalVariables():renderComponentPanel();if(state.script.nodeId)renderScriptCanvas();});});
    actions.append(toggle,del);head.append(title,actions);card.append(head);
    const nameRow=field('Name',v.name,'text',x=>{
      const input=nameRow.querySelector('input');
      const previous=String(v.name??'');
      const next=String(x??'').trim();
      if(!next){flashValidationError(input);if(input)input.value=previous;return status('Variable name cannot be empty');}
      if(variableExists(scope,next,v)){flashValidationError(input);if(input)input.value=previous;return status('A variable with that name already exists in this scope');}
      v.name=next;title.textContent=next;
      input?.classList.remove('uix-validation-error-flash');
      renderScriptLibrary();if(state.script.nodeId)renderScriptCanvas();
    });
    body.append(nameRow);
    body.append(field('Data Type',v.dataType,'custom-select',x=>{
      const next=String(x); if(!['String','Bool','Int'].includes(next))return;
      const oldType=String(v.dataType||'String'), oldValue=v.value;
      if(next!==oldType){
        if(next==='String') v.value=String(oldValue??'');
        else if(next==='Int'){
          const n=typeof oldValue==='boolean'?(oldValue?1:0):Number(oldValue);
          v.value=Number.isFinite(n)?n:0;
        }else if(next==='Bool'){
          if(typeof oldValue==='boolean') v.value=oldValue;
          else if(typeof oldValue==='number') v.value=oldValue!==0;
          else v.value=['true','1','yes','on'].includes(String(oldValue??'').trim().toLowerCase());
        }
      }
      v.dataType=next;
      if(scope==='Local') renderLocalVariables(); else renderComponentPanel();
      if(state.script.nodeId) renderScriptCanvas();
    },['String','Bool','Int']));
    const valueRow=document.createElement('div');valueRow.className='property-row';const label=document.createElement('span');label.className='property-label';label.textContent='Value';const c=document.createElement('div');c.className='property-control';
    if(v.dataType==='Bool') c.append(customSelect(v.value?'true':'false',['true','false'],x=>{v.value=x==='true';}));
    else {const input=document.createElement('input');input.type=v.dataType==='Int'?'number':'text';input.value=v.value??'';input.addEventListener('change',()=>v.value=v.dataType==='Int'?(Number(input.value)||0):input.value);c.append(input);}
    valueRow.append(label,c);body.append(valueRow);
    body.append(checkboxField('Debug',!!v.debug,x=>{v.debug=x;}));
    card.append(body);
    card.addEventListener('contextmenu',e=>{if(e.target.closest('input,textarea,button,.select-button'))return;e.preventDefault();showContextMenu([{label:'Delete',action:()=>del.click()}],e.clientX,e.clientY);});
    return card;
  }

  function openAddComponent(){
    const node=selectedNode();if(!node)return status('Select a Node first');const grid=$('#componentGrid');grid.innerHTML='';
    Object.keys(NodeSettings).filter(type=>!['node','script','transform'].includes(type)).forEach(type=>{const exists=!!component(node,type);const b=document.createElement('button');b.className='component-option';b.disabled=exists;b.innerHTML=`<span class="option-icon">${({text:'T',sprite:'▧',animationsprite:'◫',physics:'◌',collider:'□'})[type]||'◇'}</span><span><strong>${COMPONENT_LABELS[type]}</strong><small>${exists?'Already added':'Add component'}</small></span>`;if(exists)b.classList.add('disabled-option');b.addEventListener('click',()=>addComponent(type));grid.append(b);});showModal($('#componentModal'));
  }
  function addComponent(type){const node=selectedNode();if(!node)return;pushHistory();node.components.push(createComponent(type));closeModal();renderComponentPanel();drawWorkplace();status(`${COMPONENT_LABELS[type]} added`);}

  function syncPanelWidths(){
    const pw=state.panelWidths||{};
    let selection=Number(pw.selection),component=Number(pw.component);
    const dock=Number(pw.dock)||570,split=clamp(Number(pw.split)||50,20,80);
    if(!Number.isFinite(selection)||selection<=0)selection=dock*(split/100);
    if(!Number.isFinite(component)||component<=0)component=dock-selection;
    selection=clamp(selection,150,720);component=clamp(component,150,720);
    pw.selection=selection;pw.component=component;pw.dock=selection+component;pw.split=selection/(selection+component)*100;state.panelWidths=pw;
    return pw;
  }
  function applyPanelState(){
    const a=state.panels.selectionPanel,b=state.panels.componentPanel;const dock=$('#inspectorDock'),rail=$('#panelRestoreRail');if(!dock)return;
    const pw=syncPanelWidths();
    $('#selectionPanel').hidden=!a;$('#componentPanel').hidden=!b;
    const cols=a&&b?`${pw.selection}px ${pw.component}px`:a?`${pw.selection}px`:b?`${pw.component}px`:'0px 0px';
    dock.hidden=false;dock.classList.toggle('dock-empty',!a&&!b);dock.style.width=`${a&&b?pw.selection+pw.component:a?pw.selection:b?pw.component:0}px`;dock.style.gridTemplateColumns=cols;
    $('#selectionPanelIcon').textContent=a?'☑':'☐';$('#componentPanelIcon').textContent=b?'☑':'☐';
    if(rail){const sr=rail.querySelector('[data-restore-panel="selection"]'),cr=rail.querySelector('[data-restore-panel="component"]');if(sr)sr.hidden=a;if(cr)cr.hidden=b;rail.style.display=(a&&b)?'none':'flex';}
    updateTopbarModeRailPosition();
  }
  function positionPanelRestoreRail(){}
  function togglePanel(id){state.panels[id]=!state.panels[id];applyPanelState();}

  function enablePanelResize(){
    const dock=$('#inspectorDock');
    let active=null;
    syncPanelWidths();
    const begin=(handle,type,e)=>{
      if(e.pointerType==='mouse' && e.button!==0)return;
      e.preventDefault();e.stopPropagation();
      handle.setPointerCapture?.(e.pointerId);
      const pw=syncPanelWidths();
      active={type,startX:e.clientX,startDock:pw.dock,startSplit:pw.split,startSelection:pw.selection,startComponent:pw.component,pointerId:e.pointerId};
      document.documentElement.classList.add('resizing-panels');
    };
    const move=e=>{
      if(!active || e.pointerId!==active.pointerId)return;
      e.preventDefault();
      const pw=state.panelWidths;
      if(active.type==='selection'){
        const delta=active.startX-e.clientX;
        pw.selection=clamp(active.startSelection+delta,150,720);
        pw.dock=pw.selection+(state.panels.componentPanel?active.startComponent:0);
      }else if(active.type==='component'){
        const delta=e.clientX-active.startX;
        pw.component=clamp(active.startComponent+delta,150,720);
        pw.dock=(state.panels.selectionPanel?active.startSelection:0)+pw.component;
      }else if(active.type==='dock'){
        const max=Math.max(360,Math.floor(innerWidth*.82));
        const width=clamp(active.startDock-(e.clientX-active.startX),330,max);
        const total=(state.panels.selectionPanel?active.startSelection:0)+(state.panels.componentPanel?active.startComponent:0)||1;
        const ratio=(state.panels.selectionPanel?active.startSelection:0)/total;
        if(state.panels.selectionPanel&&state.panels.componentPanel){pw.selection=clamp(width*ratio,150,width-150);pw.component=Math.max(150,width-pw.selection);}
        else if(state.panels.selectionPanel)pw.selection=Math.max(150,width);
        else if(state.panels.componentPanel)pw.component=Math.max(150,width);
        pw.dock=width;
      }else{
        const r=dock.getBoundingClientRect();
        const split=clamp((e.clientX-r.left)/Math.max(1,r.width)*100,20,80);
        const total=state.panels.selectionPanel&&state.panels.componentPanel?pw.dock:(state.panels.selectionPanel?pw.selection:pw.component);
        pw.selection=total*(split/100);pw.component=total-pw.selection;pw.split=split;
      }
      syncPanelWidths();applyPanelState();
      updateTopbarModeRailPosition();
    };
    const end=e=>{if(!active)return;if(e?.pointerId!=null&&e.pointerId!==active.pointerId)return;active=null;document.documentElement.classList.remove('resizing-panels');};
    const bind=(selector,type)=>{const handle=document.querySelector(selector);if(!handle)return;handle.addEventListener('pointerdown',e=>begin(handle,type,e),{passive:false});};
    bind('[data-resize-dock="right"]','selection');
    bind('[data-resize-dock="component"]','component');
    bind('[data-resize-split="selection"]','split');
    document.addEventListener('pointermove',move,{passive:false});
    document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  }
  function modeLabel(m){return ({select:'Select',move:'Move',rotate:'Rotate',scale:'Scale',all:'All'})[m]||'Select';}
  function setMode(m){state.mode=m;$$('.mode-button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));$('#activeModeLabel').textContent=modeLabel(m);drawWorkplace();status(`${modeLabel(m)} mode`);}
  function updateZoomLabel(){if($('#zoomLabel'))$('#zoomLabel').textContent=`${Math.round(state.zoom*100)}%`;if($('#panLabel'))$('#panLabel').textContent=`Pan ${Math.round(state.pan.x)}, ${Math.round(state.pan.y)}`;}

  // ---------------- Workplace Canvas ----------------
  const workspace = { panDrag: null, gizmoDrag: null, longPress: null, joystickDrag: null };

  function resizeWorkplaceCanvas(){
    const canvas=$('#workplaceCanvas'), rect=canvas.getBoundingClientRect(); if(rect.width<=0||rect.height<=0)return;
    dpr=window.devicePixelRatio||1; canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);
  }
  function worldToScreen(x,y){const rect=$('#workplaceCanvas').getBoundingClientRect();return {x:rect.width/2+state.pan.x+x*state.zoom,y:rect.height/2+state.pan.y+y*state.zoom};}
  function screenToWorld(x,y){const rect=$('#workplaceCanvas').getBoundingClientRect();return {x:(x-rect.left-rect.width/2-state.pan.x)/state.zoom,y:(y-rect.top-rect.height/2-state.pan.y)/state.zoom};}
  function getTextMetrics(node,comp,ctx){const fontSize=Number(comp.fontSize)||32;ctx.save();ctx.font=`${fontSize}px ${comp.fontFamily||'sans-serif'}`;const lines=String(comp.txt||'').split('\n');const width=Math.max(24,...lines.map(line=>ctx.measureText(line||' ').width))+16;const height=Math.max(fontSize*1.25,lines.length*fontSize*1.25)+16;ctx.restore();return {w:width,h:height};}
  function getAnimationForNode(node){
    const anim=component(node,'animationsprite');
    if(!anim)return null;
    if(!Array.isArray(anim.animations)||!anim.animations.length)return null;
    const sprite=component(node,'sprite');
    const wanted=sprite?.sourceType==='Animation' ? sprite.animation : anim.activeAnimation;
    return anim.animations.find(a=>a.name===wanted) || anim.animations[0] || null;
  }
  function getAnimationFrame(anim,now=performance.now()){
    const frames=Array.isArray(anim?.sprites)?anim.sprites.filter(f=>f?.src):[];
    if(!frames.length)return null;
    const fps=Math.max(1,Number(anim.fps)||8);
    const index=frames.length===1?0:Math.floor((now/1000)*fps)%frames.length;
    return {frame:frames[index],index,frames};
  }
  function nodeVisualSource(node,now=performance.now()){
    const sprite=component(node,'sprite');
    const anim=getAnimationForNode(node);
    if(sprite?.sourceType==='Animation' && anim){
      const current=getAnimationFrame(anim,now);
      return {src:current?.frame?.src||'',pixelated:sprite.pixelated!==false,animated:!!current?.frames?.length};
    }
    if(sprite?.src) return {src:sprite.src,pixelated:sprite.pixelated!==false,animated:false};
    if(anim){
      const current=getAnimationFrame(anim,now);
      return {src:current?.frame?.src||'',pixelated:true,animated:!!current?.frames?.length};
    }
    return {src:'',pixelated:true,animated:false};
  }
  function spriteLocalGeometry(node,now=performance.now()){
    const sprite=component(node,'sprite'),visual=nodeVisualSource(node,now);
    if(!sprite||!visual.src)return null;
    const img=getAssetImage(visual.src);if(!img?.complete||!img.naturalWidth)return null;
    const base=constrainImageSize(img),p=Array.isArray(sprite.position)?sprite.position:[0,0],size=Array.isArray(sprite.size)?sprite.size:[0,0];
    return {x:Number(p[0])||0,y:Number(p[1])||0,w:Number(size[0])>0?Number(size[0]):base.w,h:Number(size[1])>0?Number(size[1]):base.h};
  }
  function hasAnimatedVisuals(){
    return allNodes().some(({node})=>node.type==='node' && !!getAnimationForNode(node)?.sprites?.filter(f=>f?.src).length);
  }
  function ensureEditorAnimationLoop(){
    if(state.runtime.running || !hasAnimatedVisuals() || editorAnimationRAF)return;
    editorAnimationRAF=requestAnimationFrame(()=>{
      editorAnimationRAF=0;
      drawWorkplace();
    });
  }
  function getNodeVisualSize(node,ctx){
    const text=component(node,'text');if(text)return getTextMetrics(node,text,ctx);
    const source=nodeVisualSource(node),sprite=component(node,'sprite');if(source.src&&getAssetImage(source.src)){const img=getAssetImage(source.src),base=constrainImageSize(img);return sprite?{w:Number(sprite.size?.[0])>0?Number(sprite.size[0]):base.w,h:Number(sprite.size?.[1])>0?Number(sprite.size[1]):base.h}:base;}
    const progress=component(node,'progressbar');if(progress)return {w:Math.max(1,Number(progress.width)||1),h:Math.max(1,Number(progress.height)||1)};
    return {w:90,h:54};
  }
  function constrainImageSize(img){const maxW=220,maxH=160,scale=Math.min(1,maxW/img.naturalWidth,maxH/img.naturalHeight);return {w:Math.max(1,img.naturalWidth*scale),h:Math.max(1,img.naturalHeight*scale)};}
  function drawWorkplace(){
    const canvas=$('#workplaceCanvas');if(!canvas||canvas.width===0)return;const ctx=canvas.getContext('2d');const rect=canvas.getBoundingClientRect();ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,rect.width,rect.height);
    // Editor Workplace stays neutral; camera BG Color is runtime-only.
    ctx.fillStyle='#202020';ctx.fillRect(0,0,rect.width,rect.height);drawGrid(ctx,rect);
    ctx.save();ctx.translate(rect.width/2+state.pan.x,rect.height/2+state.pan.y);ctx.scale(state.zoom,state.zoom);drawAxes(ctx);drawCameraViewport(ctx,rect);
    const nodes=allNodes();nodes.forEach(({node})=>{if(node.type!=='node')return;const t=component(node,'transform');const x=Number(t?.position?.[0]||0),y=Number(t?.position?.[1]||0),sx=Number(t?.scale?.[0]||1),sy=Number(t?.scale?.[1]||1),angle=Number(t?.angle?.[0]||0);drawNodeVisual(ctx,node,x,y,sx,sy,angle);});
    const selected=selectedNode();if(selected)drawGizmo(ctx,selected);drawSelectedCollider(ctx,selected);drawEditorUIComponents(ctx);ctx.restore();
    updateZoomLabel();
    ensureEditorAnimationLoop();
  }

  function cameraEditorFrame(){
    const pos=getEditorCameraWorldPosition();
    const scale=Math.max(.01,Number(state.camera.scale)||1);
    const canvas=$('#workplaceCanvas');
    const rect=canvas?.getBoundingClientRect?.();
    const aspect=rect&&rect.width>0&&rect.height>0?rect.width/rect.height:1280/720;
    const type=normalizeScreenType(state.game.screenType);
    const h=720/scale;
    const w=type==='Smart Camera' ? h*aspect : 1280/scale;
    return {x:pos.x,y:pos.y,w,h,angle:Number(state.camera.transform?.angle?.[0]||0)*Math.PI/180,type,aspect};
  }
  function rotatePoint(x,y,a){const c=Math.cos(a),s=Math.sin(a);return {x:x*c-y*s,y:x*s+y*c};}
  function inverseRotatePoint(x,y,a){return rotatePoint(x,y,-a);}
  function editorJoystickLayout(j){
    const cam=cameraEditorFrame(),w=Math.max(1,Number(j.size?.[0]||110)),h=Math.max(1,Number(j.size?.[1]||110)),p=j.position||{};
    const hasL=p.left!==null&&p.left!==undefined&&p.left!=='';const hasR=p.right!==null&&p.right!==undefined&&p.right!=='';const hasT=p.top!==null&&p.top!==undefined&&p.top!=='';const hasB=p.bottom!==null&&p.bottom!==undefined&&p.bottom!=='';
    const lx=hasL?Number(p.left)+w/2:hasR?cam.w-Number(p.right)-w/2:cam.w/2;
    const ly=hasT?Number(p.top)+h/2:hasB?cam.h-Number(p.bottom)-h/2:cam.h/2;
    const localX=-cam.w/2+lx,localY=-cam.h/2+ly,worldOffset=rotatePoint(localX,localY,cam.angle);
    return {x:cam.x+worldOffset.x,y:cam.y+worldOffset.y,w,h,angle:cam.angle};
  }
  function joystickAtEditorPoint(world,rect){
    for(const j of sceneJoysticks().slice().reverse()){const r=editorJoystickLayout(j);const local=inverseRotatePoint(world.x-r.x,world.y-r.y,r.angle);if(Math.abs(local.x)<=r.w/2&&Math.abs(local.y)<=r.h/2)return{j,r,local};}
    return null;
  }
  function drawEditorUIComponents(ctx){
    sceneJoysticks().forEach(j=>{
      const r=editorJoystickLayout(j);ctx.save();ctx.translate(r.x,r.y);ctx.rotate(r.angle);
      ctx.fillStyle=colorCss(j.bgColor,'rgba(50,50,50,.8)');ctx.beginPath();ctx.ellipse(0,0,r.w/2,r.h/2,0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=colorCss(j.knobColor,'#fff');ctx.beginPath();ctx.ellipse(0,0,r.w*.18,r.h*.18,0,0,Math.PI*2);ctx.fill();
      if(state.selectedId===j.id){ctx.strokeStyle='#d8c35a';ctx.lineWidth=2/state.zoom;ctx.setLineDash([5/state.zoom,4/state.zoom]);ctx.strokeRect(-r.w/2-4/state.zoom,-r.h/2-4/state.zoom,r.w+8/state.zoom,r.h+8/state.zoom);ctx.setLineDash([]);}
      ctx.restore();
    });
  }
  function drawGrid(ctx,rect){
    const worldStep=32,step=Math.max(8,worldStep*state.zoom),ox=rect.width/2+state.pan.x,oy=rect.height/2+state.pan.y;
    ctx.strokeStyle='#2b2b2b';ctx.lineWidth=1;ctx.beginPath();
    for(let x=((ox%step)+step)%step;x<rect.width;x+=step){ctx.moveTo(x+.5,0);ctx.lineTo(x+.5,rect.height);}
    for(let y=((oy%step)+step)%step;y<rect.height;y+=step){ctx.moveTo(0,y+.5);ctx.lineTo(rect.width,y+.5);}
    ctx.stroke();
  }
  function drawAxes(ctx){ctx.save();ctx.globalAlpha=.35;ctx.strokeStyle='#555';ctx.lineWidth=1/state.zoom;ctx.beginPath();ctx.moveTo(-10000,0);ctx.lineTo(10000,0);ctx.moveTo(0,-10000);ctx.lineTo(0,10000);ctx.stroke();ctx.restore();}
  function getEditorCameraWorldPosition(){
    const x=Number(state.camera.transform?.position?.[0]||0)+Number(state.camera.horizontal||0);
    const y=Number(state.camera.transform?.position?.[1]||0)+Number(state.camera.vertical||0);
    return {x,y};
  }
  function drawCameraViewport(ctx,rect){
    const cam=cameraEditorFrame();
    ctx.save();ctx.translate(cam.x,cam.y);ctx.rotate(cam.angle);
    ctx.strokeStyle=cam.type==='Smart Camera'?'#d8c35a':'#555';
    ctx.lineWidth=1/state.zoom;ctx.setLineDash([8/state.zoom,5/state.zoom]);
    ctx.strokeRect(-cam.w/2,-cam.h/2,cam.w,cam.h);ctx.setLineDash([]);
    ctx.fillStyle=cam.type==='Smart Camera'?'#d8c35a':'#555';ctx.globalAlpha=.7;ctx.fillRect(-3/state.zoom,-3/state.zoom,6/state.zoom,6/state.zoom);
    ctx.restore();
  }
  function roundRectPath(ctx,x,y,w,h,r){r=Array.isArray(r)?r:[r,r,r,r];const [tl,tr,br,bl]=r.map(v=>Math.max(0,Number(v)||0));const max=Math.min(Math.abs(w)/2,Math.abs(h)/2);const a=Math.min(tl,max),b=Math.min(tr,max),c=Math.min(br,max),d=Math.min(bl,max);ctx.beginPath();ctx.moveTo(x+a,y);ctx.lineTo(x+w-b,y);ctx.quadraticCurveTo(x+w,y,x+w,y+b);ctx.lineTo(x+w,y+h-c);ctx.quadraticCurveTo(x+w,y+h,x+w-c,y+h);ctx.lineTo(x+d,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-d);ctx.lineTo(x,y+a);ctx.quadraticCurveTo(x,y,x+a,y);ctx.closePath();}
  function drawNodeVisual(ctx,node,x,y,sx,sy,angle){
    ctx.save();ctx.translate(x,y);ctx.rotate(angle*Math.PI/180);ctx.scale(sx,sy);
    const text=component(node,'text'),sprite=component(node,'sprite'),anim=component(node,'animationsprite'),progress=component(node,'progressbar');
    if(text){
      const p=text.position||[0,0];ctx.save();ctx.translate(Number(p[0]||0),Number(p[1]||0));
      const m=getTextMetrics(node,text,ctx);ctx.font=`${Number(text.fontSize)||32}px ${text.fontFamily||'sans-serif'}`;ctx.textAlign='center';ctx.textBaseline='middle';const left=-m.w/2,top=-m.h/2;
      if(text.bg&&text.bg!=='#00000000'){roundRectPath(ctx,left,top,m.w,m.h,text.border?.radius||[0,0,0,0]);ctx.fillStyle=colorCss(text.bg,'rgba(0,0,0,0)');ctx.fill();}
      if(text.border?.enabled){roundRectPath(ctx,left,top,m.w,m.h,text.border.radius);ctx.strokeStyle=colorCss(text.border.color,'#fff');ctx.lineWidth=Number(text.border.width)||1;ctx.stroke();}
      ctx.fillStyle=colorCss(text.fgcol,'#fff');const lines=String(text.txt||'').split('\n'),lh=(Number(text.fontSize)||32)*1.25,startY=-(lines.length-1)*lh/2;lines.forEach((line,i)=>ctx.fillText(line,0,startY+i*lh));ctx.restore();
    }
    const visual=nodeVisualSource(node);
    if(visual.src){
      const img=getAssetImage(visual.src);
      if(img?.complete&&img.naturalWidth){
        const m=spriteLocalGeometry(node);
        const prevSmooth=ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled=!visual.pixelated;
        ctx.imageSmoothingQuality='nearest';
        if(m)ctx.drawImage(img,m.x-m.w/2,m.y-m.h/2,m.w,m.h);
        else {const auto=constrainImageSize(img);ctx.drawImage(img,-auto.w/2,-auto.h/2,auto.w,auto.h);}
        ctx.imageSmoothingEnabled=prevSmooth;
      }
    }
    if(progress){
      const p=progress.position||[0,0],w=Math.max(1,Number(progress.width)||1),h=Math.max(1,Number(progress.height)||1),min=Number(progress.min)||0,max=Number(progress.max)||100,val=clamp(Number(progress.value)||0,min,max),ratio=max===min?1:(val-min)/(max-min);
      ctx.save();ctx.translate(Number(p[0]||0),Number(p[1]||0));roundRectPath(ctx,-w/2,-h/2,w,h,progress.cornerRadius||[0,0,0,0]);ctx.fillStyle=colorCss(progress.bgCol,'#303030');ctx.fill();
      const fillW=w*ratio;if(fillW>0){ctx.save();roundRectPath(ctx,-w/2,-h/2,w,h,progress.cornerRadius||[0,0,0,0]);ctx.clip();ctx.fillStyle=colorCss(progress.fillCol,'#fff');if(progress.direction==='right')ctx.fillRect(-w/2+w-fillW,-h/2,fillW,h);else ctx.fillRect(-w/2,-h/2,fillW,h);ctx.restore();}
      if(Number(progress.outline?.size||0)>0){roundRectPath(ctx,-w/2,-h/2,w,h,progress.cornerRadius||[0,0,0,0]);ctx.strokeStyle=colorCss(progress.outline.color,'#000');ctx.lineWidth=Number(progress.outline.size)||1;ctx.stroke();}ctx.restore();
    }
    ctx.restore();
  }
  const colliderAlphaCache=new Map();
  function spriteFrameSources(node){const out=[];const sprite=component(node,'sprite'),anim=component(node,'animationsprite');if(sprite){if((sprite.sourceType||'Sprite')==='Animation'&&anim){const a=anim.animations?.find(x=>x.name===sprite.animation)||anim.animations?.[0];(a?.sprites||[]).forEach(f=>{if(f?.src)out.push(f.src);});}else if(sprite.src)out.push(sprite.src);}if(anim&&!out.length){const a=anim.animations?.find(x=>x.name===anim.activeAnimation)||anim.animations?.[0];(a?.sprites||[]).forEach(f=>{if(f?.src)out.push(f.src);});}return [...new Set(out)];}
  function alphaBoundsForSource(src){if(!src)return null;if(colliderAlphaCache.has(src))return colliderAlphaCache.get(src);const img=getAssetImage(src);if(!img?.complete||!img.naturalWidth)return null;try{const oc=document.createElement('canvas'),ox=oc.getContext('2d',{willReadFrequently:true});oc.width=img.naturalWidth;oc.height=img.naturalHeight;ox.drawImage(img,0,0);const d=ox.getImageData(0,0,oc.width,oc.height).data;let minX=oc.width,minY=oc.height,maxX=-1,maxY=-1;for(let y=0;y<oc.height;y++)for(let x=0;x<oc.width;x++)if(d[(y*oc.width+x)*4+3]!==0){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}const b=maxX<0?null:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,nw:oc.width,nh:oc.height};colliderAlphaCache.set(src,b);return b;}catch{return null;}}
  function spriteWrapperSize(node){const frames=spriteFrameSources(node);let union=null,maxW=1,maxH=1;const bounds=[];for(const src of frames){const b=alphaBoundsForSource(src);if(!b)continue;maxW=Math.max(maxW,b.nw);maxH=Math.max(maxH,b.nh);bounds.push(b);}for(const b of bounds){const sx=maxW/b.nw,sy=maxH/b.nh;const part={x:b.x*sx-maxW/2,y:b.y*sy-maxH/2,w:b.w*sx,h:b.h*sy};if(!union)union=part;else{const l=Math.min(union.x,part.x),t=Math.min(union.y,part.y),r=Math.max(union.x+union.w,part.x+part.w),bb=Math.max(union.y+union.h,part.y+part.h);union={x:l,y:t,w:r-l,h:bb-t};}}if(!union)return getNodeVisualSize(node,$('#workplaceCanvas')?.getContext?.('2d'));const visual=getNodeVisualSize(node,$('#workplaceCanvas')?.getContext?.('2d'));const visualMax=Math.max(1,Math.max(visual.w,visual.h));const visualScale=Math.max(1,Math.min(visual.w/maxW,visual.h/maxH));return {w:Math.max(1,union.w*visualScale),h:Math.max(1,union.h*visualScale)};}
  function colliderGeometry(node,c){
    const nt=component(node,'transform')||{position:[0,0],scale:[1,1],angle:[0]};
    const ct=c.transform||{position:[0,0],scale:[1,1],angle:[0]};
    const type=['Rect','Circle','Triangle'].includes(c.shapeType)?c.shapeType:'Rect';
    const nx=Number(nt.position?.[0]||0),ny=Number(nt.position?.[1]||0);
    const nsx=Number(nt.scale?.[0]??1),nsy=Number(nt.scale?.[1]??1),na=Number(nt.angle?.[0]||0)*Math.PI/180;
    const localX=Number(ct.position?.[0]||0)*nsx,localY=Number(ct.position?.[1]||0)*nsy;
    const cos=Math.cos(na),sin=Math.sin(na);
    const x=nx+localX*cos-localY*sin,y=ny+localX*sin+localY*cos;
    const w=90*Math.abs(Number(ct.scale?.[0]??1)*nsx),h=54*Math.abs(Number(ct.scale?.[1]??1)*nsy);
    const size=type==='Circle'?Math.max(w,h):w;
    return {x,y,w:type==='Circle'?size:w,h:type==='Circle'?size:h,angle:na+Number(ct.angle?.[0]||0)*Math.PI/180,type};
  }
  function drawSelectedCollider(ctx,node){
    const c=component(node,'collider');if(!c||c.collidable===false)return;
    const g=colliderGeometry(node,c);ctx.save();ctx.translate(g.x,g.y);ctx.rotate(g.angle);
    ctx.strokeStyle='#4b8dff';ctx.fillStyle='rgba(75,141,255,.08)';ctx.lineWidth=2/state.zoom;ctx.setLineDash([6/state.zoom,4/state.zoom]);ctx.beginPath();
    if(g.type==='Circle')ctx.ellipse(0,0,g.w/2,g.h/2,0,0,Math.PI*2);
    else if(g.type==='Triangle'){ctx.moveTo(0,-g.h/2);ctx.lineTo(g.w/2,g.h/2);ctx.lineTo(-g.w/2,g.h/2);ctx.closePath();}
    else ctx.rect(-g.w/2,-g.h/2,g.w,g.h);
    ctx.fill();ctx.stroke();ctx.setLineDash([]);ctx.restore();
  }

  function gizmoTarget(node){const t=component(node,'transform')||{position:[0,0],scale:[1,1],angle:[0]},size=getNodeVisualSize(node,$('#workplaceCanvas').getContext('2d'));return {kind:'node',node,component:t,transform:t,center:[Number(t.position?.[0]||0),Number(t.position?.[1]||0)],w:Math.max(70,size.w*Math.abs(t.scale?.[0]||1)),h:Math.max(45,size.h*Math.abs(t.scale?.[1]||1)),angle:Number(t.angle?.[0]||0)*Math.PI/180,baseW:size.w,baseH:size.h};}
  function drawGizmo(ctx,node){const g=gizmoTarget(node);ctx.save();ctx.translate(g.center[0],g.center[1]);ctx.rotate(g.angle);ctx.strokeStyle='#e4ca4e';ctx.lineWidth=1.5/state.zoom;ctx.strokeRect(-g.w/2,-g.h/2,g.w,g.h);if(state.mode==='move'||state.mode==='all'||state.mode==='select'){const mx=Math.max(42/state.zoom,g.w*.55),my=Math.max(42/state.zoom,g.h*.55);drawArrow(ctx,0,0,mx,0,'#d85c5c');drawArrow(ctx,0,0,0,-my,'#67bd67');drawCenter(ctx,'#e4ca4e');}if(state.mode==='scale'||state.mode==='all'){const handles=[[-g.w/2,-g.h/2,'tl'],[0,-g.h/2,'top'],[g.w/2,-g.h/2,'tr'],[-g.w/2,0,'left'],[g.w/2,0,'right'],[-g.w/2,g.h/2,'bl'],[0,g.h/2,'bottom'],[g.w/2,g.h/2,'br']];handles.forEach(([x,y,id])=>{drawScaleHandle(ctx,x,y);if(workspace.gizmoDrag?.type==='scale'&&workspace.gizmoDrag.corner===id){const s=(12/state.zoom);ctx.strokeStyle='#fff';ctx.lineWidth=1/state.zoom;ctx.strokeRect(x-s/2-2/state.zoom,y-s/2-2/state.zoom,s+4/state.zoom,s+4/state.zoom);}});}if(state.mode==='rotate'||state.mode==='all'){const r=Math.max(g.w,g.h)/2+30/state.zoom;ctx.beginPath();ctx.arc(0,0,r,-Math.PI*.88,-Math.PI*.12);ctx.stroke();ctx.fillStyle='#e4ca4e';ctx.beginPath();ctx.arc(0,-r,5/state.zoom,0,Math.PI*2);ctx.fill();}ctx.restore();}

  function drawArrow(ctx,x1,y1,x2,y2,color){ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2/state.zoom;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();const ang=Math.atan2(y2-y1,x2-x1);const s=7/state.zoom;ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x2-Math.cos(ang-.55)*s,y2-Math.sin(ang-.55)*s);ctx.lineTo(x2-Math.cos(ang+.55)*s,y2-Math.sin(ang+.55)*s);ctx.closePath();ctx.fill();ctx.restore();}
  function drawScaleHandle(ctx,x,y){const s=11/state.zoom;ctx.fillStyle='#e4ca4e';ctx.fillRect(x-s/2,y-s/2,s,s);}
  function drawCenter(ctx,color){ctx.fillStyle=color;ctx.fillRect(-3/state.zoom,-3/state.zoom,6/state.zoom,6/state.zoom);}

  function getGizmoHit(node, world){const g=gizmoTarget(node),dx=world.x-g.center[0],dy=world.y-g.center[1],c=Math.cos(-g.angle),s=Math.sin(-g.angle),lx=dx*c-dy*s,ly=dx*s+dy*c,mode=state.mode;if(mode==='scale'||mode==='all'){const hit=10/state.zoom;for(const p of [[-g.w/2,-g.h/2,'tl'],[0,-g.h/2,'top'],[g.w/2,-g.h/2,'tr'],[-g.w/2,0,'left'],[g.w/2,0,'right'],[-g.w/2,g.h/2,'bl'],[0,g.h/2,'bottom'],[g.w/2,g.h/2,'br']])if(Math.hypot(lx-p[0],ly-p[1])<hit)return {type:'scale',corner:p[2]};}if(mode==='rotate'||mode==='all'){const r=Math.max(g.w,g.h)/2+30/state.zoom;if(Math.abs(Math.hypot(lx,ly)-r)<10/state.zoom&&ly<0)return {type:'rotate'};}if(mode==='move'||mode==='all'){const hit=12/state.zoom,mx=Math.max(42/state.zoom,g.w*.55),my=Math.max(42/state.zoom,g.h*.55);if(Math.hypot(lx,ly)<=hit*1.25)return {type:'move',axis:'free'};if(Math.abs(ly)<hit&&lx>8/state.zoom&&lx<mx+hit)return {type:'move',axis:'x'};if(Math.abs(lx)<hit&&ly<-8/state.zoom&&ly>-my-hit)return {type:'move',axis:'y'};}return null;}

  function nodeAt(world){
    const ctx=$('#workplaceCanvas').getContext('2d');for(const {node} of allNodes().slice().reverse()){if(node.type!=='node')continue;const t=component(node,'transform');if(!t)continue;let dx=world.x-t.position[0],dy=world.y-t.position[1],rad=Number(t.angle?.[0]||0)*Math.PI/180,c=Math.cos(-rad),s=Math.sin(-rad),lx=dx*c-dy*s,ly=dx*s+dy*c,sx=Math.abs(Number(t.scale?.[0]||1)),sy=Math.abs(Number(t.scale?.[1]||1));
      const geo=spriteLocalGeometry(node);
      if(geo){if(Math.abs(lx/sx-geo.x)<=geo.w/2&&Math.abs(ly/sy-geo.y)<=geo.h/2)return node;continue;}
      const size=getNodeVisualSize(node,ctx),bw=Math.max(70,size.w*sx),bh=Math.max(45,size.h*sy);if(Math.abs(lx)<=bw/2&&Math.abs(ly)<=bh/2)return node;}return null;
  }

  function moveMainSelection(delta){const list=visibleTreeItems(),id=state.selectedId,i=list.findIndex(n=>n.id===id);if(!list.length)return;const next=list[clamp((i<0?0:i)+delta,0,list.length-1)];setNodeSelection(next,{});renderAll();}
  function snapSelectedMainNode(){
    const n=selectedNode() || findNode(state.selectedIds?.at(-1));
    if(!n)return status('Select a Node to snap');
    const t=gizmoTarget(n)?.transform||component(n,'transform')?.transform||component(n,'transform')||{};
    const p=t.position||n.position||[0,0];
    state.pan.x=-Number(p[0]||0)*state.zoom;state.pan.y=-Number(p[1]||0)*state.zoom;drawWorkplace();status(`Snapped to ${n.name}`);
  }
  function mainNodeContextMenu(node,x,y){
    if(node){if(!state.selectedIds.includes(node.id)){clearNodeSelection(node.id);}else state.selectedId=node.id;renderSelectionTree();renderComponentPanel();drawWorkplace();}
    const many=topLevelSelectedItems().length>1;
    showContextMenu([
      ...(many?[{label:`${topLevelSelectedItems().length} selected`,icon:'☷',disabled:true}]:[]),
      {label:'Cut',icon:'✂',shortcut:window.UIXKeyBinds?.shortcutFor('cut','editor'),disabled:!topLevelSelectedItems().length,action:()=>cutNode()},
      {label:'Copy',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('copy','editor'),disabled:!topLevelSelectedItems().length,action:()=>copyNode()},
      {label:'Paste',icon:'▣',shortcut:window.UIXKeyBinds?.shortcutFor('paste','editor'),disabled:!state.nodeClipboard,action:()=>pasteNode()},
      {label:'Duplicate',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('duplicate','editor'),disabled:!topLevelSelectedItems().length,action:()=>{copyNode();pasteNode();}},
      {label:'Delete',icon:'×',shortcut:window.UIXKeyBinds?.shortcutFor('delete','editor'),disabled:!topLevelSelectedItems().length,action:()=>deleteSelectedNodes()},
      {label:'Snap to Node',icon:'⌖',shortcut:window.UIXKeyBinds?.shortcutFor('snap','editor'),disabled:!selectedNode(),action:()=>snapSelectedMainNode()},
      {label:'Select All',icon:'☷',shortcut:window.UIXKeyBinds?.shortcutFor('selectAll','editor'),action:()=>window.UIXKeyBinds?.runCommand?.('selectAll',{scope:'editor'})},
      {label:'Deselect All',icon:'○',shortcut:window.UIXKeyBinds?.shortcutFor('deselectAll','editor'),action:()=>window.UIXKeyBinds?.runCommand?.('deselectAll',{scope:'editor'})},
      {label:'Add Node',icon:'◇',action:()=>addNode()}
    ],x,y);
  }

  function enableWorkplace(){
    const canvas=$('#workplaceCanvas');const pointers=new Map();let pinch=null;
    const startPan=e=>{workspace.panDrag={x:e.clientX,y:e.clientY,panX:state.pan.x,panY:state.pan.y};canvas.setPointerCapture(e.pointerId);$('#workplace').classList.add('panning');};
    canvas.addEventListener('pointerdown',e=>{
      if(state.runtime.running)return;if(e.pointerType==='mouse'&&e.button!==0)return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===2){const[a,b]=[...pointers.values()];pinch={lastDistance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),lastMidX:(a.x+b.x)/2,lastMidY:(a.y+b.y)/2};workspace.panDrag=null;workspace.joystickDrag=null;workspace.gizmoDrag=null;return;}
      const rect=canvas.getBoundingClientRect(),world=screenToWorld(e.clientX,e.clientY),joystickHit=joystickAtEditorPoint(world,rect);
      if(joystickHit){
        state.selectedId=joystickHit.j.id;
        const cam=cameraEditorFrame(),offsetLocal=inverseRotatePoint(world.x-joystickHit.r.x,world.y-joystickHit.r.y,cam.angle);workspace.joystickDrag={joystick:joystickHit.j,offsetX:offsetLocal.x,offsetY:offsetLocal.y};
        canvas.setPointerCapture(e.pointerId);renderSelectionTree();renderComponentPanel();drawWorkplace();return;
      }
      const worldPoint=screenToWorld(e.clientX,e.clientY),selected=selectedNode();
      if(selected){const giz=getGizmoHit(selected,worldPoint);if(giz){{const target=gizmoTarget(selected);workspace.gizmoDrag={node:selected,type:giz.type,axis:giz.axis,corner:giz.corner,startWorld:world,startPointerX:e.clientX,startPointerY:e.clientY,startTransform:clone(target.transform)};}canvas.setPointerCapture(e.pointerId);return;}}
      const node=nodeAt(worldPoint);if(node){setNodeSelection(node,e);renderSelectionTree();renderComponentPanel();drawWorkplace();return;}
      if(state.selectedId!==null){state.selectedId=null;renderSelectionTree();renderComponentPanel();}
      clearTimeout(longPressTimer);startPan(e);
    });
    canvas.addEventListener('pointermove',e=>{
      if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size>=2&&pinch){
        const [a,b]=[...pointers.values()],midX=(a.x+b.x)/2,midY=(a.y+b.y)/2,dist=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));
        const before=screenToWorld(pinch.lastMidX,pinch.lastMidY),rect=canvas.getBoundingClientRect();
        state.zoom=clamp(state.zoom*(dist/pinch.lastDistance),.2,5);
        state.pan.x=(midX-rect.left-rect.width/2)-before.x*state.zoom;
        state.pan.y=(midY-rect.top-rect.height/2)-before.y*state.zoom;
        pinch.lastDistance=dist;pinch.lastMidX=midX;pinch.lastMidY=midY;drawWorkplace();return;
      }
      if(workspace.joystickDrag){
        const j=workspace.joystickDrag.joystick,world=screenToWorld(e.clientX,e.clientY),cam=cameraEditorFrame();
        const local=inverseRotatePoint(world.x-cam.x,world.y-cam.y,cam.angle);const w=Math.max(1,Number(j.size?.[0]||110)),h=Math.max(1,Number(j.size?.[1]||110));
        const localX=local.x-workspace.joystickDrag.offsetX,localY=local.y-workspace.joystickDrag.offsetY;
        j.position.left=Math.round(clamp(localX+cam.w/2-w/2,0,Math.max(0,cam.w-w)));j.position.top=Math.round(clamp(localY+cam.h/2-h/2,0,Math.max(0,cam.h-h)));j.position.right=null;j.position.bottom=null;drawWorkplace();return;
      }
      if(workspace.gizmoDrag){updateGizmoDrag(e);return;}
      if(workspace.panDrag){state.pan.x=workspace.panDrag.panX+e.clientX-workspace.panDrag.x;state.pan.y=workspace.panDrag.panY+e.clientY-workspace.panDrag.y;drawWorkplace();}
    });
    const end=e=>{
      if(e?.pointerId!==undefined)pointers.delete(e.pointerId);if(pointers.size<2)pinch=null;
      if(workspace.joystickDrag){workspace.joystickDrag=null;renderComponentPanel();}
      if(workspace.gizmoDrag){workspace.gizmoDrag=null;renderComponentPanel();}
      workspace.panDrag=null;$('#workplace').classList.remove('panning');
    };
    canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
    canvas.addEventListener('wheel',e=>{e.preventDefault();const rect=canvas.getBoundingClientRect(),before=screenToWorld(e.clientX,e.clientY),next=clamp(state.zoom*Math.exp(-e.deltaY*.0012),.2,5);state.zoom=next;const screenAfter=worldToScreen(before.x,before.y);state.pan.x+=e.clientX-rect.left-screenAfter.x;state.pan.y+=e.clientY-rect.top-screenAfter.y;drawWorkplace();},{passive:false});
    canvas.addEventListener('dblclick',()=>{state.pan={x:0,y:0};state.zoom=1;drawWorkplace();});
    canvas.addEventListener('contextmenu',e=>{e.preventDefault();const world=screenToWorld(e.clientX,e.clientY),node=nodeAt(world);mainNodeContextMenu(node,e.clientX,e.clientY);});
    new ResizeObserver(()=>{resizeWorkplaceCanvas();drawWorkplace();}).observe($('#workplace'));
  }

  function updateGizmoDrag(e){
    const d=workspace.gizmoDrag,n=d.node,g=gizmoTarget(n),t=g.transform,current=screenToWorld(e.clientX,e.clientY),dx=current.x-d.startWorld.x,dy=current.y-d.startWorld.y,settings=getEditorSettings(),snap=Math.max(0,Number(settings.moveScaleSnap)||0),rotateSnap=Math.max(0,Number(settings.rotateSnap)||0);
    if(d.type==='move'){
      const px=d.axis==='y'?d.startTransform.position[0]:d.startTransform.position[0]+dx;
      const py=d.axis==='x'?d.startTransform.position[1]:d.startTransform.position[1]+dy;
      t.position=[snapEditorValue(px,snap),snapEditorValue(py,snap)];
    }else if(d.type==='rotate'){
      const r=$('#workplaceCanvas').getBoundingClientRect(),center=worldToScreen(g.center[0],g.center[1]),cx=r.left+center.x,cy=r.top+center.y,startA=Math.atan2(d.startPointerY-cy,d.startPointerX-cx),nowA=Math.atan2(e.clientY-cy,e.clientX-cx);
      const raw=d.startTransform.angle[0]+(nowA-startA)*180/Math.PI;t.angle=[rotateSnap?snapEditorValue(raw,rotateSnap):raw];
    }else if(d.type==='scale'){
      const a=g.angle,L=rotatePoint(dx,dy,-a),baseX=Math.max(1,g.baseW),baseY=Math.max(1,g.baseH),left=['left','tl','bl'].includes(d.corner),right=['right','tr','br'].includes(d.corner),top=['top','tl','tr'].includes(d.corner),bottom=['bottom','bl','br'].includes(d.corner),sx=Number(d.startTransform.scale?.[0]??1),sy=Number(d.startTransform.scale?.[1]??1);
      let nx=sx,ny=sy;
      if(d.corner==='left'||d.corner==='right') nx=sx+(L.x/baseX)*(right?1:-1)*2;
      else if(d.corner==='top'||d.corner==='bottom') ny=sy+(L.y/baseY)*(bottom?1:-1)*2;
      else {
        const rawX=sx+(L.x/baseX)*(right?1:-1)*2,rawY=sy+(L.y/baseY)*(bottom?1:-1)*2;
        const bx=Math.max(1e-6,Math.abs(sx)),by=Math.max(1e-6,Math.abs(sy));
        const fx=rawX/sx,fy=rawY/sy;
        const factor=Math.abs(fx-1)>=Math.abs(fy-1)?fx:fy;
        nx=sx*factor;ny=sy*factor;
      }
      nx=Math.max(0.01,nx);ny=Math.max(0.01,ny);
      if(snap>0 && d.corner!=='left' && d.corner!=='right' && d.corner!=='top' && d.corner!=='bottom'){
        const dominant=Math.abs(nx-sx)>=Math.abs(ny-sy)?'x':'y';
        if(dominant==='x'){nx=snapEditorValue(nx,snap);ny=Math.max(0.01,sx!==0?sy*(nx/sx):ny);}
        else {ny=snapEditorValue(ny,snap);nx=Math.max(0.01,sy!==0?sx*(ny/sy):nx);}
      }else{
        nx=snapEditorValue(nx,snap);ny=snapEditorValue(ny,snap);
      }
      t.scale[0]=Number(nx.toFixed(12));t.scale[1]=Number(ny.toFixed(12));
    }
    drawWorkplace();
  }

  function applyAssetImage(src){if(!src)return null;if(assetImageCache.has(src))return assetImageCache.get(src);const img=new Image();img.src=src;assetImageCache.set(src,img);img.onload=()=>drawWorkplace();return img;}
  const getAssetImage=applyAssetImage;

  // ---------------- Modals / menus ----------------
  function refreshModalBackdrop(){const any=$$('.modal').some(m=>!m.hidden);$('#modalBackdrop').hidden=!any;}
  function showModal(modal){if(!modal)return;closeMenus();modal.hidden=false;modalStack=modalStack.filter(id=>id!==modal.id);modalStack.push(modal.id);modal.style.zIndex=String(200010+modalStack.length);modal.classList.add('modal-stack-active');refreshModalBackdrop();requestAnimationFrame(()=>{modal.style.zIndex=String(200010+modalStack.length);});}
  function hideAllModals(){closeContextMenu();$$('.modal').forEach(x=>x.hidden=true);$('#modalBackdrop').hidden=true;modalStack=[];}
  function closeModal(target=null){const modal=typeof target==='string'?$('#'+target):target||$('#'+modalStack.at(-1));if(!modal)return;modal.hidden=true;modal.classList.remove('modal-stack-active');modalStack=modalStack.filter(id=>id!==modal.id);if(modal.id==='expressionModal')state.script.editingInput=null;if(modal.id==='scriptModal'){saveScriptViewport();resetScriptCanvasInteraction?.();}refreshModalBackdrop();const topId=modalStack.at(-1),top=topId?$('#'+topId):null;if(top)top.style.zIndex=String(200010+modalStack.length);if(modal.dataset.removeOnClose==='true')queueMicrotask(()=>modal.remove());}
  function closeMenus(){ $$('.context-menu.open').forEach(x=>{x.classList.remove('open');x.style.display='';x.style.visibility='';x.style.left='';x.style.top='';});if(activeSelectMenu){activeSelectMenu.remove();activeSelectMenu=null;}if(activeNativeSelect){activeNativeSelect.select.setAttribute('aria-expanded','false');activeNativeSelect.menu.remove();activeNativeSelect=null;}$$('.select-menu').forEach(x=>{x.hidden=true;if(x.classList.contains('floating-select-menu'))x.remove();}); }
  function toggleMenu(id){const m=$('#'+id);if(!m)return;const open=!m.classList.contains('open');closeMenus();if(open){m.classList.add('open');positionMenu(m,m.previousElementSibling||m.parentElement);}}
  function hideMenuElement(menu){if(!menu)return;menu.classList.remove('open');menu.style.display='';menu.style.visibility='';menu.style.left='';menu.style.top='';}
  function toggleSubMenu(id,anchor){const m=$('#'+id);if(!m)return;const open=!m.classList.contains('open');$$('.context-menu.nested-menu').forEach(x=>{if(x!==m)hideMenuElement(x);});if(!open){hideMenuElement(m);return;}m.classList.add('open');positionSubMenu(m,anchor);}
  function positionMenu(menu,anchor){menu.style.position='fixed';menu.style.visibility='hidden';menu.style.display='block';const ar=anchor?.getBoundingClientRect?.()||{left:0,right:0,top:0,bottom:0},mr=menu.getBoundingClientRect(),pad=6;let left=ar.left,top=ar.bottom+2;if(top+mr.height>innerHeight-pad)top=ar.top-mr.height-2;if(left+mr.width>innerWidth-pad)left=innerWidth-mr.width-pad;if(left<pad)left=pad;if(top<pad)top=pad;menu.style.left=`${left}px`;menu.style.top=`${top}px`;menu.style.visibility='visible';}
  function positionSubMenu(menu,anchor){menu.style.position='fixed';menu.style.visibility='hidden';menu.style.display='block';const ar=anchor.getBoundingClientRect(),mr=menu.getBoundingClientRect(),pad=6;let left=ar.right+2,top=ar.top;if(left+mr.width>innerWidth-pad)left=ar.left-mr.width-2;if(top+mr.height>innerHeight-pad)top=innerHeight-mr.height-pad;if(top<pad)top=pad;menu.style.left=`${Math.max(pad,left)}px`;menu.style.top=`${top}px`;menu.style.visibility='visible';}
  function showContextMenu(items,x,y){const menu=$('#floatingContextMenu');menu.innerHTML='';items.forEach(item=>{const b=document.createElement('button');b.type='button';b.disabled=!!item.disabled;b.classList.toggle('disabled-menu-item',!!item.disabled);const shortcut=item.shortcut||'';b.innerHTML=`<span>${item.icon||'×'}</span><span>${esc(item.label)}</span>${shortcut?`<span class="shortcut-hint">${esc(window.UIXKeyBinds?.display?.(shortcut)||shortcut)}</span>`:''}`;b.addEventListener('click',()=>{if(item.disabled)return;closeContextMenu();item.action?.();});menu.append(b);});menu.hidden=false;menu.classList.add('open');menu.style.position='fixed';menu.style.zIndex='2147483646';menu.style.pointerEvents='auto';menu.style.visibility='hidden';menu.style.left='0px';menu.style.top='0px';const r=menu.getBoundingClientRect(),pad=6;const left=clamp(x,pad,innerWidth-r.width-pad),top=clamp(y,pad,innerHeight-r.height-pad);menu.style.left=`${left}px`;menu.style.top=`${top}px`;menu.style.visibility='visible';}
  function closeContextMenu(){const m=$('#floatingContextMenu');m.hidden=true;m.classList.remove('open');m.innerHTML='';}
  function askConfirm(title,text,onConfirm,okText='Delete'){ $('#confirmModalTitle').textContent=title;$('#confirmModalText').textContent=text;$('#confirmModalOk').textContent=okText;confirmAction=onConfirm;showModal($('#confirmModal')); }
  function doConfirm(){const fn=confirmAction;confirmAction=null;closeModal($('#confirmModal'));fn?.();}
  function promptModal(title,label,value,onSubmit){
    const modal=document.createElement('section');modal.className='modal';modal.id=`prompt-${Date.now()}`;modal.innerHTML=`<div class="modal-header"><div><h3>${esc(title)}</h3><p>${esc(label)}</p></div><button class="modal-close">×</button></div><div class="prompt-body"><input></div><div class="modal-actions"><button class="btn cancel">Cancel</button><button class="btn primary apply">Apply</button></div>`;document.body.append(modal);showModal(modal);const input=$('input',modal);input.value=value||'';input.focus();$('.cancel',modal).onclick=()=>{closeModal(modal);modal.remove();};$('.modal-close',modal).onclick=()=>{closeModal(modal);modal.remove();};$('.apply',modal).onclick=()=>{const v=input.value;closeModal(modal);modal.remove();onSubmit(v);};
  }

  function showInfo(title,text){askConfirm(title,text,()=>{},'Close');}
  function resetToProjectMenu(){
    hideAllModals(); closeMenus(); stopRuntime();
    state.project={name:'Untitled Node2D',created:false};
    state.scenes=[]; state.currentSceneId=''; state.selectedId='scene-camera'; state.selectedIds=[]; state.selectionAnchorId=null;
    state.nextNodeId=1; state.nextVariableId=1; state.globalVariables=[]; state.sceneVariablesByScene=Object.create(null); state.localVarsByNode=Object.create(null); state.uiComponentsByScene=Object.create(null);
    state.pan={x:0,y:0}; state.zoom=1; state.camera=defaultCamera(); state.game={preferredSceneId:'',screenType:'Windowboxing',requirements:{'Use Mic':false},mic:{speechLanguage:'en-US',continuous:true,interimResults:true}};
    state.script={nodeId:null,selectedNodeId:null,selectedNodeIds:[],selectionAnchorId:null,pan:{x:0,y:0},zoom:1,nodesByNode:Object.create(null),connectionsByNode:Object.create(null),viewsByNode:Object.create(null),editingInput:null,clipboard:null};
    state.history={undo:[],redo:[],busy:false}; state.nodeClipboard=null; state.componentClipboard=null; state.ui.selectedComponentKey='';
    $('#appShell').classList.add('exited');
    clearCurrentProjectSession();
    showModal($('#projectModal'));
  }

  function openEditorSettings(){
    const host=$('#editorKeybindList');if(!host)return;host.innerHTML='';
    const old=$('#editorSnapSettings');old?.remove();
    const settings=getEditorSettings();
    const settingsWrap=document.createElement('div');settingsWrap.id='editorSnapSettings';settingsWrap.className='editor-snap-settings';
    const heading=document.createElement('div');heading.className='editor-snap-heading';heading.textContent='Editing Snap';settingsWrap.append(heading);
    const makeRow=(label,value,options={})=>{const row=document.createElement('div');row.className='editor-snap-row';const name=document.createElement('div');name.className='keybind-name';name.textContent=label;const control=document.createElement('div');control.className='editor-snap-control';if(options.select){const select=document.createElement('select');select.className='editor-snap-input';options.select.forEach(v=>{const opt=document.createElement('option');opt.value=String(v);opt.textContent=v===0?'0° (Off)':`${v}°`;opt.selected=Number(v)===Number(value);select.append(opt);});select.addEventListener('change',()=>{const next=getEditorSettings();next.rotateSnap=Math.max(0,Number(select.value)||0);saveEditorSettings(next);});control.append(select);}else{const input=document.createElement('input');input.className='editor-snap-input';input.type='number';input.min='0';input.step='0.01';input.value=String(value);input.addEventListener('change',()=>{const next=getEditorSettings();next.moveScaleSnap=Math.max(0,Number(input.value)||0);input.value=String(next.moveScaleSnap);saveEditorSettings(next);});control.append(input);}row.append(name,control);settingsWrap.append(row);};
    makeRow('Move / Scale Snap',settings.moveScaleSnap);
    makeRow('Rotate Snap',settings.rotateSnap,{select:[0,15,30,45,90,180]});
    const saveHeading=document.createElement('div');saveHeading.className='editor-snap-heading';saveHeading.textContent='Saving';settingsWrap.append(saveHeading);
    const autoRow=document.createElement('div');autoRow.className='editor-snap-row';const autoLabel=document.createElement('label');autoLabel.className='game-setting-check';const autoCheck=document.createElement('input');autoCheck.type='checkbox';autoCheck.checked=!!settings.autoSave;const autoText=document.createElement('span');autoText.textContent='Auto Save';autoLabel.append(autoCheck,autoText);autoRow.append(autoLabel);settingsWrap.append(autoRow);
    const intervalRow=document.createElement('div');intervalRow.className='editor-snap-row';const intervalName=document.createElement('div');intervalName.className='keybind-name';intervalName.textContent='Auto Save Interval';const intervalControl=document.createElement('div');intervalControl.className='editor-snap-control';const intervalInput=document.createElement('input');intervalInput.className='editor-snap-input';intervalInput.type='number';intervalInput.min='1';intervalInput.step='1';intervalInput.value=String(settings.autoSaveIntervalSec);const intervalUnit=document.createElement('span');intervalUnit.className='editor-snap-unit';intervalUnit.textContent='Seconds';intervalControl.append(intervalInput,intervalUnit);intervalRow.append(intervalName,intervalControl);settingsWrap.append(intervalRow);
    const syncSaveUI=()=>{intervalRow.hidden=!autoCheck.checked;};syncSaveUI();
    autoCheck.addEventListener('change',()=>{const next=getEditorSettings();next.autoSave=autoCheck.checked;next.autoSaveIntervalSec=clamp(Number(intervalInput.value)||30,1,86400);saveEditorSettings(next);syncSaveUI();});
    intervalInput.addEventListener('change',()=>{const next=getEditorSettings();next.autoSave=autoCheck.checked;next.autoSaveIntervalSec=clamp(Number(intervalInput.value)||30,1,86400);intervalInput.value=String(next.autoSaveIntervalSec);saveEditorSettings(next);});
    host.parentElement?.insertBefore(settingsWrap,host);
    const defs=window.UIXKeyBinds?.getAll?.()||[];const groups={editor:'Editor',all:'Global / All Editors',script:'Script Editor',sprite:'Sprite Editor',midi:'MIDI Editor'};
    defs.forEach((def,i)=>{
      if(i===0||defs[i-1].scope!==def.scope){const g=document.createElement('div');g.className='keybind-group';g.textContent=groups[def.scope]||def.scope;host.append(g);}
      const row=document.createElement('div');row.className='keybind-row';
      const name=document.createElement('div');name.className='keybind-name';name.textContent=def.name;
      const scope=document.createElement('div');scope.className='keybind-scope';scope.textContent=def.scope;
      const input=document.createElement('input');input.className='keybind-input';input.value=def.keys||'';input.placeholder='Example: Ctrl+Shift+K';input.dataset.command=def.command;input.dataset.name=def.name;input.readOnly=true;
      const reset=document.createElement('button');reset.className='btn keybind-reset';reset.type='button';reset.textContent='Clear';
      const commit=()=>{def.keys=input.value.trim();window.UIXKeyBinds?.save?.();renderKeybindHints();};
      input.addEventListener('keydown',e=>{e.preventDefault();e.stopPropagation();if(e.key==='Escape'){input.blur();return;}if(e.key==='Backspace'){input.value='';commit();return;}const parts=[];if(e.ctrlKey)parts.push('Ctrl');if(e.metaKey)parts.push('Meta');if(e.altKey)parts.push('Alt');if(e.shiftKey)parts.push('Shift');let k=e.key;if(k===' ')k='Space';else if(k==='Escape')k='Escape';else if(k.length===1)k=k.toUpperCase();else k=k.charAt(0).toUpperCase()+k.slice(1);if(!['Control','Meta','Alt','Shift'].includes(k)){parts.push(k);input.value=parts.join('+');commit();input.blur();}});
      reset.onclick=()=>{def.keys='';input.value='';window.UIXKeyBinds?.save?.();renderKeybindHints();};
      row.append(name,scope,input,reset);host.append(row);
    });
    showModal($('#editorSettingsModal'));
  }
  function renderKeybindHints(){
    const defs=window.UIXKeyBinds?.getAll?.()||[];const map=new Map(defs.map(d=>[d.command,d.keys]));
    $$('[data-action]').forEach(b=>{const cmdMap={'save':'save','new-project':'new','load-local':'open','import-project':'open','undo':'undo','redo':'redo','cut-node':'cut','copy-node':'copy','paste-node':'paste','delete-selection':'delete','toggle-fullscreen':'fullscreen'};const cmd=cmdMap[b.dataset.action];if(!cmd)return;let h=b.querySelector('.shortcut-hint');if(!h){h=document.createElement('span');h.className='shortcut-hint';b.append(h);}h.textContent=window.UIXKeyBinds?.display?.(map.get(cmd)||'')||'';h.hidden=!h.textContent;});
  }
  function importEditorPreferences(){
    let input=$('#editorPreferencesImportInput');
    if(!input){
      input=document.createElement('input');
      input.type='file';
      input.accept='application/json,.json';
      input.id='editorPreferencesImportInput';
      input.hidden=true;
      document.body.append(input);
      input.addEventListener('change',()=>{
        const file=input.files?.[0];
        input.value='';
        if(!file)return;
        const reader=new FileReader();
        reader.onload=()=>{
          try{
            const payload=JSON.parse(String(reader.result||''));
            if(!payload||typeof payload!=='object')throw new Error('Invalid preferences file.');
            if(payload.localStorage&&typeof payload.localStorage==='object'){
              Object.entries(payload.localStorage).forEach(([key,value])=>{
                if(typeof key!=='string')return;
                if(value===null)localStorage.removeItem(key);
                else localStorage.setItem(key,String(value));
              });
            }
            if(payload.editorSettings&&typeof payload.editorSettings==='object'){
              const next={...getEditorSettings(),...payload.editorSettings};
              saveEditorSettings(next);
            }
            const imported=payload.shortcuts&&typeof payload.shortcuts==='object'?payload.shortcuts:null;
            if(imported){
              const defs=window.UIXKeyBinds?.getAll?.()||[];
              defs.forEach(def=>{
                const key=def.command+'|'+def.name;
                if(typeof imported[key]==='string')def.keys=imported[key];
              });
              window.UIXKeyBinds?.save?.();
            }
            openEditorSettings();
            renderKeybindHints();
            status('Editor preferences imported');
          }catch(err){
            showInfo('Import Preferences',err?.message||'Could not import the preferences file.');
          }
        };
        reader.onerror=()=>showInfo('Import Preferences','Could not read the preferences file.');
        reader.readAsText(file);
      });
    }
    input.click();
  }

  function downloadEditorPreferences(){
    const storage={};
    try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key)storage[key]=localStorage.getItem(key);}}catch{}
    let keybinds={};
    try{const defs=window.UIXKeyBinds?.getAll?.()||[];keybinds=Object.fromEntries(defs.map(k=>[k.command+'|'+k.name,k.keys||'']));}catch{}
    const payload={
      format:'Node2D Editor Preferences',
      version:2,
      editorSettings:getEditorSettings(),
      shortcuts:keybinds,
      localStorage:storage
    };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='node2d-editor-preferences.json';a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
    status('Editor preferences downloaded');
  }
  function action(name,source=null){
    closeMenus();
    switch(name){
      case 'new-project': askConfirm('Create New Project','Create a new Node2D project? The current editor state will be reset.',openProjectNameModal,'Create'); break;
      case 'load-project': openLoadChoice(); break;
      case 'load-local': openLocalNDCModal(); break;
      case 'import-project': openProjectImport(); break;
      case 'save-project': saveProjectToProjectStorage(); break;
      case 'export-project': openExportProjectModal(); break;
      case 'help': {
        const frame=$('#helpFrame');
        if(frame && !frame.getAttribute('src')) frame.src='help/index.html';
        showModal($('#helpModal'));
        break;
      }
      case 'export-ndc': exportProjectNDC(); break;
      case 'game-settings': openGameSettings(); break;
      case 'editor-settings': openEditorSettings(); break;
      case 'reset-keybinds': {
        window.UIXKeyBinds?.reset?.();
        try{localStorage.setItem(EDITOR_SETTINGS_STORE,JSON.stringify(DEFAULT_EDITOR_SETTINGS));}catch{}
        resetAutoSaveTimer();
        openEditorSettings();
        status('Editor defaults restored');
        break;
      }
      case 'download-preferences': downloadEditorPreferences(); break;
      case 'import-preferences': importEditorPreferences(); break;
      case 'exit': askConfirm('Exit Editor','Close the current Node2D editor session?',resetToProjectMenu,'Exit'); break;
      case 'add-scene': addScene(); break;
      case 'add-node': addNode(); break;
      case 'add-folder': addFolder(); break;
      case 'play-scene': startRuntime(false); break;
      case 'debug-scene': startRuntime(true); break;
      case 'open-add-component': openAddComponent(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'cut-node': cutNode(selectedNode()); break;
      case 'copy-node': copyNode(selectedNode()); break;
      case 'paste-node': pasteNode(); break;
      case 'delete-selection': deleteSelectedNodes(); break;
      case 'snap-node': snapSelectedMainNode(); break;
      case 'add-local-variable': addVariable(false); break;
      case 'collapse-selection': togglePanel('selectionPanel'); break;
      case 'collapse-components': togglePanel('componentPanel'); break;
      case 'toggle-fullscreen': toggleFullscreen(); break;
      case 'install-node2d': installNode2DApp(); break;
      case 'open-assets': openAssetManager(); break;
      case 'import-assets': $('#assetFileInput').click(); break;
      case 'create-asset': showModal($('#assetCreateModal')); break;
      case 'new-sprite-editor': closeModal($('#assetCreateModal')); window.UIXSpriteEditor?.openCreate(); break;
      case 'new-midi-editor': closeModal($('#assetCreateModal')); window.UIXMIDIEditor?.openCreate(); break;
      case 'apply-color': applyColor(); break;
      case 'apply-expression': applyExpression(); break;
      case 'clear-expression': clearExpression(); break;
      case 'close-modal': closeModal(source?.closest?.('.modal')||null); break;
      case 'cancel-confirm': confirmAction=null;closeModal($('#confirmModal')); break;
      case 'submit-project-name': { const input=$('#projectNameInput'); const name=String(input?.value||'').trim(); if(!name){ input?.focus(); status('Project Name is required'); break; } closeModal($('#projectNameModal')); createProject(name); break; }
    }
  }
  function projectAction(a){
    if(a==='create') openProjectNameModal();
    else if(a==='load') openLoadChoice();
    else if(a==='load-local') openLocalNDCModal();
    else if(a==='import') openProjectImport();
    else if(a==='save') saveProjectToProjectStorage();
    else if(a==='export') exportProjectNDC();
    else status(`${a} is not implemented yet`);
  }

  function collectProjectData(){
    const project=clone(state.project);
    delete project.localNdcId;
    return {
      project,
      scenes: clone(state.scenes),
      currentSceneId: state.currentSceneId,
      selectedId: state.selectedId,
      mode: state.mode,
      nextNodeId: state.nextNodeId,
      nextVariableId: state.nextVariableId,
      globalVariables: clone(state.globalVariables),
      sceneVariablesByScene: clone(state.sceneVariablesByScene),
      localVarsByNode: clone(state.localVarsByNode),
      uiComponentsByScene: clone(state.uiComponentsByScene),
      script: clone({nodesByNode:state.script.nodesByNode,connectionsByNode:state.script.connectionsByNode,viewsByNode:state.script.viewsByNode}),
      game: clone(state.game),
      camera: clone(state.camera),
      assets: clone(state.assets)
    };
  }

  function applyProjectData(data,meta={}){
    if(!data || !Array.isArray(data.scenes) || !data.scenes.length) throw new Error('NDC project contains no scenes');
    stopRuntime();
    const project=clone(data.project||{name:'Untitled Node2D',created:true});
    state.project={name:String(project.name||'Untitled Node2D'),created:true,...project};
    state.project.localNdcId=meta.localNdcId||null;
    state.scenes=clone(data.scenes);
    state.currentSceneId=data.currentSceneId&&state.scenes.some(s=>s.id===data.currentSceneId)?data.currentSceneId:state.scenes[0].id;
    state.selectedId=data.selectedId||'scene-camera';
    state.selectedIds=[];state.selectionAnchorId=null;
    state.mode=data.mode||'select';
    state.nextNodeId=Number(data.nextNodeId)||1;
    state.nextVariableId=Number(data.nextVariableId)||1;
    state.globalVariables=clone(data.globalVariables||[]);
    state.sceneVariablesByScene=clone(data.sceneVariablesByScene||{});
    state.localVarsByNode=clone(data.localVarsByNode||{});
    enforceVariableUniqueness();
    state.uiComponentsByScene=clone(data.uiComponentsByScene||{});
    state.script={nodeId:null,selectedNodeId:null,pan:{x:0,y:0},zoom:1,nodesByNode:restoreScriptNodeDefinitions(data.script?.nodesByNode||{}),connectionsByNode:clone(data.script?.connectionsByNode||{}),viewsByNode:clone(data.script?.viewsByNode||{}),editingInput:null};
    state.game=clone(data.game||{preferredSceneId:'',screenType:'Windowboxing'});
    ensureGameSettings();
    state.camera=clone(data.camera||defaultCamera());
    if(!state.game.preferredSceneId||!state.scenes.some(s=>s.id===state.game.preferredSceneId)) state.game.preferredSceneId=state.scenes[0].id;
    Object.keys(state.assets).forEach(k=>{state.assets[k].length=0;});
    const savedAssets=data.assets||{};
    ['Sprite','Audio','MIDI'].forEach(k=>{if(Array.isArray(savedAssets[k])) state.assets[k].push(...clone(savedAssets[k]));});
    state.history={undo:[],redo:[],busy:false};
    state.nodeClipboard=null; state.componentClipboard=null; state.ui.selectedComponentKey='';
    if(!window.__UIX_STANDALONE__){
      $('#appShell')?.classList.remove('exited');
      hideAllModals();
      syncSceneCamera(); renderAll();
    }
    rememberCurrentProjectSession(); resetAutoSaveTimer();
  }

  function downloadBytes(bytes,name,type='application/octet-stream'){
    const blob=new Blob([bytes],{type});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=name; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }

  async function buildProjectNDC(){
    if(!window.UIXNDCCodec) throw new Error('NDC codec is not loaded');
    return window.UIXNDCCodec.encode(collectProjectData());
  }

  function hasLoadedProject(){return !!state.project.created&&Array.isArray(state.scenes)&&state.scenes.length>0;}
  function openLoadChoice(){showModal($('#loadModal'));}

  async function saveProjectToProjectStorage(silent=false){
    try{
      ensureProject();
      const bytes=await buildProjectNDC();
      const saved=await window.UIXNDCCodec.saveCurrent(bytes,state.project.name,state.project.localNdcId||null);
      state.project.localNdcId=saved?.id||state.project.localNdcId||null;
      rememberCurrentProjectSession();
      if(!silent)status(`Saved in Project · ${Math.round(bytes.length/1024)} KB`);
    }catch(err){console.error(err);if(!silent)status(`Save failed: ${err.message||err}`);}
  }

  function loadProjectBytes(bytes,label,meta={}){
    try{
      const data=window.UIXNDCCodec.decode(bytes);
      const apply=()=>{applyProjectData(data,meta);status(`${label||'Project'} loaded`);};
      if(hasLoadedProject()&&!meta.force&&!window.__UIX_STANDALONE__)askConfirm('Replace Current Project',`Load “${label||'Project'}” and replace the current project?`,apply,'Load');
      else apply();
    }catch(err){console.error(err);status(`Load failed: ${err.message||err}`);}
  }

  async function loadProjectFromProjectStorage(){
    try{
      const saved=await window.UIXNDCCodec.loadCurrent();
      if(!saved){status('No saved project in Project storage');return;}
      loadProjectBytes(saved.bytes,saved.name||'Local NDC',{localNdcId:saved.id||null});
    }catch(err){console.error(err);status(`Load failed: ${err.message||err}`);}
  }

  async function openLocalNDCModal(){
    const host=$('#localNdcList');if(!host)return;
    host.innerHTML='<div class="local-ndc-empty">Loading local projects…</div>';showModal($('#localNdcModal'));
    try{
      const list=await window.UIXNDCCodec.listLocal();
      host.innerHTML='';
      if(!list.length){host.innerHTML='<div class="local-ndc-empty">No Local NDC projects saved yet.</div>';return;}
      list.sort((a,b)=>(b.savedAt||0)-(a.savedAt||0));
      for(const record of list){
        const row=document.createElement('div');row.className='local-ndc-row';
        const open=document.createElement('button');open.type='button';open.className='local-ndc-name';open.textContent=record.name||'Untitled Node2D';open.title='Load this project';open.onclick=()=>loadLocalNDC(record.id);
        const edit=document.createElement('button');edit.type='button';edit.className='local-ndc-edit';edit.textContent='✎';edit.title='Rename';
        edit.onclick=()=>promptModal('Rename Local NDC','Edit the saved project name.',record.name||'',async value=>{
          const name=String(value||'').trim();if(!name){status('Name is required');return;}
          try{await window.UIXNDCCodec.renameLocal(record.id,name);if(state.project.localNdcId===record.id)state.project.name=name;openLocalNDCModal();status(`Renamed to ${name}`);}catch(err){status(`Rename failed: ${err.message||err}`);}
        });
        const del=document.createElement('button');del.type='button';del.className='local-ndc-delete';del.textContent='×';del.title='Delete';
        del.onclick=()=>askConfirm('Delete Local NDC',`Delete “${record.name||'Untitled Node2D'}” from this device?`,async()=>{
          try{await window.UIXNDCCodec.deleteLocal(record.id);openLocalNDCModal();status('Local NDC deleted');}catch(err){status(`Delete failed: ${err.message||err}`);}
        },'Delete');
        row.append(open,edit,del);host.append(row);
      }
    }catch(err){host.innerHTML=`<div class="local-ndc-empty">Could not read Local NDC: ${esc(err.message||err)}</div>`;}
  }

  async function restoreCurrentProjectFromSession(){
    const remembered=readCurrentProjectSession();
    if(!remembered.name&&!remembered.id)return false;
    try{
      if(remembered.id){const saved=await window.UIXNDCCodec.loadLocal(remembered.id);if(saved){loadProjectBytes(saved.bytes,saved.name||remembered.name,{localNdcId:saved.id||remembered.id,force:true});return true;}}
      const list=await window.UIXNDCCodec.listLocal();
      const match=list.find(x=>(remembered.id&&String(x.id)===String(remembered.id))||(remembered.name&&String(x.name||'')===String(remembered.name)));
      if(match){const saved=await window.UIXNDCCodec.loadLocal(match.id);if(saved){loadProjectBytes(saved.bytes,saved.name||match.name,{localNdcId:saved.id||match.id,force:true});return true;}}
    }catch(err){console.error(err);}
    return false;
  }

  async function loadLocalNDC(id){
    try{const saved=await window.UIXNDCCodec.loadLocal(id);if(!saved){status('Local NDC was not found');return;}loadProjectBytes(saved.bytes,saved.name||'Local NDC',{localNdcId:saved.id||id});}
    catch(err){console.error(err);status(`Load failed: ${err.message||err}`);}
  }

  function openProjectImport(){const input=$('#projectFileInput');if(input)input.click();}

  async function importProjectFile(file){
    try{const bytes=new Uint8Array(await file.arrayBuffer());loadProjectBytes(bytes,file.name,{localNdcId:null});}
    catch(err){console.error(err);status(`Import failed: ${err.message||err}`);}
  }

  async function loadProjectFromURL(urlText){
    try{
      const url=new URL(urlText,location.href);
      const response=await fetch(url.href,{cache:'no-store'});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const bytes=new Uint8Array(await response.arrayBuffer());
      loadProjectBytes(bytes,url.pathname.split('/').pop()||'URL NDC',{localNdcId:null});
    }catch(err){console.error(err);status(`URL load failed: ${err.message||err}`);}
  }

  async function exportProjectNDC(){
    try{ensureProject();const bytes=await buildProjectNDC();downloadBytes(bytes,`${String(state.project.name||'project').replace(/[^a-z0-9._-]+/gi,'_')}.ndc`,'application/x-ndc');status(`Exported .ndc · ${Math.round(bytes.length/1024)} KB`);}
    catch(err){console.error(err);status(`Export failed: ${err.message||err}`);}
  }
  let exportPwaManifest={};
  function getExportSettings(){
    const s=state.project.exportSettings||{};
    return {name:String(s.name||state.project.name||'My Project'),version:String(s.version||'1.0.0'),iconAssetId:s.iconAssetId||'',iconName:s.iconName||'',pwa:!!s.pwa,manifest:clone(s.manifest||{})};
  }
  function defaultPwaManifest(name,version){
    return {name,short_name:String(name).slice(0,32),version,start_url:'./',display:'fullscreen',orientation:'landscape',theme_color:state.camera?.bgColor||'#202020',background_color:state.camera?.bgColor||'#202020',description:`${name} — Node2D Project`};
  }
  function getExportIconAsset(){
    const s=getExportSettings();return (state.assets.Sprite||[]).find(a=>a.id===s.iconAssetId)||null;
  }
  function syncExportPwaFields(){
    const m=exportPwaManifest||defaultPwaManifest(String($('#exportProjectName')?.value||state.project.name||'My Project'),String($('#exportProjectVersion')?.value||'1.0.0'));
    $('#pwaName').value=m.name||'';$('#pwaShortName').value=m.short_name||'';$('#pwaStartUrl').value=m.start_url||'./';$('#pwaDisplay').value=m.display||'standalone';$('#pwaOrientation').value=m.orientation||'any';$('#pwaThemeColor').value=m.theme_color||'#202020';$('#pwaBackgroundColor').value=m.background_color||'#202020';$('#pwaDescription').value=m.description||'';$('#pwaManifestJson').value=JSON.stringify(m,null,2);$('#pwaJsonError').textContent='';
  }
  function readExportPwaFields(){
    return {name:String($('#pwaName')?.value||$('#exportProjectName')?.value||'My Project').trim(),short_name:String($('#pwaShortName')?.value||'').trim(),version:String($('#exportProjectVersion')?.value||'1.0.0').trim()||'1.0.0',start_url:String($('#pwaStartUrl')?.value||'./').trim()||'./',display:String($('#pwaDisplay')?.value||'standalone'),orientation:String($('#pwaOrientation')?.value||'any'),theme_color:String($('#pwaThemeColor')?.value||'#202020').trim(),background_color:String($('#pwaBackgroundColor')?.value||'#202020').trim(),description:String($('#pwaDescription')?.value||'').trim()};
  }
  function updateExportPwaJson(){
    const m={...(exportPwaManifest||{}) ,...readExportPwaFields()};if(m.display==='browser')delete m.display;const icon=getExportIconAsset();if(icon){m.icons=[{src:'assets/icon'+(String(icon.filename||'').toLowerCase().endsWith('.svg')?'.svg':'.png'),sizes:'any',type:icon.type||'image/png'}];} else delete m.icons;exportPwaManifest=m;$('#pwaManifestJson').value=JSON.stringify(m,null,2);$('#pwaJsonError').textContent='';
  }
  function setExportProgress(pct,text,visible=true){const box=$('#exportProgressBox'),bar=$('#exportProgressBar'),label=$('#exportProgressText'),num=$('#exportProgressPct');if(!box)return;box.hidden=!visible;if(bar)bar.style.width=`${Math.max(0,Math.min(100,pct))}%`;if(label)label.textContent=text||'';if(num)num.textContent=`${Math.round(Math.max(0,Math.min(100,pct)))}%`;}
  function openExportProjectModal(){
    ensureProject();
    const s=getExportSettings();
    const name=$('#exportProjectName');
    const version=$('#exportProjectVersion');
    const pwa=$('#exportPwaEnabled');
    const editor=$('#exportPwaEditor');
    const iconButton=$('#exportProjectIcon');
    if(name) name.value=s.name||state.project.name||'My Project';
    if(version) version.value=s.version||'1.0.0';
    if(pwa) pwa.checked=!!s.pwa;
    if(editor) editor.hidden=!s.pwa;
    const icon=getExportIconAsset();
    if(iconButton) iconButton.textContent=icon?.name||s.iconName||'Select Sprite';
    exportPwaManifest=clone(s.manifest&&typeof s.manifest==='object' ? s.manifest : defaultPwaManifest(name?.value||state.project.name||'My Project',version?.value||'1.0.0'));
    if(s.pwa) syncExportPwaFields();
    else if($('#pwaManifestJson')) $('#pwaManifestJson').value=JSON.stringify(exportPwaManifest,null,2);
    setExportProgress(0,'Ready to download',false);
    showModal($('#exportProjectModal'));
  }
  function applyPwaJson(){
    try{const raw=JSON.parse($('#pwaManifestJson').value||'{}');if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('manifest must be a JSON object');exportPwaManifest=raw;syncExportPwaFields();status('manifest.json applied');}catch(err){$('#pwaJsonError').textContent=String(err.message||err);}
  }
  async function downloadExportProject(){
    const btn=$('#exportProjectDownload');
    if(btn)btn.disabled=true;
    try{
      ensureProject();
      const name=String($('#exportProjectName').value||state.project.name||'My Project').trim()||'My Project';
      const version=String($('#exportProjectVersion').value||'1.0.0').trim()||'1.0.0';
      const pwa=!!$('#exportPwaEnabled').checked;
      const icon=getExportIconAsset();
      let manifest=null;
      if(pwa){
        manifest={...(exportPwaManifest||{}),...readExportPwaFields()};
        manifest.name=manifest.name||name;manifest.version=version;
        if(icon)manifest.icons=[{src:'assets/icon'+(String(icon.filename||'').toLowerCase().endsWith('.svg')?'.svg':'.png'),sizes:'any',type:icon.type||'image/png'}];
        else delete manifest.icons;
      }
      state.project.exportSettings={name,version,iconAssetId:icon?.id||'',iconName:icon?.name||'',pwa,manifest:clone(manifest||{})};
      setExportProgress(2,'Building project data…',true);
      const ndc=await buildProjectNDC();
      setExportProgress(8,'Packaging existing Playtime files…',true);
      const result=await window.UIXProjectExporter.exportProject({name,version,pwa,manifest,iconAsset:icon,screenType:state.game.screenType,projectNdc:ndc,needMidi:(state.assets.MIDI||[]).length>0,onProgress:(p,t)=>setExportProgress(Math.max(8,p),t,true)});
      setExportProgress(100,`Download started · ${result.name}`,true);
      status(`Exported Project · ${name}`);
      setTimeout(()=>closeModal($('#exportProjectModal')),350);
    }catch(err){
      console.error(err);
      setExportProgress(0,`Export failed: ${err.message||err}`,true);
      status(`Export Project failed: ${err.message||err}`);
    }finally{if(btn)btn.disabled=false;}
  }
  async function toggleFullscreen(){try{if(!document.fullscreenElement)await document.documentElement.requestFullscreen();else await document.exitFullscreen();}catch{status('Fullscreen is unavailable');}updateFullscreenButton();}
  function updateFullscreenButton(){const f=!!document.fullscreenElement;$('#fullscreenButton').title=f?'Unfullscreen':'Fullscreen';}

  function openGameSettings(){
    ensureGameSettings();
    const host=$('#preferredSceneControl');
    if(host){
      host.innerHTML='';
      const options=state.scenes.map(s=>s.name);
      const selected=state.scenes.find(s=>s.id===state.game.preferredSceneId)||state.scenes[0];
      state.game.preferredSceneId=selected?.id||'';
      const wrap=customSelect(selected?.name||'No Scene',options,name=>{const scene=state.scenes.find(s=>s.name===name);if(scene){state.game.preferredSceneId=scene.id;resetAutoSaveTimer();status(`Preferred Scene: ${scene.name}`);}});
      wrap.classList.add('preferred-scene-custom-select');host.append(wrap);
    }
    const screenHost=$('#screenTypeControl');
    if(screenHost){
      screenHost.innerHTML='';
      const wrap=customSelect(state.game.screenType,SCREEN_TYPES,value=>{state.game.screenType=normalizeScreenType(value);drawWorkplace();resetAutoSaveTimer();status(`Screen Type: ${state.game.screenType}`);});
      wrap.classList.add('screen-type-custom-select');screenHost.append(wrap);
    }
    const reqHost=$('#gameRequirementsControl');
    if(reqHost){
      reqHost.innerHTML='';
      const reqs=[...new Set(scriptNodes.map(n=>n.require).filter(Boolean))];
      if(!reqs.length)reqHost.innerHTML='<span class="game-settings-muted">No optional features required by the current ScriptNode library.</span>';
      reqs.forEach(req=>{
        const label=document.createElement('label');label.className='game-setting-check';
        const input=document.createElement('input');input.type='checkbox';input.checked=state.game.requirements[req]===true;
        input.addEventListener('change',()=>enableScriptNodeRequirement(req,input.checked));
        const text=document.createElement('span');text.textContent=req;label.append(input,text);reqHost.append(label);
      });
    }
    const micSection=$('#micSettingsSection');
    if(micSection){
      micSection.hidden=state.game.requirements['Use Mic']!==true;
      const lang=$('#micSpeechLanguage');if(lang){lang.value=state.game.mic.speechLanguage||'en-US';lang.onchange=()=>{state.game.mic.speechLanguage=lang.value.trim()||'en-US';resetAutoSaveTimer();};}
      const continuous=$('#micSpeechContinuous');if(continuous){continuous.checked=state.game.mic.continuous!==false;continuous.onchange=()=>{state.game.mic.continuous=continuous.checked;resetAutoSaveTimer();};}
      const interim=$('#micSpeechInterim');if(interim){interim.checked=state.game.mic.interimResults!==false;interim.onchange=()=>{state.game.mic.interimResults=interim.checked;resetAutoSaveTimer();};}
    }
    showModal($('#gameSettingsModal'));
  }

  // ---------------- Assets ----------------
  function openAudioPreview(asset){
    if(!asset?.value)return;
    const existing=$('#audioPreviewModal');existing?.remove();
    const modal=document.createElement('section');modal.id='audioPreviewModal';modal.className='modal audio-preview-modal';modal.dataset.closeOutside='true';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
    modal.innerHTML=`<div class="modal-header"><div><h3>Audio Preview</h3><p>${esc(asset.name||asset.filename||'Audio')}</p></div><button class="modal-close" type="button">×</button></div><div class="audio-preview-body"></div><div class="modal-actions"><button class="btn" type="button">Close</button></div>`;
    document.body.append(modal);
    const body=$('.audio-preview-body',modal),audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=asset.value;audio.style.width='100%';body.append(audio);
    Object.assign(body.style,{padding:'18px',minHeight:'88px',display:'grid',placeItems:'center'});
    Object.assign(modal.style,{width:'min(520px,calc(100vw - 24px))'});
    const close=()=>{try{audio.pause();audio.currentTime=0;}catch{}closeModal(modal);modal.remove();};$('.modal-close',modal).onclick=close;$('.modal-actions .btn',modal).onclick=close;
    showModal(modal);
  }
  function openAssetManager(){renderAssetManager();showModal($('#assetModal'));}
  function renderAssetManager(){
    $$('.asset-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.assetTab===state.activeAssetTab));
    const host=$('#assetContent'); host.innerHTML=''; const type=state.activeAssetTab; const list=state.assets[type]||[];
    const title=document.createElement('div'); title.className='asset-section-title'; title.textContent=type==='Sprite'?'Sprites':type==='MIDI'?'MIDI':'Audio'; host.append(title);
    if(!list.length){host.append(Object.assign(document.createElement('div'),{className:'asset-empty',textContent:`No ${type.toLowerCase()} assets imported yet.`}));return;}
    const grid=document.createElement('div'); grid.className='asset-grid';
    list.forEach(asset=>{
      const card=document.createElement('article'); card.className='asset-card';
      const preview=document.createElement('div'); preview.className=`asset-preview ${type==='Audio'?'audio-preview':''} ${type==='MIDI'?'midi-preview':''}`;
      if(type==='Sprite'){const img=document.createElement('img');img.src=asset.value;img.alt=asset.name||'Sprite';preview.append(img);}
      else if(type==='MIDI'){preview.innerHTML='<span class="midi-asset-symbol">♫</span><span class="midi-asset-meta">MIDI</span>';}
      else preview.textContent='◉';
      if(type==='Audio'){
        card.title='Click to preview this audio';
        card.addEventListener('click',e=>{if(e.target.closest('.asset-edit'))return;openAudioPreview(asset);});
      }
      const actions=document.createElement('div'); actions.className='asset-card-actions';
      const edit=document.createElement('button'); edit.type='button'; edit.className='asset-edit'; edit.title='Edit'; edit.setAttribute('aria-label','Edit asset'); edit.textContent='✎';
      edit.onclick=e=>{e.stopPropagation();if(type==='Sprite')window.UIXSpriteEditor?.openEdit(asset);else if(type==='MIDI')window.UIXMIDIEditor?.openEdit(asset);else if(type==='Audio'){
        promptModal('Rename Audio','Audio name',asset.name||asset.filename||'Audio',value=>{
          const raw=String(value||'').trim();if(!raw)return;
          const name=uniqueAssetName(raw,'Audio',asset);
          const ext=(String(asset.filename||'').match(/\.[^.]+$/)||['.uixaudio'])[0];
          asset.name=name;asset.filename=name+ext;renderAssetManager();status(`Audio renamed to ${name}`);
        });
      }};
      const del=document.createElement('button'); del.type='button'; del.className='asset-edit danger'; del.title='Delete'; del.setAttribute('aria-label','Delete asset'); del.textContent='×';
      del.onclick=e=>{e.stopPropagation();if(type==='Sprite')deleteSpriteAsset(asset);else if(type==='MIDI')deleteMIDIAsset(asset);}; actions.append(edit,del); preview.append(actions);
      const name=document.createElement('div'); name.className='asset-name'; name.textContent=asset.filename||`${asset.name||type}.asset`;
      if(type==='Sprite'){
        card.title='Click to create a Node with this Sprite';
        card.addEventListener('click',e=>{if(e.target.closest('.asset-edit'))return;addNodeFromSprite(asset);});
      }
      card.append(preview,name); grid.append(card);
    });
    host.append(grid);
  }
  function uniqueAssetName(base, type, ignore=null){
    const clean=String(base||'Asset').trim()||'Asset';
    let name=clean,i=2;
    while((state.assets[type]||[]).some(a=>a!==ignore&&a.name===name)) name=`${clean} ${i++}`;
    return name;
  }
  function addSpriteAsset(asset){
    const next={...asset,type:asset.type||'image/png',kind:asset.kind||((asset.type||'').includes('svg')?'SVG':'Raster'),editable:asset.editable!==false};
    next.filename=next.filename||`${next.name||'Sprite'}.${next.kind==='SVG'?'svg':'png'}`;
    next.name=uniqueAssetName(next.filename||'Sprite.png','Sprite');
    next.filename=next.name;
    state.assets.Sprite.push(next); renderAssetManager(); return next;
  }
  function replaceSpriteAsset(oldAsset,nextAsset){
    const list=state.assets.Sprite,idx=list.findIndex(a=>a===oldAsset||a.value===oldAsset?.value);
    const replacement={...nextAsset,type:nextAsset.type||'image/png',kind:nextAsset.kind||((nextAsset.type||'').includes('svg')?'SVG':'Raster'),editable:nextAsset.editable!==false};
    replacement.filename=nextAsset.filename||nextAsset.name||list[idx]?.filename||oldAsset?.filename||'Sprite.png';
    replacement.name=idx>=0?(nextAsset.filename||nextAsset.name||list[idx].name):uniqueAssetName(replacement.filename||'Sprite.png','Sprite');
    replacement.filename=replacement.name;
    if(idx>=0)list[idx]=replacement; else list.push(replacement);
    for(const {node} of allNodes()){
      const sprite=component(node,'sprite'); if(sprite&&sprite.src===oldAsset?.value)sprite.src=replacement.value;
      const anim=component(node,'animationsprite'); if(anim?.sprites)anim.sprites.forEach(x=>{if(x.src===oldAsset?.value)x.src=replacement.value;});
    }
    renderAssetManager();drawWorkplace();return replacement;
  }
  function deleteSpriteAsset(asset){
    askConfirm('Delete Sprite',`Delete “${asset?.name||'Sprite'}”?`,()=>{
      const list=state.assets.Sprite,idx=list.findIndex(a=>a===asset||a.value===asset?.value);
      if(idx<0)return; const old=list[idx]; list.splice(idx,1);
      for(const {node} of allNodes()){
        const sprite=component(node,'sprite'); if(sprite&&sprite.src===old.value)sprite.src='';
        const anim=component(node,'animationsprite'); if(anim?.sprites)anim.sprites=anim.sprites.filter(x=>x.src!==old.value);
      }
      renderAssetManager();drawWorkplace();
    },'Delete');
  }
  function deleteMIDIAsset(asset){
    askConfirm('Delete MIDI',`Delete “${asset?.name||'MIDI'}”?`,()=>{const list=state.assets.MIDI,idx=list.findIndex(a=>a===asset||a.value===asset?.value);if(idx<0)return;list.splice(idx,1);renderAssetManager();},'Delete');
  }
  function saveSpriteFrames(oldAssets,frames){
    const old=Array.isArray(oldAssets)?oldAssets:[],list=state.assets.Sprite;
    frames.forEach((frame,i)=>{const source=old[i];if(source){replaceSpriteAsset(source,frame);}else addSpriteAsset(frame);});
    while(old.length>frames.length){const extra=old[old.length-1];const idx=list.findIndex(a=>a===extra);if(idx>=0)list.splice(idx,1);old.pop();}
    renderAssetManager();drawWorkplace();
  }

  function openAssetSelector(type,onSelect){state.assetSelection={type,onSelect};$('#assetSelectorTitle').textContent=`Select ${type}`;const host=$('#assetSelectorGrid');host.innerHTML='';const list=state.assets[type]||[];if(!list.length)host.append(Object.assign(document.createElement('div'),{className:'asset-empty',textContent:`No ${type.toLowerCase()} assets available.`}));list.forEach(asset=>{const b=document.createElement('button');b.className='asset-selector-item';const p=document.createElement('div');p.className='asset-selector-preview';if(type==='Sprite'){const img=document.createElement('img');img.src=asset.value;p.append(img);}else p.textContent='◉';const n=document.createElement('div');n.className='asset-selector-name';n.textContent=asset.name;b.append(p,n);b.onclick=()=>{const fn=state.assetSelection?.onSelect;state.assetSelection=null;closeModal();fn?.(asset);renderComponentPanel();drawWorkplace();};host.append(b);});showModal($('#assetSelectorModal'));}
  function importAssets(files){
    const accepted=[],rejected=[];
    [...files].forEach(file=>{
      const name=String(file?.name||''),typeName=String(file?.type||'').toLowerCase(),isMIDI=/\.(mid|midi)$/i.test(name)||typeName.includes('midi'),isAudio=typeName.startsWith('audio/')||/\.(mp3|wav|ogg|m4a|uixaudio)$/i.test(name),isImage=typeName.startsWith('image/')||/\.svg$/i.test(name);
      if(isImage||isAudio||isMIDI)accepted.push(file);else rejected.push(name||'Unnamed file');
    });
    if(rejected.length)status(`Rejected: ${rejected.join(', ')}. Only image or audio files are allowed.`);
    if(!accepted.length)return;
    Promise.all(accepted.map(fileToDataUrl)).then(results=>{results.forEach(({file,value})=>{const isMIDI=/\.(mid|midi)$/i.test(file.name)||/midi/i.test(file.type);const type=isMIDI?'MIDI':(file.type.startsWith('audio/')||/\.(mp3|wav|ogg|m4a|uixaudio)$/i.test(file.name))?'Audio':'Sprite';let stem=file.name.replace(/\.[^.]+$/,'');let name=stem;let i=2;while(state.assets[type].some(a=>a.name===name))name=`${stem} ${i++}`;state.assets[type].push({name,value,type:file.type|| (type==='MIDI'?'audio/midi':'application/octet-stream'),filename:file.name,kind:type==='Sprite' ? (/\.svg$/i.test(file.name)||file.type==='image/svg+xml' ? 'SVG' : 'Raster') : type,editable:type==='Sprite'||type==='MIDI'||/\.uixaudio$/i.test(file.name)});});renderAssetManager();status(`${accepted.length} asset${accepted.length===1?'':'s'} imported`);}).catch(()=>status('Could not import assets'));
  }
  function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({file,value:r.result});r.onerror=reject;r.readAsDataURL(file);});}

  // ---------------- Color ----------------
  function openColorModal(value,onChange,label){try{state.color={rgba:parseColor(value),onChange,label};$('#colorTargetLabel').textContent=label||'RGBA';syncColorUI();renderColorSliders();drawColorWheel();showModal($('#colorModal'));}catch{status('Invalid color');}}
  function renderColorSliders(){const host=$('#colorSliders');host.innerHTML='';[['R',0],['G',1],['B',2],['A',3]].forEach(([name,i])=>{const row=document.createElement('div');row.className='color-slider-row';const lab=document.createElement('label');lab.textContent=name;const input=document.createElement('input');input.type='range';input.min=0;input.max=255;input.value=Math.round(state.color.rgba[i]*255);const out=document.createElement('output');out.textContent=input.value;input.oninput=()=>{state.color.rgba[i]=Number(input.value)/255;out.textContent=input.value;syncColorUI();};row.append(lab,input,out);host.append(row);});}
  function syncColorUI(){const hex=rgbaToHex(state.color.rgba);$('#colorTextInput').value=hex;$('#colorHexPreview').textContent=hex;$('#colorPreview').style.background=rgbaCss(state.color.rgba);}
  function drawColorWheel(){const c=$('#colorWheel'),ctx=c.getContext('2d'),cx=130,cy=130,r=112;ctx.clearRect(0,0,c.width,c.height);for(let i=0;i<360;i++){const a=(i-90)*Math.PI/180;ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,r,a,a+Math.PI/180);ctx.closePath();ctx.fillStyle=`hsl(${i},100%,50%)`;ctx.fill();}ctx.globalCompositeOperation='destination-in';ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();ctx.globalCompositeOperation='source-over';ctx.strokeStyle='#707070';ctx.strokeRect(18,18,224,224);}
  function pickWheel(e){const wheel=$('#colorWheel');if(!wheel)return;const rect=wheel.getBoundingClientRect(),sx=260/Math.max(1,rect.width),sy=260/Math.max(1,rect.height),x=(e.clientX-rect.left)*sx-130,y=(e.clientY-rect.top)*sy-130,dist=Math.hypot(x,y);if(dist>112)return;const h=(Math.atan2(y,x)*180/Math.PI+360+90)%360,s=clamp(dist/112,0,1),rgb=hsvToRgb(h,s,.9);state.color.rgba=[rgb[0],rgb[1],rgb[2],state.color.rgba[3]];syncColorUI();}
  function hsvToRgb(h,s,v){const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let r=0,g=0,b=0;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return[r+m,g+m,b+m];}
  function applyColor(){try{const rgba=parseColor($('#colorTextInput').value);state.color.onChange(rgbaToHex(rgba));closeModal($('#colorModal'));renderComponentPanel();drawWorkplace();}catch{status('Invalid color value');}}
  function parseColor(v){let s=String(v||'').trim();if(/^#/.test(s)){let h=s.slice(1);if(h.length===3)h=h.split('').map(c=>c+c).join('');if(h.length===6)h+='ff';if(h.length!==8)throw Error();const n=parseInt(h,16);return[((n>>>24)&255)/255,((n>>>16)&255)/255,((n>>>8)&255)/255,(n&255)/255];}const m=s.match(/^rgba?\(([^)]+)\)$/i);if(m){const p=m[1].split(',').map(Number);return[(p[0]||0)/255,(p[1]||0)/255,(p[2]||0)/255,p[3]===undefined?1:(p[3]>1?p[3]/255:p[3])];}throw Error();}
  function rgbaToHex(a){return '#'+a.map(v=>Math.round(clamp(v,0,1)*255).toString(16).padStart(2,'0')).join('').toUpperCase();}
  function rgbaCss(a){return `rgba(${Math.round(a[0]*255)},${Math.round(a[1]*255)},${Math.round(a[2]*255)},${a[3]})`;}
  function colorCss(v,fallback){try{return rgbaCss(parseColor(v));}catch{return fallback;}}

  // ---------------- Animation Sprite ----------------
  function openAnimationEditor(node,comp){state.animationEdit={node,comp};renderAnimationEditor();showModal($('#spriteModal'));}
  function renderAnimationEditor(){const host=$('#spriteEditor');host.innerHTML='';const {comp}=state.animationEdit;host.append(field('Name',comp.name||'','text',v=>comp.name=v),field('FPS',comp.fps||8,'number',v=>comp.fps=Math.max(1,Number(v)||1)));(comp.sprites||[]).forEach((sprite,i)=>{const row=document.createElement('div');row.className='sprite-row';const label=document.createElement('div');label.className='sprite-row-label';label.textContent=`Sprite ${i+1}`;const btn=document.createElement('button');btn.className='asset-select-button';btn.textContent=sprite.name||'Edit';btn.onclick=()=>openAssetSelector('Sprite',a=>{sprite.name=a.name;sprite.src=a.value;renderAnimationEditor();drawWorkplace();});const del=document.createElement('button');del.className='mini-action danger';del.textContent='×';del.title='Delete Sprite';del.onclick=()=>{comp.sprites.splice(i,1);renderAnimationEditor();drawWorkplace();};row.append(label,btn,del);host.append(row);});const add=document.createElement('button');add.className='add-component-button';add.innerHTML='<span>＋</span>Add Sprite';add.onclick=()=>openAssetSelector('Sprite',a=>{comp.sprites.push({name:a.name,src:a.value});renderAnimationEditor();drawWorkplace();});host.append(add);}

  // ---------------- Script editor ----------------
  let resetScriptCanvasInteraction=null;
  function saveScriptViewport(){
    const id=state.script.nodeId;if(!id)return;
    if(!state.script.viewsByNode)state.script.viewsByNode=Object.create(null);
    const pan={x:Number(state.script.pan?.x)||0,y:Number(state.script.pan?.y)||0},zoom=Number(state.script.zoom);
    state.script.viewsByNode[id]={pan,zoom:Number.isFinite(zoom)?clamp(zoom,.25,4):1};
  }
  function openScriptEditor(node){
    resetScriptCanvasInteraction?.();
    saveScriptViewport();
    state.script.nodeId=node.id;state.script.selectedNodeId=null;state.script.selectedNodeIds=[];state.script.selectionAnchorId=null;
    const view=state.script.viewsByNode?.[node.id];
    state.script.pan={x:Number(view?.pan?.x)||0,y:Number(view?.pan?.y)||0};state.script.zoom=Number.isFinite(Number(view?.zoom))?clamp(Number(view.zoom),.25,4):1;
    state.script.nodesByNode[node.id] ||= [];state.script.connectionsByNode[node.id] ||= [];
    $('#scriptTarget').textContent=node.name;renderLocalVariables();renderScriptLibrary();renderScriptCanvas();renderScriptInspector();applyScriptPanelState();showModal($('#scriptModal'));setTimeout(()=>{applyScriptPanelState();resetScriptCanvasInteraction?.();renderScriptConnections();},0);
  }
  function renderLocalVariables(){
    const host=$('#localVariablesContent'); if(!host)return; host.innerHTML='';
    const vars=Array.isArray(state.localVarsByNode[state.script.nodeId]) ? state.localVarsByNode[state.script.nodeId] : (state.localVarsByNode[state.script.nodeId]=[]);
    const section=document.createElement('section'); section.className='local-variable-group';
    const head=document.createElement('button'); head.className='library-group-header';
    const body=document.createElement('div'); body.className='local-variable-body';
    const collapsed=!!state.ui.localVariablesCollapsed;
    body.classList.toggle('hidden',collapsed);
    head.innerHTML=`<span>${collapsed?'+':'−'}</span>Local Variables`;
    head.onclick=()=>{state.ui.localVariablesCollapsed=!state.ui.localVariablesCollapsed;body.classList.toggle('hidden',state.ui.localVariablesCollapsed);head.firstElementChild.textContent=state.ui.localVariablesCollapsed?'+':'−';};
    if(!vars.length) body.append(empty('No local variables yet.'));
    vars.forEach(v=>body.append(variableEditor(v,'Local')));
    const add=document.createElement('button'); add.className='add-component-button local-add-variable'; add.innerHTML='<span>＋</span>Add Variable'; add.onclick=()=>addVariable(false); body.append(add);
    section.append(head,body); host.append(section);
  }

  function renderScriptLibrary(){
    const host=$('#scriptNodeLibrary'); if(!host)return; host.innerHTML='';
    const groups={}; scriptNodes.forEach(n=>(groups[n.group] ||= []).push(n));
    ['Events','Actions','Controls'].forEach(group=>{
      const nodes=groups[group]||[];
      const section=document.createElement('section'); section.className='script-library-group';
      const head=document.createElement('button'); head.className='library-group-header';
      const body=document.createElement('div'); body.className='library-group-body';
      const collapsed=!!state.ui.scriptGroupCollapsed[group];
      body.classList.toggle('hidden',collapsed);
      head.innerHTML=`<span>${collapsed?'+':'−'}</span>${group}`;
      if(!nodes.length) body.append(Object.assign(document.createElement('div'),{className:'library-empty',textContent:'No ScriptNodes'}));
      nodes.forEach(def=>{
        const b=document.createElement('button'); b.className='library-node'; b.textContent=def.name; const enabled=scriptRequirementEnabled(def); b.draggable=enabled; b.classList.toggle('script-node-require-disabled',!enabled); b.setAttribute('aria-disabled',enabled?'false':'true'); b.title=enabled?def.name:`Requires ${def.require}`;
        b.addEventListener('click',()=>enabled?addScriptNode(def):showScriptRequirementPrompt(def));
        b.addEventListener('dragstart',e=>{if(!enabled){e.preventDefault();showScriptRequirementPrompt(def);return;}e.dataTransfer.setData('application/x-uix-script-node',def.name);e.dataTransfer.effectAllowed='copy';});
        body.append(b);
      });
      head.onclick=()=>{state.ui.scriptGroupCollapsed[group]=!state.ui.scriptGroupCollapsed[group];body.classList.toggle('hidden',state.ui.scriptGroupCollapsed[group]);head.firstElementChild.textContent=state.ui.scriptGroupCollapsed[group]?'+':'−';};
      section.append(head,body); host.append(section);
    });
  }

  function normalizeEditor(entry){
    if(Array.isArray(entry)) return entry.map(normalizeEditor);
    const e=entry && typeof entry==='object' ? {...entry} : {name:String(entry??''),type:'str',value:''};
    e.name=e.name ?? 'Value';
    e.type=String(e.type??'str').toLowerCase();
    if(!['str','bool','int','col','selector'].includes(e.type)) e.type='str';
    if(e.value===undefined){e.value=e.type==='bool'?false:e.type==='int'?0:e.type==='col'?'#FFFFFFFF':e.type==='selector'?(() => []):'';}
    return e;
  }
  function restoreSelectorDefinition(saved,template){
    if(Array.isArray(saved)){
      const t=Array.isArray(template)?template:[];
      return saved.map((entry,i)=>restoreSelectorDefinition(entry,t[i]));
    }
    if(!saved||typeof saved!=='object') return saved;
    const out={...saved};
    if(out.type==='selector'&&template&&typeof template==='object'){
      // JSON cannot serialize the selector option generator function. Restore the live
      // definition from scriptNodes.js while preserving the user's selected value.
      if(typeof template.value==='function' || Array.isArray(template.value)) out.value=template.value;
      if(!Object.prototype.hasOwnProperty.call(out,'selected') && Object.prototype.hasOwnProperty.call(template,'selected')) out.selected=clone(template.selected);
    }
    return out;
  }
  function restoreScriptNodeDefinitions(nodesByNode){
    const out=clone(nodesByNode||{});
    Object.keys(out).forEach(nodeId=>{
      if(!Array.isArray(out[nodeId])) return;
      out[nodeId].forEach(sn=>{
        const def=scriptNodeDefinition(sn?.defName);
        if(def&&Array.isArray(sn.values)) sn.values=restoreSelectorDefinition(sn.values,def.editor||[]);
      });
    });
    return out;
  }
  function cloneEditorDefinition(entries){
    if(Array.isArray(entries)) return entries.map(cloneEditorDefinition);
    if(!entries||typeof entries!=='object') return entries;
    const out={};Object.keys(entries).forEach(k=>{out[k]=typeof entries[k]==='function'?entries[k]:clone(entries[k]);});return out;
  }
  function scriptClientToWorld(clientX,clientY){
    const canvas=$('#scriptCanvas');
    if(!canvas)return{x:0,y:0};
    if(!Number.isFinite(state.script.pan.x))state.script.pan.x=0;
    if(!Number.isFinite(state.script.pan.y))state.script.pan.y=0;
    if(!Number.isFinite(state.script.zoom))state.script.zoom=1;
    const rect=canvas.getBoundingClientRect(),zoom=Math.max(.000001,state.script.zoom||1);
    return {x:((clientX-rect.left)-rect.width/2-state.script.pan.x)/zoom,y:((clientY-rect.top)-rect.height/2-state.script.pan.y)/zoom};
  }
  function updateScriptGrid(){
    const canvas=$('#scriptCanvas');if(!canvas)return;
    const zoom=Math.max(.25,Number(state.script.zoom)||1),size=32*zoom;
    canvas.style.setProperty('--script-grid-size',`${size}px`);
    canvas.style.setProperty('--script-grid-x',`${rectMod(state.script.pan.x,size)}px`);
    canvas.style.setProperty('--script-grid-y',`${rectMod(state.script.pan.y,size)}px`);
  }
  function rectMod(value,size){if(!size)return 0;const r=value%size;return r<0?r+size:r;}
  function addScriptNode(def){
    if(!def||!state.script.nodeId)return;
    if(!scriptRequirementEnabled(def)){showScriptRequirementPrompt(def);return null;}
    const canvas=$('#scriptCanvas');if(!canvas)return null;
    const rect=canvas.getBoundingClientRect(),point=scriptClientToWorld(rect.left+rect.width/2,rect.top+rect.height/2);
    const list=state.script.nodesByNode[state.script.nodeId] ||= [];
    const sn={id:`snode-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,defName:def.name,x:point.x,y:point.y,values:cloneEditorDefinition(def.editor||[]).map(normalizeEditor),expressions:{}};
    list.push(sn);renderScriptCanvas();status(`${def.name} ScriptNode added`);return sn;
  }
  function flattenEditor(entries,path='',out=[]){
    (Array.isArray(entries)?entries:[entries]).forEach((entry,i)=>{
      const next=path===''?String(i):`${path}.${i}`;
      if(Array.isArray(entry)) flattenEditor(entry,next,out); else if(entry&&typeof entry==='object') out.push({entry,path:next});
    });return out;
  }
  function scriptEditorValue(sn,item){
    if(Object.prototype.hasOwnProperty.call(sn.expressions,item.path)) return sn.expressions[item.path];
    if(item.entry.type==='selector') return Object.prototype.hasOwnProperty.call(item.entry,'selected') ? item.entry.selected : (evaluateSelector(item.entry.value)[0] ?? '');
    return item.entry.value;
  }
  function scriptEntryTypeForSetVariable(sn,item){
    if(sn?.defName!=='setVariable') return String(item.entry.type||'str').toLowerCase();
    if(item.entry.name!=='Value') return String(item.entry.type||'str').toLowerCase();
    const flat=flattenEditor(sn.values);
    const typeItem=flat.find(x=>x.entry.name==='Type');
    const nameItem=flat.find(x=>x.entry.name==='Name');
    const scope=String(typeItem?scriptEditorValue(sn,typeItem):'Global');
    const name=String(nameItem?scriptEditorValue(sn,nameItem):'');
    const variable=variableList(scope).find(v=>String(v.name)===name);
    if(variable?.dataType==='Bool') return 'bool';
    if(variable?.dataType==='Int') return 'int';
    if(variable?.dataType==='String') return 'str';
    return String(item.entry.type||'str').toLowerCase();
  }
  function syncSetVariableValueEditor(sn){
    if(sn?.defName!=='setVariable') return;
    const flat=flattenEditor(sn.values),typeItem=flat.find(x=>x.entry.name==='Type'),nameItem=flat.find(x=>x.entry.name==='Name'),valueItem=flat.find(x=>x.entry.name==='Value');
    if(!valueItem) return;
    const scope=String(typeItem?scriptEditorValue(sn,typeItem):'Global'),name=String(nameItem?scriptEditorValue(sn,nameItem):'');
    const variable=variableList(scope).find(v=>String(v.name)===name);
    const next=variable?.dataType==='Bool'?'bool':variable?.dataType==='Int'?'int':variable?.dataType==='String'?'str':'str';
    const prev=String(valueItem.entry.type||'str').toLowerCase();
    if(prev!==next){
      const old=valueItem.entry.value;
      if(old===null||old===undefined) valueItem.entry.value=null;
      else if(next==='bool') valueItem.entry.value=typeof old==='boolean'?old:['true','1','yes','on'].includes(String(old).toLowerCase());
      else if(next==='int'){const n=typeof old==='boolean'?(old?1:0):Number(old);valueItem.entry.value=Number.isFinite(n)?n:0;}
      else valueItem.entry.value=String(old);
      valueItem.entry.type=next;
      delete sn.expressions[valueItem.path];
    }
  }
  function openScriptInlineEdit(sn,item){
    const entry=item.entry,type=scriptEntryTypeForSetVariable(sn,item),wrap=document.createElement('div');wrap.className='script-inline-editor';
    const finish=(value,cancel=false)=>{if(cancel)return renderScriptCanvas();entry.value=value;delete sn.expressions[item.path];syncSetVariableValueEditor(sn);renderScriptCanvas();};
    if(type==='col'){
      openColorModal(String(entry.value||'#FFFFFFFF'),v=>{entry.value=v;delete sn.expressions[item.path];renderScriptCanvas();},entry.name);return;
    }
    if(type==='selector'){
      const options=evaluateSelector(entry.value);const select=customSelect(String(scriptEditorValue(sn,item)??''),options,v=>{entry.selected=v;delete sn.expressions[item.path];renderScriptCanvas();});return select;
    }
    if(type==='bool'){
      const current=entry.value===null||entry.value===undefined?'':(entry.value?'true':'false');
      const select=customSelect(current,['','true','false'],v=>finish(v===''?null:v==='true'));return select;
    }
    const input=document.createElement('input');input.className='script-inline-editor-input';input.type=type==='int'?'number':'text';input.value=String(scriptEditorValue(sn,item)??'');input.step='1';
    input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();finish(type==='int'?(Number(input.value)||0):input.value);}else if(e.key==='Escape'){e.preventDefault();finish('',true);}};
    input.onblur=()=>finish(type==='int'?(Number(input.value)||0):input.value);
    wrap.append(input);setTimeout(()=>{input.focus();input.select?.();},0);return wrap;
  }
  function scriptInputButton(sn,item){
    const entry=item.entry,isExpression=Object.prototype.hasOwnProperty.call(sn.expressions,item.path);
    let value=scriptEditorValue(sn,item);if(entry.type==='selector'&&!isExpression){
      let options=evaluateSelector(entry.value);
      if(sn.defName==='setVariable'&&entry.name==='Name'){
        const typeItem=flattenEditor(sn.values).find(x=>x.entry.name==='Type');
        const selectedType=String(typeItem?scriptEditorValue(sn,typeItem):'Global');
        options=variableList(selectedType).map(v=>v.name);
      }
      if(value!=='' && !options.includes(String(value))) { entry.selected=''; value=''; }
      const wrap=document.createElement('div');wrap.className='script-selector-wrap';
      const select=customSelect(String(value??''),options,choice=>{
        entry.selected=choice;delete sn.expressions[item.path];
        if(sn.defName==='setVariable'&&entry.name==='Type'){
          const nameItem=flattenEditor(sn.values).find(x=>x.entry.name==='Name');if(nameItem)nameItem.entry.selected='';
        }
        if(sn.defName==='setVariable'&&(entry.name==='Type'||entry.name==='Name')) syncSetVariableValueEditor(sn);
        renderScriptCanvas();
      });wrap.append(select);return wrap;
    }
    const b=document.createElement('button');b.type='button';b.className='script-input';
    const effectiveType=scriptEntryTypeForSetVariable(sn,item);
    let sliding=false,slideStartX=0,slideLastX=0,slideAccum=0,slideValue=0,slideStep=1;
    const decimalPlaces=n=>{const text=String(n??'');const m=text.toLowerCase().match(/(?:\.(\d+))?(?:e([+-]?\d+))?$/);if(!m)return 0;const decimals=(m[1]||'').length,exp=Number(m[2]||0);return Math.max(0,decimals-exp);};
    const calcStep=n=>{const d=decimalPlaces(n);return d>0?Math.pow(10,-d):1;};
    if(effectiveType==='int'&&!isExpression){
      let suppressClick=false;
      const begin=e=>{slideStartX=e.clientX;slideLastX=e.clientX;slideAccum=0;slideValue=Number(scriptEditorValue(sn,item));if(!Number.isFinite(slideValue))slideValue=0;slideStep=calcStep(slideValue);sliding=false;suppressClick=false;b.setPointerCapture?.(e.pointerId);};
      const move=e=>{if(e.pointerId==null)return;const dx=e.clientX-slideLastX;if(!sliding&&Math.abs(e.clientX-slideStartX)<8)return;if(Math.abs(e.clientX-slideStartX)>=8){sliding=true;suppressClick=true;e.preventDefault();e.stopPropagation();b.classList.add('sliding');}if(!sliding)return;slideAccum+=dx;const units=Math.trunc(slideAccum/20);if(units!==0){slideAccum-=units*20;slideValue+=units*slideStep;const places=decimalPlaces(slideStep);slideValue=places?Number(slideValue.toFixed(places)):Math.round(slideValue);entry.value=slideValue;delete sn.expressions[item.path];syncSetVariableValueEditor(sn);const label=b.querySelector('.script-input-value');if(label)label.textContent=String(slideValue);}slideLastX=e.clientX;};
      const end=()=>{if(sliding)b.classList.remove('sliding');sliding=false;};
      b.addEventListener('pointerdown',begin);b.addEventListener('pointermove',move);b.addEventListener('pointerup',end);b.addEventListener('pointercancel',end);b.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopPropagation();suppressClick=false;}});
    }
    if(isExpression){
      const label=document.createElement('span');label.className='script-input-value';label.textContent=String(value??'');
      const type=document.createElement('span');type.className='script-input-type';type.textContent='expr';b.append(label,type);
      b.addEventListener('click',e=>{e.stopPropagation();openExpressionEditor(sn,item.path,entry);});
    }else{
      if(effectiveType==='bool') value=entry.value===null||entry.value===undefined?'':!!entry.value;
      const label=document.createElement('span');label.className='script-input-value';label.textContent=value===null||value===undefined?'':String(value);
      const type=document.createElement('span');type.className='script-input-type';type.textContent=effectiveType;b.append(label,type);
      b.addEventListener('click',e=>{e.stopPropagation();const editor=openScriptInlineEdit(sn,item);if(editor){b.replaceWith(editor);}});
    }
    const showContext=(x,y)=>{showContextMenu([{label:'Expression',action:()=>openExpressionEditor(sn,item.path,entry)},{label:'Clear',action:()=>{delete sn.expressions[item.path];entry.value=null;if(Object.prototype.hasOwnProperty.call(entry,'selected'))entry.selected=null;renderScriptCanvas();}}],x,y);};
    b.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();showContext(e.clientX,e.clientY);});
    setupLongPress(b,e=>showContext(e.clientX,e.clientY));
    return b;
  }
  function renderScriptNodeCard(sn,def){
    const enabled=scriptRequirementEnabled(def);
    const card=document.createElement('article');card.className=`script-node-card${state.script.selectedNodeIds?.includes(sn.id)?' selected':''}${state.script.selectedNodeIds?.length>1&&state.script.selectedNodeIds.includes(sn.id)?' multi-selected':''}${enabled?'':' script-node-require-disabled'}`;card.dataset.scriptNodeId=sn.id;card.style.left=`${sn.x}px`;card.style.top=`${sn.y}px`;card.setAttribute('aria-disabled',enabled?'false':'true');card.title=enabled?'':`Requires ${def.require}`;
    if(!enabled)card.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();showScriptRequirementPrompt(def);},true);
    const title=document.createElement('div');title.className='script-node-title';title.textContent=def.name;card.append(title);
    if(def.receiver){const input=document.createElement('button');input.className='script-input-port';input.title='Input';input.addEventListener('click',e=>e.stopPropagation());card.append(input);}
    const fields=document.createElement('div');fields.className='script-editor-fields';
    flattenEditor(sn.values).forEach(item=>{const row=document.createElement('div');row.className='script-editor-row';const label=document.createElement('div');label.className='script-editor-label';label.textContent=item.entry.name;row.append(label,scriptInputButton(sn,item));fields.append(row);});
    if(fields.children.length)card.append(fields);
    const outputs=document.createElement('div');outputs.className='script-output-list';(Array.isArray(def.output)?def.output:[]).forEach(out=>{const row=document.createElement('div');row.className='script-output';const label=document.createElement('span');label.textContent=out.id;const port=document.createElement('button');port.className='script-output-port';port.dataset.outputId=out.id;port.title=`Output ${out.id}`;if(out.col)port.style.background=out.col;attachOutputDrag(port);row.append(label,port);outputs.append(row);});if(outputs.children.length)card.append(outputs);
    card.addEventListener('click',e=>{if(e.target.closest('.script-input,.script-input-port,.script-output-port'))return;selectScriptNode(sn,e);renderScriptCanvas();});
    card.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();scriptContextMenu(sn,e.clientX,e.clientY);});
    attachScriptDrag(card,sn);return card;
  }
  function deleteScriptNodeNow(id){
    const list=state.script.nodesByNode[state.script.nodeId]||[];
    const target=list.find(n=>n.id===id);
    state.script.nodesByNode[state.script.nodeId]=list.filter(n=>n.id!==id);
    const con=state.script.connectionsByNode[state.script.nodeId]||[];
    state.script.connectionsByNode[state.script.nodeId]=con.filter(c=>c.from!==id&&c.to!==id);
    state.script.selectedNodeIds=(state.script.selectedNodeIds||[]).filter(x=>x!==id);if(state.script.selectedNodeId===id)state.script.selectedNodeId=state.script.selectedNodeIds.at(-1)||null;
    renderScriptCanvas(); status(`${target?.defName||'ScriptNode'} removed`);
  }
  function removeScriptNode(id){
    const list=state.script.nodesByNode[state.script.nodeId]||[];
    const target=list.find(n=>n.id===id);
    if(!target)return;
    const def=scriptNodeDefinition(target.defName);
    askConfirm('Delete ScriptNode',`Delete “${def?.name||target.defName}”?`,()=>deleteScriptNodeNow(id));
  }
  function iconSvg(name){
    const map={
      Snap:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v4M3 7h4M17 21v-4M21 17h-4M8 8l8 8M16 8l-8 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
      Disconnect:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12h8M9 7 6 4M15 17l3 3M5 7l2 2M17 15l2 2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
      Delete:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };
    return map[name]||'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor"/></svg>';
  }

  function scriptList(){return state.script.nodeId?(state.script.nodesByNode[state.script.nodeId]||[]):[];}
  function selectScriptNode(sn,e={}){
    const list=scriptList(),ids=list.map(x=>x.id),set=new Set(state.script.selectedNodeIds||[]);
    if(e.shiftKey&&state.script.selectionAnchorId&&ids.includes(state.script.selectionAnchorId)){const a=ids.indexOf(state.script.selectionAnchorId),b=ids.indexOf(sn.id),lo=Math.min(a,b),hi=Math.max(a,b);state.script.selectedNodeIds=ids.slice(lo,hi+1);}
    else if(e.ctrlKey||e.metaKey){if(set.has(sn.id))set.delete(sn.id);else set.add(sn.id);state.script.selectedNodeIds=list.filter(x=>set.has(x.id)).map(x=>x.id);if(!state.script.selectedNodeIds.length)state.script.selectedNodeIds=[sn.id];}
    else state.script.selectedNodeIds=[sn.id];
    state.script.selectionAnchorId=sn.id;state.script.selectedNodeId=state.script.selectedNodeIds.at(-1)||null;
  }
  function selectedScriptNodes(){const set=new Set(state.script.selectedNodeIds||[]);return scriptList().filter(x=>set.has(x.id));}
  function copyScriptNodes(){const nodes=selectedScriptNodes();if(!nodes.length)return status('Nothing selected to copy');const set=new Set(nodes.map(n=>n.id));const con=(state.script.connectionsByNode[state.script.nodeId]||[]).filter(c=>set.has(c.from)&&set.has(c.to));state.script.clipboard={nodes:clone(nodes),connections:clone(con)};status(nodes.length===1?`${nodes[0].defName} copied`:`${nodes.length} ScriptNodes copied`);}
  function cutScriptNodes(){const nodes=selectedScriptNodes();if(!nodes.length)return status('Nothing selected to cut');copyScriptNodes();requestDeleteScriptNodes(nodes.map(n=>n.id),'Cut');}
  function pasteScriptNodes(){const clip=state.script.clipboard;if(!clip?.nodes?.length)return status('Nothing to paste');const list=scriptList(),map=new Map();pushHistory();const pasted=clone(clip.nodes);pasted.forEach(sn=>{const old=sn.id;sn.id=`snode-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;sn.x=Number(sn.x||0)+24;sn.y=Number(sn.y||0)+24;map.set(old,sn.id);list.push(sn);});const con=(clip.connections||[]).map(c=>({...c,from:map.get(c.from),to:map.get(c.to)})).filter(c=>c.from&&c.to);state.script.connectionsByNode[state.script.nodeId]=(state.script.connectionsByNode[state.script.nodeId]||[]).concat(con);state.script.selectedNodeIds=pasted.map(x=>x.id);state.script.selectedNodeId=pasted.at(-1)?.id||null;state.script.selectionAnchorId=state.script.selectedNodeId;renderScriptCanvas();status(`${pasted.length} ScriptNodes pasted`);}
  function deleteScriptNodesNow(ids){const set=new Set(ids||[]);if(!set.size)return;const list=scriptList();state.script.nodesByNode[state.script.nodeId]=list.filter(sn=>!set.has(sn.id));state.script.connectionsByNode[state.script.nodeId]=(state.script.connectionsByNode[state.script.nodeId]||[]).filter(c=>!set.has(c.from)&&!set.has(c.to));state.script.selectedNodeIds=(state.script.selectedNodeIds||[]).filter(id=>!set.has(id));state.script.selectedNodeId=state.script.selectedNodeIds.at(-1)||null;renderScriptCanvas();status(`${set.size} ScriptNode${set.size===1?'':'s'} deleted`);}
  function requestDeleteScriptNodes(ids,action='Delete'){const set=new Set(ids||[]);if(!set.size)return;const targets=scriptList().filter(sn=>set.has(sn.id));if(!targets.length)return;const names=targets.map(sn=>{const d=scriptNodeDefinition(sn.defName);return d?.name||sn.defName||'ScriptNode';});const label=names.length===1?`“${names[0]}”`:`${names.length} selected ScriptNodes`;askConfirm(action==='Cut'?'Cut ScriptNodes':'Delete ScriptNodes',`${action==='Cut'?'Cut':'Delete'} ${label}?`,()=>deleteScriptNodesNow([...set]),action);}
  function disconnectScriptNode(id){const con=state.script.connectionsByNode[state.script.nodeId]||[];state.script.connectionsByNode[state.script.nodeId]=con.filter(c=>c.from!==id&&c.to!==id);renderScriptCanvas();status('ScriptNode disconnected');}
  function scriptContextMenu(sn,x,y){selectScriptNode(sn,{shiftKey:false,ctrlKey:false,metaKey:false});renderScriptCanvas();const many=selectedScriptNodes().length>1;const selected=selectedScriptNodes();showContextMenu([{label:`${selected.length} selected`,icon:'☷',disabled:!many},{label:'Cut',icon:'✂',shortcut:window.UIXKeyBinds?.shortcutFor('cut','script'),action:()=>cutScriptNodes()},{label:'Copy',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('copy','script'),action:()=>copyScriptNodes()},{label:'Paste',icon:'▣',shortcut:window.UIXKeyBinds?.shortcutFor('paste','script'),disabled:!state.script.clipboard,action:()=>pasteScriptNodes()},{label:'Duplicate',icon:'⧉',shortcut:window.UIXKeyBinds?.shortcutFor('duplicate','script'),action:()=>{copyScriptNodes();pasteScriptNodes();}},{label:'Snap',icon:'⌖',shortcut:window.UIXKeyBinds?.shortcutFor('snap','script'),action:()=>snapScriptToNode(sn)},{label:'Disconnect',icon:'↔',action:()=>disconnectScriptNode(sn.id)},{label:'Delete',icon:'×',shortcut:window.UIXKeyBinds?.shortcutFor('delete','script'),action:()=>requestDeleteScriptNodes(selectedScriptNodes().map(x=>x.id))},{label:'Select All',icon:'☷',shortcut:window.UIXKeyBinds?.shortcutFor('selectAll','script'),action:()=>{state.script.selectedNodeIds=scriptList().map(x=>x.id);state.script.selectedNodeId=state.script.selectedNodeIds.at(-1)||null;renderScriptCanvas();}}],x,y);}
  function applyScriptPanelState(){
    const layout=$('#scriptModal .script-layout'),left=$('#scriptModal .script-left'),right=$('#scriptInspector');
    if(!layout||!left||!right)return;
    const lw=clamp(Number(state.script.panelWidths?.left)||260,120,420);
    const rw=clamp(Number(state.script.panelWidths?.right)||250,160,420);
    state.script.panelWidths={left:lw,right:rw};
    left.classList.toggle('script-panel-collapsed',!!state.script.leftCollapsed);
    right.classList.toggle('script-panel-collapsed',!!state.script.rightCollapsed);
    const lc=!!state.script.leftCollapsed,rc=!!state.script.rightCollapsed;
    layout.style.setProperty('--script-left-width',`${lc?34:lw}px`);
    layout.style.setProperty('--script-right-width',`${rc?34:rw}px`);
    const lb=$('[data-script-panel-collapse="left"]',left),rb=$('[data-script-panel-collapse="right"]',right);
    if(lb){lb.textContent=lc?'›':'‹';lb.title=lc?'Expand':'Collapse';}
    if(rb){rb.textContent=rc?'‹':'›';rb.title=rc?'Expand':'Collapse';}
  }
  function enableScriptPanelControls(){
    const modal=$('#scriptModal');if(!modal||modal.dataset.scriptPanelControls==='1')return;
    modal.dataset.scriptPanelControls='1';
    let active=null;
    modal.addEventListener('click',e=>{const b=e.target.closest('[data-script-panel-collapse]');if(!b)return;e.preventDefault();e.stopPropagation();if(b.dataset.scriptPanelCollapse==='left')state.script.leftCollapsed=!state.script.leftCollapsed;else state.script.rightCollapsed=!state.script.rightCollapsed;applyScriptPanelState();requestAnimationFrame(renderScriptConnections);});
    modal.addEventListener('pointerdown',e=>{const h=e.target.closest('[data-resize-script-panel]');if(!h)return;if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();e.stopPropagation();const side=h.dataset.resizeScriptPanel;active={side,startX:e.clientX,left:Number(state.script.panelWidths.left)||260,right:Number(state.script.panelWidths.right)||250,pointerId:e.pointerId};h.setPointerCapture?.(e.pointerId);document.documentElement.classList.add('resizing-panels');});
    const move=e=>{if(!active||e.pointerId!==active.pointerId)return;e.preventDefault();if(active.side==='left')state.script.panelWidths.left=clamp(active.left+e.clientX-active.startX,120,420);else state.script.panelWidths.right=clamp(active.right-(e.clientX-active.startX),160,420);applyScriptPanelState();renderScriptConnections();};
    const end=e=>{if(!active)return;if(e?.pointerId!=null&&e.pointerId!==active.pointerId)return;active=null;document.documentElement.classList.remove('resizing-panels');};
    document.addEventListener('pointermove',move,{passive:false});document.addEventListener('pointerup',end);document.addEventListener('pointercancel',end);
  }

  function renderScriptInspector(){
    const host=$('#scriptInspector');
    if(!host)return;
    host.innerHTML='';
    const resize=document.createElement('div');
    resize.className='script-panel-resize script-panel-resize-right';
    resize.dataset.resizeScriptPanel='right';
    const header=document.createElement('div');
    header.className='script-panel-header';
    const heading=document.createElement('div');
    heading.className='script-panel-heading';
    const strong=document.createElement('strong');
    strong.textContent='Script Inspector';
    const sub=document.createElement('span');
    sub.textContent='ScriptNodes in this script';
    heading.append(strong,sub);
    const collapse=document.createElement('button');
    collapse.type='button';collapse.className='script-panel-collapse';collapse.dataset.scriptPanelCollapse='right';
    collapse.title=state.script.rightCollapsed?'Expand':'Collapse';collapse.textContent=state.script.rightCollapsed?'‹':'›';
    header.append(heading,collapse);
    host.append(resize,header);
    host.classList.toggle('script-panel-collapsed',!!state.script.rightCollapsed);
    const list=document.createElement('div');
    list.className='script-inspector-list';
    const nodes=state.script.nodeId?(state.script.nodesByNode[state.script.nodeId]||[]):[];
    if(!nodes.length){
      const empty=document.createElement('div');
      empty.className='script-inspector-empty';
      empty.textContent='No ScriptNodes added yet.';
      list.append(empty);
    }
    const disconnectNode=id=>{
      const con=state.script.connectionsByNode[state.script.nodeId]||[];
      state.script.connectionsByNode[state.script.nodeId]=con.filter(c=>c.from!==id&&c.to!==id);
      renderScriptCanvas();
      status('ScriptNode disconnected');
    };
    const snapNode=sn=>{
      const canvas=$('#scriptCanvas');
      if(!canvas)return;
      snapScriptToNode(sn);
    };
    nodes.forEach(sn=>{
      const def=scriptNodes.find(x=>x.name===sn.defName);
      if(!def)return;
      const row=document.createElement('div');
      row.className=`script-inspector-row${state.script.selectedNodeIds?.includes(sn.id)?' selected':''}${state.script.selectedNodeIds?.length>1&&state.script.selectedNodeIds.includes(sn.id)?' multi-selected':''}`;
      const name=document.createElement('button');
      name.type='button';
      name.className='script-inspector-name';
      name.textContent=def.name;
      name.title=def.name;
      name.addEventListener('click',e=>{selectScriptNode(sn,e);renderScriptCanvas();});
      const actions=document.createElement('div');
      actions.className='script-inspector-actions';
      const makeIcon=(title,src,fn,cls='icon-action')=>{
        const b=document.createElement('button'); b.type='button'; b.className=cls; b.title=title;
        const img=document.createElement('img'); img.src=`./${src.replace(/^\.\//,'')}`; img.alt='';
        img.onerror=()=>{ img.remove(); b.insertAdjacentHTML('afterbegin', iconSvg(title)); };
        b.append(img); b.addEventListener('click',e=>{e.stopPropagation();fn();}); return b;
      };
      actions.append(
        makeIcon('Snap','svgIcons/snap.svg',()=>snapNode(sn)),
        makeIcon('Disconnect','svgIcons/disconnect.svg',()=>disconnectNode(sn.id)),
        makeIcon('Delete','svgIcons/delete.svg',()=>removeScriptNode(sn.id))
      );
      row.append(name,actions);
      row.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();scriptContextMenu(sn,e.clientX,e.clientY);});
      setupLongPress(row,e=>{e.stopPropagation();scriptContextMenu(sn,e.clientX,e.clientY);});
      list.append(row);
    });
    host.append(list);
    applyScriptPanelState();
  }

  function renderScriptCanvas(){
    const host=$('#scriptCanvasWorld');if(!host)return;host.innerHTML='';
    const list=state.script.nodesByNode[state.script.nodeId]||[];
    list.forEach(sn=>{const def=scriptNodes.find(x=>x.name===sn.defName);if(def)host.append(renderScriptNodeCard(sn,def));});
    renderScriptInspector();
    applyScriptTransform();requestAnimationFrame(renderScriptConnections);
  }
  function snapScriptToNode(sn){const canvas=$('#scriptCanvas');if(!canvas||!sn)return;state.script.pan.x=-sn.x*state.script.zoom;state.script.pan.y=-sn.y*state.script.zoom;state.script.selectedNodeId=sn.id;if(!state.script.selectedNodeIds.includes(sn.id))state.script.selectedNodeIds=[sn.id];state.script.selectionAnchorId=sn.id;applyScriptTransform();renderScriptCanvas();status(`Snapped to ${sn.defName}`);}
  function applyScriptTransform(){
    const world=$('#scriptCanvasWorld');if(!world)return;
    world.style.transform=`translate(${state.script.pan.x}px,${state.script.pan.y}px) scale(${state.script.zoom})`;
    updateScriptGrid();
    const label=$('#scriptZoomLabel');if(label)label.textContent=`${Math.round(state.script.zoom*100)}%`;
    requestAnimationFrame(renderScriptConnections);
  }
  function openExpressionEditor(sn,path,entry){
    state.script.editingInput={sn,path,entry};
    $('#expressionTitle').textContent=entry.name||'Input';
    let value=Object.prototype.hasOwnProperty.call(sn.expressions,path)?String(sn.expressions[path]??''):String(entry.value??'');
    // String literal fallback is intentionally applied ONLY when the expression editor opens.
    // After opening, typing is never rewritten automatically.
    if(String(entry?.type||'').toLowerCase()==='str' && value.trim()){
      try{inferExpressionValue(value);}
      catch{if(!(value.startsWith('`')&&value.endsWith('`'))) value='`'+value.replace(/`/g,'\\`')+'`';}
    }
    $('#expressionInput').value=value;
    if(Object.prototype.hasOwnProperty.call(sn.expressions,path)) sn.expressions[path]=value;
    renderExpressionLibrary();
    validateExpression();
    showModal($('#expressionModal'));
    setTimeout(()=>$('#expressionInput')?.focus(),0);
  }
  function inferExpressionValue(source){return Function('ctx','Math','"use strict";return ('+source+');')(expressionContext(),Math);}
  function expressionTypeError(entry,value){
    const type=String(entry?.type||'str').toLowerCase();
    if(type==='str') return null;
    if(value===null)return null;
    if(type==='int') return typeof value==='number'&&Number.isFinite(value)?null:'Expected an int expression (the evaluated result must be a number).';
    if(type==='bool') return typeof value==='boolean'?null:'Expected a bool expression (the evaluated result must be true or false).';
    if(type==='col'){if(typeof value!=='string')return 'Expected a color string.';try{parseColor(value);return null;}catch{return 'Expected a valid RGBA/hex color string.';}}
    if(type==='selector'){if(typeof value!=='string')return 'Expected a selector value (string).';const options=evaluateSelector(entry.value);if(options.length&&!options.includes(value))return 'Value is not one of the selector options.';return null;}
    return null;
  }
  function coerceExpressionValue(entry,value){const type=String(entry?.type||'str').toLowerCase();if(type==='str')return String(value??'');if(type==='int')return Number(value);if(type==='bool')return !!value;if(type==='col')return String(value);if(type==='selector')return String(value);return value;}
  function validateExpression(){
    const input=$('#expressionInput'),error=$('#expressionError'),save=$('#expressionModal [data-action="apply-expression"]');
    if(!input||!error)return true;const source=input.value.trim();let message='No error.';const edit=state.script.editingInput;
    if(source){
      try{
        const value=inferExpressionValue(source);
        const pathRegex=/\bctx\.(local|global|sceneVariables)\.([A-Za-z_$][\w$]*)/g;let m;
        while((m=pathRegex.exec(source))){const list=m[1]==='local'?(state.localVarsByNode[state.script.nodeId]||[]):m[1]==='global'?state.globalVariables:sceneVariableList();if(!list.some(v=>v.name===m[2])){message=String(edit?.entry?.type||'').toLowerCase()==='str'?'String literal fallback will be used.':`Undefined variable: ${m[2]}`;break;}}
        if(message==='No error.'&&edit){const typeError=expressionTypeError(edit.entry,value);if(typeError)message=typeError;}
      }catch(err){
        const isString=String(edit?.entry?.type||'').toLowerCase()==='str';
        if(isString){message='String literal fallback will be used.';}else message=String(err?.message||'Syntax Error');
      }
    }
    const valid=message==='No error.'||message==='String literal fallback will be used.';error.textContent=message;error.classList.toggle('valid',valid);if(save)save.disabled=!valid;return valid;
  }
  function applyExpression(){
    if(!validateExpression())return status('Fix the expression error first');
    const edit=state.script.editingInput;if(!edit)return;
    const value=$('#expressionInput').value.trim();
    if(value&&value!==String(edit.entry.value??''))edit.sn.expressions[edit.path]=value;else delete edit.sn.expressions[edit.path];
    state.script.editingInput=null;closeModal($('#expressionModal'));renderScriptCanvas();
  }
  function clearExpression(){
    const edit=state.script.editingInput;if(edit)delete edit.sn.expressions[edit.path];
    if(edit)$('#expressionInput').value=String(edit.entry.value??'');
    validateExpression();renderScriptCanvas();
  }

  function renderExpressionLibraryInto(host){
    if(!host) return; host.innerHTML='';
    const groups=expressionGroups();
    Object.entries(groups).forEach(([name,items])=>{
      if(!Object.prototype.hasOwnProperty.call(state.ui.expressionGroupCollapsed,name)) state.ui.expressionGroupCollapsed[name]=true;
      const sec=document.createElement('section'); sec.className='helper-group';
      const h=document.createElement('button'); h.className='library-group-header';
      const body=document.createElement('div'); body.className='helper-body';
      const collapsed=!!state.ui.expressionGroupCollapsed[name];
      body.classList.toggle('hidden',collapsed);
      h.innerHTML=`<span>${collapsed?'+':'−'}</span>${name}`;
      if(!items.length) body.append(Object.assign(document.createElement('div'),{className:'library-empty',textContent:'No items'}));
      items.forEach(item=>{const b=document.createElement('button');b.className='helper-item';b.textContent=item.label;b.title=item.title||`Insert ${item.label}`;b.onclick=e=>{e.stopPropagation();insertExpression(item.value);};body.append(b);});
      h.onclick=e=>{e.stopPropagation();state.ui.expressionGroupCollapsed[name]=!state.ui.expressionGroupCollapsed[name];body.classList.toggle('hidden',state.ui.expressionGroupCollapsed[name]);h.firstElementChild.textContent=state.ui.expressionGroupCollapsed[name]?'+':'−';};
      sec.append(h,body); host.append(sec);
    });
  }
  function renderExpressionLibrary(){ renderExpressionLibraryInto($('#expressionSideLibrary')); }
  function renderExpressionSideLibrary(){ renderExpressionLibraryInto($('#expressionSideLibrary')); }
  function insertExpressionByLabel(label){const found=Object.values(expressionGroups()).flat().find(x=>x.label===label);if(found)insertExpression(found.value);}
  function insertExpression(value){const input=$('#expressionInput');const start=input.selectionStart??input.value.length;const end=input.selectionEnd??start;input.value=input.value.slice(0,start)+value+input.value.slice(end);input.focus();input.selectionStart=input.selectionEnd=start+value.length;validateExpression();}
  function evaluateSelector(fn){try{const ctx=expressionContext();const value=typeof fn==='function'?fn(ctx):Array.isArray(fn)?fn:[];return Array.isArray(value)?value.map(v=>String(v)):[];}catch{return [];}}
  function expressionContext(){
    const node=selectedNode(),sceneVars=sceneVariableList(),body=runtimeBodyForNode(node);
    const keybinds=keybindOptions();
    const velocity={velocityX:Number(body?.vx)||0,velocityY:Number(body?.vy)||0,angularVelocity:Number(body?.omega||0)*180/Math.PI,x:Number(body?.vx)||0,y:Number(body?.vy)||0,vx:Number(body?.vx)||0,vy:Number(body?.vy)||0,omega:Number(body?.omega)||0,angularX:Number(body?.omega||0)*180/Math.PI};
    return {
      local:Object.fromEntries((state.localVarsByNode[state.script.nodeId]||[]).map(v=>[v.name,v.value])),
      global:Object.fromEntries(state.globalVariables.map(v=>[v.name,v.value])),
      sceneVariables:Object.fromEntries(sceneVars.map(v=>[v.name,v.value])),
      variableNames:(state.globalVariables||[]).map(v=>v.name),
      sceneVariableNames:sceneVars.map(v=>v.name),
      localVariableNames:(state.localVarsByNode[state.script.nodeId]||[]).map(v=>v.name),
      transform:node?component(node,'transform')||{}:{},
      velocity,
      velocityX:velocity.velocityX,velocityY:velocity.velocityY,angularVelocity:velocity.angularVelocity,
      text:node?component(node,'text')||{}:{},
      sceneData:currentScene(),sceneList:state.scenes,
      audioAssets:[...(state.assets.Audio||[]), ...(state.assets.MIDI||[])],midiAssets:state.assets.MIDI||[],spriteAssets:state.assets.Sprite||[],
      allNodes:allNodes().map(x=>x.node),
      folderOptions:allNodes().filter(x=>x.node?.type==='folder').map(x=>`${x.node.name} [${x.node.numericId}]`),
      animations:(component(node,'animationsprite')?.animations||[]),
      inputs:state.runtime?.inputs||{},keybinds,events:{key:Object.fromEntries(keybindOptions().map(k=>[k,false]))},mic:{decibel:-100,speech:'',active:false,speechActive:false},node,
      TouchUpX:Number(state.runtime?.inputs?.TouchUpX)||0,TouchUpY:Number(state.runtime?.inputs?.TouchUpY)||0,
      TouchDownX:Number(state.runtime?.inputs?.TouchDownX)||0,TouchDownY:Number(state.runtime?.inputs?.TouchDownY)||0,
      TouchMoveX:Number(state.runtime?.inputs?.TouchMoveX)||0,TouchMoveY:Number(state.runtime?.inputs?.TouchMoveY)||0,
      MouseUpX:Number(state.runtime?.inputs?.MouseUpX)||0,MouseUpY:Number(state.runtime?.inputs?.MouseUpY)||0,
      MouseDownX:Number(state.runtime?.inputs?.MouseDownX)||0,MouseDownY:Number(state.runtime?.inputs?.MouseDownY)||0,
      MouseMoveX:Number(state.runtime?.inputs?.MouseMoveX)||0,MouseMoveY:Number(state.runtime?.inputs?.MouseMoveY)||0,
      ScreenUpX:Number(state.runtime?.inputs?.ScreenUpX)||0,ScreenUpY:Number(state.runtime?.inputs?.ScreenUpY)||0,
      ScreenDownX:Number(state.runtime?.inputs?.ScreenDownX)||0,ScreenDownY:Number(state.runtime?.inputs?.ScreenDownY)||0,
      ScreenMoveX:Number(state.runtime?.inputs?.ScreenMoveX)||0,ScreenMoveY:Number(state.runtime?.inputs?.ScreenMoveY)||0,
      joystick:Object.fromEntries((state.runtime?.joysticks||sceneJoysticks()).map(st=>[st.variable,{distance:Number(st.distance)||0,angle:Number(st.angle)||0,value_x:Number(st.value_x)||0,value_y:Number(st.value_y)||0}])),
      joysticksList: sceneJoysticks().map(j=>({variable:j.variable})),
      ...Object.fromEntries(sceneJoysticks().flatMap(j=>{const base=j.variable||'joystick';const r=(state.runtime?.joysticks||[]).find(x=>x.variable===base)||{};return [[`${base}_distance`,Number(r.distance)||0],[`${base}_angle`,Number(r.angle)||0],[`${base}_value_x`,Number(r.value_x)||0],[`${base}_value_y`,Number(r.value_y)||0]];}))
    };
  }
  function expressionGroups(){
    const node=selectedNode();
    const customMath=[
      ['lerp','a, b, t'],['clamp','value, min, max'],['map','value, inMin, inMax, outMin, outMax'],
      ['moveTowards','current, target, maxDelta'],['smoothstep','edge0, edge1, x'],['wrap','value, min, max'],
      ['degToRad','degrees'],['radToDeg','radians'],['distance','a, b'],['pow','base, exponent'],
      ['min','a, b, ...values'],['max','a, b, ...values'],['abs','value'],['sign','value'],
      ['floor','value'],['ceil','value'],['round','value'],['trunc','value'],['sqrt','value'],['cbrt','value'],
      ['exp','value'],['log','value'],['log10','value'],['sin','radians'],['cos','radians'],['tan','radians'],
      ['asin','value'],['acos','value'],['atan','value'],['atan2','y, x'],['hypot','a, b, ...values'],
      ['randInt','min, max'],['random',''],['PI',null],['E',null]
    ].map(([name,args])=>({
      label:`Math.${name}${args===null?'':'('+args+')'}`,
      value:args===null?`Math.${name}`:`Math.${name}(${args||''})`,
      title:args===null?`Math.${name}`:`Parameters: ${args}`
    }));
    const list={
      localVariables:(state.localVarsByNode[state.script.nodeId]||[]).map(v=>({label:v.name,value:`ctx.local.${v.name}`})),
      sceneVariables:sceneVariableList().map(v=>({label:v.name,value:`ctx.sceneVariables.${v.name}`})),
      globalVariables:state.globalVariables.map(v=>({label:v.name,value:`ctx.global.${v.name}`})),
      Events:keybindOptions().map(k=>({label:k,value:/^\d$/.test(k)?`ctx.events.key[\"${k}\"]`:`ctx.events.key.${k}`})),
      Touch:['UpX','UpY','DownX','DownY','MoveX','MoveY'].map(k=>({label:`Touch${k}`,value:`ctx.Touch${k}`})),
      Mouse:['UpX','UpY','DownX','DownY','MoveX','MoveY'].map(k=>({label:`Mouse${k}`,value:`ctx.Mouse${k}`})),
      'Screen Input':['UpX','UpY','DownX','DownY','MoveX','MoveY'].map(k=>({label:`Screen${k}`,value:`ctx.Screen${k}`})),
      Joystick:sceneJoysticks().flatMap(st=>{const base=st.variable||'joystick';return [{label:`${base}_distance`,value:`ctx.${base}_distance`},{label:`${base}_angle`,value:`ctx.${base}_angle`},{label:`${base}_value_x`,value:`ctx.${base}_value_x`},{label:`${base}_value_y`,value:`ctx.${base}_value_y`}];}),
      Mic:[{label:'decibel',value:'ctx.mic.decibel',title:'Current microphone level in decibels'},{label:'speech',value:'ctx.mic.speech',title:'Live speech-recognition text'},{label:'active',value:'ctx.mic.active',title:'Whether the microphone is active'},{label:'speechActive',value:'ctx.mic.speechActive',title:'Whether speech recognition is running'}],
      transforms:[{label:'Position X',value:'ctx.transform.position[0]'},{label:'Position Y',value:'ctx.transform.position[1]'},{label:'Scale X',value:'ctx.transform.scale[0]'},{label:'Scale Y',value:'ctx.transform.scale[1]'},{label:'Angle',value:'ctx.transform.angle[0]'}],
      Velocity:[{label:'VelocityX',value:'ctx.velocity.velocityX'},{label:'VelocityY',value:'ctx.velocity.velocityY'},{label:'AngularVelocity',value:'ctx.velocity.angularVelocity'}],
      Math:customMath,
      Vectors:[
        {label:'vec2(x, y)',value:'[x, y]',title:'Parameters: x, y'},
        {label:'length(v)',value:'Math.hypot(v[0], v[1])',title:'Parameter: v'},
        {label:'dot(a, b)',value:'a[0]*b[0]+a[1]*b[1]',title:'Parameters: a, b'},
        {label:'normalize(v)',value:'[v[0]/Math.max(1e-9,Math.hypot(v[0],v[1])),v[1]/Math.max(1e-9,Math.hypot(v[0],v[1]))]',title:'Parameter: v'}
      ]
    };
    if(node&&component(node,'text'))list.Text=[{label:'Text Value',value:'ctx.text.txt'},{label:'Font Size',value:'ctx.text.fontSize'},{label:'Font Family',value:'ctx.text.fontFamily'}];
    if(node&&component(node,'sprite'))list.Sprite=[{label:'Sprite Name',value:'ctx.sprite.name'},{label:'Sprite Source',value:'ctx.sprite.src'}];
    if(node&&component(node,'animationsprite'))list.Animation=[{label:'Animation Name',value:'ctx.animations'}];
    if(node&&component(node,'progressbar'))list['Progress Bar']=[{label:'Value',value:'ctx.progressBar.value'},{label:'Min',value:'ctx.progressBar.min'},{label:'Max',value:'ctx.progressBar.max'},{label:'Width',value:'ctx.progressBar.width'},{label:'Height',value:'ctx.progressBar.height'},{label:'Position X',value:'ctx.progressBar.position[0]'},{label:'Position Y',value:'ctx.progressBar.position[1]'}];
    return list;
  }
  function attachScriptDrag(card,sn){card.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;const canvas=$('#scriptCanvas');const start={x:e.clientX,y:e.clientY,sx:sn.x,sy:sn.y};card.setPointerCapture?.(e.pointerId);function move(ev){sn.x=start.sx+(ev.clientX-start.x)/state.script.zoom;sn.y=start.sy+(ev.clientY-start.y)/state.script.zoom;card.style.left=`${sn.x}px`;card.style.top=`${sn.y}px`;renderScriptConnections();}function end(){card.removeEventListener('pointermove',move);card.removeEventListener('pointerup',end);}card.addEventListener('pointermove',move);card.addEventListener('pointerup',end);});}
  function attachOutputDrag(port){
    port.addEventListener('pointerdown',e=>{
      e.stopPropagation();e.preventDefault();
      const svg=$('#scriptConnections'),canvas=$('#scriptCanvas');
      const temp=document.createElementNS('http://www.w3.org/2000/svg','line');temp.setAttribute('class','temp-connection');svg.append(temp);
      function move(ev){const a=port.getBoundingClientRect(),cr=canvas.getBoundingClientRect();temp.setAttribute('x1',a.left+a.width/2-cr.left);temp.setAttribute('y1',a.top+a.height/2-cr.top);temp.setAttribute('x2',ev.clientX-cr.left);temp.setAttribute('y2',ev.clientY-cr.top);}
      function up(ev){
        const target=document.elementFromPoint(ev.clientX,ev.clientY)?.closest('.script-input-port');
        const outputNode=port.closest('.script-node-card')?.dataset.scriptNodeId, outputId=port.dataset.outputId;
        const list=state.script.connectionsByNode[state.script.nodeId] ||= [];
        // This output owns at most one connection. Releasing it on empty space disconnects it.
        for(let i=list.length-1;i>=0;i--) if(list[i].from===outputNode&&list[i].output===outputId) list.splice(i,1);
        if(target && outputNode){
          const nodeId=target.closest('.script-node-card')?.dataset.scriptNodeId;
          if(nodeId) list.push({from:outputNode,output:outputId,to:nodeId});
        }
        temp.remove();document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);renderScriptConnections();
      }
      move(e);document.addEventListener('pointermove',move);document.addEventListener('pointerup',up,{once:true});
    });
  }

  function renderScriptConnections(){const svg=$('#scriptConnections');if(!svg)return;svg.innerHTML='';(state.script.connectionsByNode[state.script.nodeId]||[]).forEach((c,index)=>{const from=$(`[data-script-node-id="${c.from}"] [data-output-id="${c.output}"]`,$('#scriptCanvas'));const to=$(`[data-script-node-id="${c.to}"] .script-input-port`,$('#scriptCanvas'));if(!from||!to)return;const a=from.getBoundingClientRect(),b=to.getBoundingClientRect(),canvas=$('#scriptCanvas').getBoundingClientRect();const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',a.left+a.width/2-canvas.left);line.setAttribute('y1',a.top+a.height/2-canvas.top);line.setAttribute('x2',b.left+b.width/2-canvas.left);line.setAttribute('y2',b.top+b.height/2-canvas.top);line.setAttribute('class','script-connection');line.dataset.connectionIndex=index;line.addEventListener('pointerdown',e=>{e.stopPropagation();const list=state.script.connectionsByNode[state.script.nodeId]||[];const i=list.indexOf(c);if(i>=0)list.splice(i,1);renderScriptConnections();});svg.append(line);});}
  function enableScriptCanvas(){
    enableScriptPanelControls();
    const canvas=$('#scriptCanvas'); let pan=null;const pointers=new Map();let pinch=null;
    resetScriptCanvasInteraction=()=>{pointers.clear();pan=null;pinch=null;canvas.classList.remove('panning');};
    canvas.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===2){
        const [a,b]=[...pointers.values()],midX=(a.x+b.x)/2,midY=(a.y+b.y)/2;
        if(!Number.isFinite(state.script.pan.x))state.script.pan.x=0;
        if(!Number.isFinite(state.script.pan.y))state.script.pan.y=0;
        if(!Number.isFinite(state.script.zoom))state.script.zoom=1;
        pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:state.script.zoom,lastMidX:midX,lastMidY:midY};
        pan=null;canvas.classList.remove('panning');return;
      }
      if(e.target.closest('.script-node-card,.script-input,.script-input-port,.script-output-port'))return;
      pan={x:e.clientX,y:e.clientY,px:state.script.pan.x,py:state.script.pan.y};
      canvas.setPointerCapture?.(e.pointerId);canvas.classList.add('panning');
    });
    canvas.addEventListener('pointermove',e=>{
      if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size>=2&&pinch){
        const [a,b]=[...pointers.values()],midX=(a.x+b.x)/2,midY=(a.y+b.y)/2,dist=Math.max(1,Math.hypot(a.x-b.x,a.y-b.y));
        const before=scriptClientToWorld(pinch.lastMidX,pinch.lastMidY),rect=canvas.getBoundingClientRect();
        state.script.zoom=clamp(pinch.zoom*(dist/pinch.distance),.25,4);
        state.script.pan.x=(midX-rect.left-rect.width/2)-before.x*state.script.zoom;
        state.script.pan.y=(midY-rect.top-rect.height/2)-before.y*state.script.zoom;
        if(!Number.isFinite(state.script.pan.x))state.script.pan.x=0;
        if(!Number.isFinite(state.script.pan.y))state.script.pan.y=0;
        pinch.lastMidX=midX;pinch.lastMidY=midY;applyScriptTransform();return;
      }
      if(!pan)return;
      state.script.pan.x=pan.px+e.clientX-pan.x;state.script.pan.y=pan.py+e.clientY-pan.y;
      if(!Number.isFinite(state.script.pan.x))state.script.pan.x=0;
      if(!Number.isFinite(state.script.pan.y))state.script.pan.y=0;
      applyScriptTransform();
    });
    const end=e=>{
      if(e?.pointerId!==undefined)pointers.delete(e.pointerId);
      if(pointers.size<2)pinch=null;
      if(pointers.size===0){pan=null;canvas.classList.remove('panning');}
    };
    canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('pointerleave',()=>{});
    canvas.addEventListener('lostpointercapture',()=>resetScriptCanvasInteraction?.());
    canvas.addEventListener('contextmenu',e=>{if(e.target.closest('.script-node-card'))return;e.preventDefault();showContextMenu([{label:'Paste',icon:'▣',shortcut:window.UIXKeyBinds?.shortcutFor('paste','script'),disabled:!state.script.clipboard,action:()=>pasteScriptNodes()},{label:'Select All',icon:'☷',shortcut:window.UIXKeyBinds?.shortcutFor('selectAll','script'),action:()=>{state.script.selectedNodeIds=scriptList().map(x=>x.id);state.script.selectedNodeId=state.script.selectedNodeIds.at(-1)||null;renderScriptCanvas();}},{label:'Deselect All',icon:'○',shortcut:window.UIXKeyBinds?.shortcutFor('deselectAll','script'),action:()=>{state.script.selectedNodeIds=[];state.script.selectedNodeId=null;renderScriptCanvas();}}],e.clientX,e.clientY);});
    canvas.addEventListener('wheel',e=>{e.preventDefault();const rect=canvas.getBoundingClientRect(),before=scriptClientToWorld(e.clientX,e.clientY),next=clamp(state.script.zoom*Math.exp(-e.deltaY*.0012),.25,4);state.script.zoom=next;state.script.pan.x=e.clientX-rect.left-rect.width/2-before.x*next;state.script.pan.y=e.clientY-rect.top-rect.height/2-before.y*next;applyScriptTransform();},{passive:false});
    canvas.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('application/x-uix-script-node'))e.preventDefault();});
    canvas.addEventListener('drop',e=>{const name=e.dataTransfer.getData('application/x-uix-script-node');if(!name)return;e.preventDefault();const def=scriptNodes.find(x=>x.name===name);if(!def)return;if(!scriptRequirementEnabled(def)){showScriptRequirementPrompt(def);return;}addScriptNodeAt(def,e.clientX,e.clientY);});
    new ResizeObserver(renderScriptConnections).observe(canvas);
  }

  function addScriptNodeAt(def,clientX,clientY){
    if(!scriptRequirementEnabled(def)){showScriptRequirementPrompt(def);return null;}
    const point=scriptClientToWorld(clientX,clientY);
    const list=state.script.nodesByNode[state.script.nodeId] ||= [];
    const sn={id:`snode-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,defName:def.name,x:point.x,y:point.y,values:cloneEditorDefinition(def.editor||[]).map(normalizeEditor),expressions:{}};
    list.push(sn); renderScriptCanvas(); status(`${def.name} ScriptNode added`);
  }

  // Custom Math helpers are still regular JavaScript and are available inside expressions.
  Math.lerp ||= (a,b,t)=>a+(b-a)*t;
  Math.clamp ||= (v,min,max)=>Math.max(min,Math.min(max,v));
  Math.map ||= (v,inMin,inMax,outMin,outMax)=>outMin+(v-inMin)*(outMax-outMin)/(inMax-inMin||1);
  Math.moveTowards ||= (current,target,maxDelta)=>Math.abs(target-current)<=maxDelta?target:current+Math.sign(target-current)*maxDelta;
  Math.smoothstep ||= (a,b,t)=>{t=Math.clamp(t,0,1);return t*t*(3-2*t);};
  Math.wrap ||= (v,min,max)=>{const range=max-min||1;return ((v-min)%range+range)%range+min;};
  Math.degToRad ||= deg=>deg*Math.PI/180;
  Math.radToDeg ||= rad=>rad*180/Math.PI;
  Math.distance ||= (a,b)=>Math.hypot((b?.[0]??0)-(a?.[0]??0),(b?.[1]??0)-(a?.[1]??0));
  Math.randInt ||= (min,max)=>{
    min=Math.ceil(Number(min));max=Math.floor(Number(max));
    if(!Number.isFinite(min)||!Number.isFinite(max))return NaN;
    if(max<min)[min,max]=[max,min];
    return Math.floor(Math.random()*(max-min+1))+min;
  };

  function keybindOptions(){
    const numbers=Array.from({length:10},(_,i)=>String(i));
    const letters=Array.from({length:26},(_,i)=>String.fromCharCode(65+i));
    return ['Enter',...numbers,...letters,'Space','Escape','Tab','Shift','Control','Alt','Backspace','Delete','Insert','Home','End','PageUp','PageDown','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  }

  // ---------------- Runtime preview ----------------
  function runtimeScene(){ return state.runtime.scene || null; }
  function runtimeAllNodes(scene=runtimeScene()){
    const out=[]; const walk=(items,parent=null)=> (Array.isArray(items)?items:[]).forEach(node=>{out.push({node,parent});if(node.type==='folder')walk(node.children,node);}); walk(scene?.nodes); return out;
  }
  function runtimeFindNode(id){ return runtimeAllNodes().find(x=>x.node.id===id)?.node || null; }
  function runScriptGraphForNode(node){
    if(!node)return;
    runtimeScriptList(node.id).filter(sn=>sn.defName==='onLoad').forEach(sn=>executeRuntimeScriptNode(sn,scriptNodeDefinition(sn.defName),node,true));
  }
  function runtimeSceneVariables(sceneId=state.runtime.sceneId){ return state.runtime.sceneVariablesByScene?.[sceneId] || []; }
  function buildRuntimeBody(node){
    const t=component(node,'transform')||{position:[0,0],scale:[1,1],angle:[0]}; const p=component(node,'physics'); const c=component(node,'collider');
    return {node,t:{position:[...t.position],scale:[...t.scale],angle:[...t.angle]},physics:p?clone(p):null,collider:c?{...clone(c),transform:{...c.transform,position:[...c.transform.position],scale:[...c.transform.scale],angle:[...c.transform.angle]}}:null,vx:0,vy:0,omega:0,colliding:false};
  }
  function buildRuntimeState(scene){return runtimeAllNodes(scene).filter(({node})=>node.type==='node').map(({node})=>buildRuntimeBody(node));}
  function runtimeContainerForNode(id,items=state.runtime.scene?.nodes){if(!Array.isArray(items))return null;for(const item of items){if(item.id===id)return items;if(item.type==='folder'){const found=runtimeContainerForNode(id,item.children);if(found)return found;}}return null;}
  function runtimeAddObject(sourceId,x,y,angle,vx,vy,angularVelocity){
    const source=runtimeFindNode(sourceId);if(!source)return null;const copy=clone(source);const oldId=copy.id;copy.id=`node-runtime-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    const used=new Set(runtimeAllNodes().map(({node})=>node.numericId).filter(Number.isFinite));let n=Number(copy.numericId)||1;while(used.has(n))n++;copy.numericId=n;const t=component(copy,'transform');if(t){t.position=[Number(x)||0,Number(y)||0];if(angle!==null&&angle!==undefined)t.angle=[Number(angle)||0];}
    state.runtime.scene.nodes.push(copy);state.runtime.dynamicScriptsByNode[copy.id]=clone(state.runtime.dynamicScriptsByNode[oldId]||[]);state.runtime.dynamicConnectionsByNode[copy.id]=clone(state.runtime.dynamicConnectionsByNode[oldId]||[]);state.runtime.localVarsByNode[copy.id]=clone(state.runtime.localVarsByNode[oldId]||[]);const body=buildRuntimeBody(copy);body.vx=Number(vx)||0;body.vy=Number(vy)||0;body.omega=Number(angularVelocity||0)*Math.PI/180;state.runtime.bodies.push(body);runScriptGraphForNode(copy);return copy;
  }
  function runtimeDestroyNode(node){const container=runtimeContainerForNode(node.id);if(container){const i=container.findIndex(x=>x.id===node.id);if(i>=0)container.splice(i,1);}state.runtime.bodies=state.runtime.bodies.filter(b=>b.node?.id!==node.id);delete state.runtime.dynamicScriptsByNode[node.id];delete state.runtime.dynamicConnectionsByNode[node.id];delete state.runtime.localVarsByNode[node.id];delete state.runtime.followTargets[node.id];delete state.runtime.aiTargets[node.id];}

  function vec(x=0,y=0){return{x:Number(x)||0,y:Number(y)||0};}
  function addV(a,b){return{x:a.x+b.x,y:a.y+b.y};}
  function subV(a,b){return{x:a.x-b.x,y:a.y-b.y};}
  function mulV(a,k){return{x:a.x*k,y:a.y*k};}
  function dotV(a,b){return a.x*b.x+a.y*b.y;}
  function lenV(a){return Math.hypot(a.x,a.y);}
  function normV(a){const l=lenV(a);return l>1e-9?{x:a.x/l,y:a.y/l}:{x:1,y:0};}
  function perpV(a){return{x:-a.y,y:a.x};}
  function crossV(a,b){return a.x*b.y-a.y*b.x;}
  function crossSV(s,v){return{x:-s*v.y,y:s*v.x};}
  function clampPointToSegment(p,a,b){const ab=subV(b,a),den=dotV(ab,ab)||1,t=clamp(dotV(subV(p,a),ab)/den,0,1);return addV(a,mulV(ab,t));}
  function polygonCenter(vertices){
    if(!vertices.length)return{x:0,y:0};let x=0,y=0;for(const v of vertices){x+=v.x;y+=v.y;}return{x:x/vertices.length,y:y/vertices.length};
  }
  function rotateLocalPoint(x,y,angle){const c=Math.cos(angle),s=Math.sin(angle);return{x:x*c-y*s,y:x*s+y*c};}
  function runtimeColliderShape(body){
    const c=body.collider;
    const hasPhysics=!!body.physics;
    const hasComponent=!!c&&c.collidable!==false;
    const physicsCollider=body.physics?.isCollider===true;
    // Collider component = detectable/overlappable shape.
    // Physics.isCollider = physical collision response as well.
    // A Physics collider can use the default body shape even without a Collider component.
    const enabled=hasComponent||physicsCollider;
    if(!enabled)return null;
    const nt=body.t||{position:[0,0],scale:[1,1],angle:[0]};
    const nx=Number(nt.position?.[0]||0),ny=Number(nt.position?.[1]||0);
    const nsx=Number(nt.scale?.[0]??1),nsy=Number(nt.scale?.[1]??1),na=Number(nt.angle?.[0]||0)*Math.PI/180;
    let type='Rect',w=90*Math.abs(nsx),h=54*Math.abs(nsy),lx=0,ly=0,la=0;
    if(hasComponent){
      const ct=c.transform||{position:[0,0],scale:[1,1],angle:[0]};
      type=['Rect','Circle','Triangle'].includes(c.shapeType)?c.shapeType:'Rect';
      lx=Number(ct.position?.[0]||0)*nsx;
      ly=Number(ct.position?.[1]||0)*nsy;
      la=Number(ct.angle?.[0]||0)*Math.PI/180;
      w=90*Math.abs(Number(ct.scale?.[0]??1)*nsx);
      h=54*Math.abs(Number(ct.scale?.[1]??1)*nsy);
    }
    const cos=Math.cos(na),sin=Math.sin(na);
    const x=nx+lx*cos-ly*sin,y=ny+lx*sin+ly*cos,angle=na+la;
    if(type==='Circle'){const d=Math.max(w,h);w=d;h=d;}
    const shape={type,x,y,angle,w:Math.max(.01,w),h:Math.max(.01,h),vertices:null,radius:null};
    if(type==='Circle')shape.radius=shape.w/2;
    else {
      const hw=shape.w/2,hh=shape.h/2;
      const local=type==='Triangle'?[{x:0,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}]:[{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}];
      shape.vertices=local.map(v=>{const q=rotateLocalPoint(v.x,v.y,angle);return {x:x+q.x,y:y+q.y};});
    }
    return shape;
  }
  function shapeAABB(shape){
    if(shape.type==='Circle')return{x:shape.x-shape.radius,y:shape.y-shape.radius,w:shape.radius*2,h:shape.radius*2,l:shape.x-shape.radius,r:shape.x+shape.radius,t:shape.y-shape.radius,b:shape.y+shape.radius};
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;for(const v of shape.vertices||[]) {minX=Math.min(minX,v.x);minY=Math.min(minY,v.y);maxX=Math.max(maxX,v.x);maxY=Math.max(maxY,v.y);}return{x:(minX+maxX)/2,y:(minY+maxY)/2,w:maxX-minX,h:maxY-minY,l:minX,r:maxX,t:minY,b:maxY};
  }
  function runtimeBounds(body){const g=runtimeColliderShape(body);if(!g)return null;const a=shapeAABB(g);return {...a,w:a.w,h:a.h};}
  function polygonAxes(vertices){const axes=[];for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],e=subV(b,a);axes.push(normV(perpV(e)));}return axes;}
  function projectPolygon(vertices,axis){let min=Infinity,max=-Infinity;for(const v of vertices){const d=dotV(v,axis);if(d<min)min=d;if(d>max)max=d;}return{min,max};}
  function projectCircle(shape,axis){const c={x:shape.x,y:shape.y},r=shape.radius,center=dotV(c,axis);return{min:center-r,max:center+r};}
  function closestPolygonPoint(shape,p){let best=null,bestD=Infinity;for(let i=0;i<shape.vertices.length;i++){const a=shape.vertices[i],b=shape.vertices[(i+1)%shape.vertices.length],q=clampPointToSegment(p,a,b),d=dotV(subV(q,p),subV(q,p));if(d<bestD){bestD=d;best=q;}}return{point:best,distance:Math.sqrt(bestD)};}
  function supportPoints(shape,dir){
    if(shape.type==='Circle')return[{x:shape.x+dir.x*shape.radius,y:shape.y+dir.y*shape.radius}];
    const verts=shape.vertices||[];if(!verts.length)return[];let best=-Infinity;for(const v of verts)best=Math.max(best,dotV(v,dir));const eps=1e-6,pts=verts.filter(v=>Math.abs(dotV(v,dir)-best)<=eps);return pts.length?pts:[verts[0]];
  }
  function supportPoint(shape,dir){const pts=supportPoints(shape,dir);if(!pts.length)return{x:shape.x||0,y:shape.y||0};const inv=1/pts.length;return pts.reduce((a,v)=>({x:a.x+v.x*inv,y:a.y+v.y*inv}),{x:0,y:0});}
  function collisionCircleCircle(A,B){const ab=subV({x:B.x,y:B.y},{x:A.x,y:A.y}),d=lenV(ab),r=A.radius+B.radius;if(d>=r)return null;const n=d>1e-8?mulV(ab,1/d):{x:1,y:0};return{normal:n,penetration:r-d,point:addV({x:A.x,y:A.y},mulV(n,A.radius-(r-d)*.5))};}
  function collisionPolygonPolygon(A,B){const axes=[...polygonAxes(A.vertices),...polygonAxes(B.vertices)];let best={penetration:Infinity,normal:null};for(const axis0 of axes){const axis=normV(axis0),pa=projectPolygon(A.vertices,axis),pb=projectPolygon(B.vertices,axis),over=Math.min(pa.max,pb.max)-Math.max(pa.min,pb.min);if(over<=0)return null;if(over<best.penetration)best={penetration:over,normal:axis};}const ca=polygonCenter(A.vertices),cb=polygonCenter(B.vertices);if(dotV(subV(cb,ca),best.normal)<0)best.normal=mulV(best.normal,-1);const n=best.normal,t=perpV(n);const paN=projectPolygon(A.vertices,n),pbN=projectPolygon(B.vertices,n);const ta=projectPolygon(A.vertices,t),tb=projectPolygon(B.vertices,t);const tMin=Math.max(ta.min,tb.min),tMax=Math.min(ta.max,tb.max);const tn=(paN.max+pbN.min)*0.5,tt=(tMin+tMax)*0.5;const point={x:n.x*tn+t.x*tt,y:n.y*tn+t.y*tt};return{normal:n,penetration:best.penetration,point};}
  function collisionCirclePolygon(circle,poly){const axes=polygonAxes(poly.vertices),cp=closestPolygonPoint(poly,{x:circle.x,y:circle.y});if(cp.point){const diff=subV(cp.point,{x:circle.x,y:circle.y}),d=lenV(diff);if(d>1e-7)axes.push(mulV(diff,1/d));}let best={penetration:Infinity,normal:null};for(const axis0 of axes){const axis=normV(axis0),pc=projectCircle(circle,axis),pp=projectPolygon(poly.vertices,axis),over=Math.min(pc.max,pp.max)-Math.max(pc.min,pp.min);if(over<=0)return null;if(over<best.penetration)best={penetration:over,normal:axis};}const cpCenter=polygonCenter(poly.vertices);if(dotV(subV(cpCenter,{x:circle.x,y:circle.y}),best.normal)<0)best.normal=mulV(best.normal,-1);const circleContact={x:circle.x+best.normal.x*circle.radius,y:circle.y+best.normal.y*circle.radius};const polyContact=cp.point||supportPoint(poly,mulV(best.normal,-1));return{normal:best.normal,penetration:best.penetration,point:mulV(addV(circleContact,polyContact),.5)};}
  function collideShapes(A,B){if(!A||!B)return null;if(A.type==='Circle'&&B.type==='Circle')return collisionCircleCircle(A,B);if(A.type==='Circle'&&B.type!=='Circle')return collisionCirclePolygon(A,B);if(A.type!=='Circle'&&B.type==='Circle'){const hit=collisionCirclePolygon(B,A);if(!hit)return null;return{normal:mulV(hit.normal,-1),penetration:hit.penetration,point:hit.point};}return collisionPolygonPolygon(A,B);}
  function bodyMassProperties(body,shape){const p=body.physics?.body;if(p!=='Dynamic')return{mass:Infinity,invMass:0,inertia:Infinity,invInertia:0};let area=1,inertiaFactor=1;if(shape.type==='Circle'){area=Math.PI*shape.radius*shape.radius;inertiaFactor=.5*shape.radius*shape.radius;}else if(shape.type==='Triangle'){area=Math.max(.01,.5*shape.w*shape.h);inertiaFactor=(shape.w*shape.w+shape.h*shape.h)/24;}else{area=Math.max(.01,shape.w*shape.h);inertiaFactor=(shape.w*shape.w+shape.h*shape.h)/12;}const mass=Math.max(.01,area/1000),inertia=mass*inertiaFactor;return{mass,invMass:1/mass,inertia,invInertia:body.physics?.fixedRotation?0:1/Math.max(.0001,inertia)};}
  function torqueScreen(r,f){return-crossV(r,f);}
  function contactState(A,B,hit){const As=runtimeColliderShape(A),Bs=runtimeColliderShape(B);if(!As||!Bs)return null;const ap=bodyMassProperties(A,As),bp=bodyMassProperties(B,Bs);if(ap.invMass===0&&bp.invMass===0)return null;const ac=A.t?.position||[0,0],bc=B.t?.position||[0,0],ra=subV(hit.point,{x:Number(ac[0])||0,y:Number(ac[1])||0}),rb=subV(hit.point,{x:Number(bc[0])||0,y:Number(bc[1])||0});return{A,B,hit,ra,rb,n:normV(hit.normal),ap,bp,friction:Math.sqrt(Math.max(0,Number(A.physics?.friction)||0)*Math.max(0,Number(B.physics?.friction)||0)),restitution:clamp(Math.max(Number(A.physics?.bounciness)||0,Number(B.physics?.bounciness)||0),0,1),normalImpulse:0,tangentImpulse:0};}
  function pointVelocity(body,r){return addV({x:Number(body.vx)||0,y:Number(body.vy)||0},crossSV(Number(body.omega)||0,r));}
  function applyImpulse(body,impulse,r,sign){const props=bodyMassProperties(body,runtimeColliderShape(body));if(props.invMass===0)return;body.vx+=impulse.x*props.invMass*sign;body.vy+=impulse.y*props.invMass*sign;body.omega+=torqueScreen(r,impulse)*props.invInertia*sign;}
  function relativeVelocityDelta(c,J){
    const {A,B,ra,rb,ap,bp}=c;
    const invA=ap.invMass,invB=bp.invMass,iiA=ap.invInertia,iiB=bp.invInertia;
    const dVA={x:-J.x*invA,y:-J.y*invA},dVB={x:J.x*invB,y:J.y*invB};
    const dOA=torqueScreen(ra,mulV(J,-1))*iiA,dOB=torqueScreen(rb,J)*iiB;
    const dVAp=addV(dVA,crossSV(dOA,ra)),dVBp=addV(dVB,crossSV(dOB,rb));
    return subV(dVBp,dVAp);
  }
  function kineticEnergy(body,props){if(!props||props.invMass===0)return 0;const vx=Number(body.vx)||0,vy=Number(body.vy)||0,w=Number(body.omega)||0;return .5*(vx*vx+vy*vy)/props.invMass + .5*(w*w)/Math.max(1e-12,props.invInertia);}
  function solveVelocityContact(c){
    const {A,B,ra,rb,n,ap,bp}=c;
    if(ap.invMass===0&&bp.invMass===0)return;
    const tangent=perpV(n);
    const beforeA=kineticEnergy(A,ap),beforeB=kineticEnergy(B,bp);
    let rv=subV(pointVelocity(B,rb),pointVelocity(A,ra)),vn=dotV(rv,n),vt=dotV(rv,tangent);
    if(vn>=0&&Math.abs(vt)<1e-7)return;
    const knVec=relativeVelocityDelta(c,n),ktVec=relativeVelocityDelta(c,tangent);
    const knn=dotV(n,knVec),knt=dotV(n,ktVec),ktn=dotV(tangent,knVec),ktt=dotV(tangent,ktVec);
    const det=knn*ktt-knt*ktn;
    if(Math.abs(det)<=1e-10)return;
    const bounce=(c.restitution>0&&vn<-.75)?c.restitution:0;
    const targetN=vn<0?-bounce*vn:0;
    let jn=((targetN-vn)*ktt-knt*(-vt))/det;
    let jt=(knn*(-vt)-ktn*(targetN-vn))/det;
    if(jn<0)jn=0;
    jt=clamp(jt,-c.friction*jn,c.friction*jn);
    if(knn>1e-10)jn=Math.max(0,(targetN-vn-knt*jt)/knn);
    if(jn<=1e-12)jt=0;
    const impulse=addV(mulV(n,jn),mulV(tangent,jt));
    if(lenV(impulse)<=1e-12)return;
    applyImpulse(A,impulse,ra,-1);
    applyImpulse(B,impulse,rb,1);
    // A collision should not create kinetic energy. Numerical error in a custom solver
    // can otherwise turn repeated contacts into the “physics explosion” seen in games.
    const before=beforeA+beforeB;
    const after=kineticEnergy(A,ap)+kineticEnergy(B,bp);
    if(Number.isFinite(before)&&Number.isFinite(after)&&after>before*(1.000001)){
      const factor=Math.sqrt(Math.max(0,before*(1.000001)/(after||1)));
      for(const body of [A,B]){const props=body===A?ap:bp;if(props.invMass===0)continue;body.vx*=factor;body.vy*=factor;body.omega*=factor;}
    }
  }
  function solvePositionContacts(contacts){for(let iter=0;iter<6;iter++){let changed=false;for(const c of contacts){const fresh=collideShapes(runtimeColliderShape(c.A),runtimeColliderShape(c.B));if(!fresh)continue;c.hit=fresh;c.n=normV(fresh.normal);const total=c.ap.invMass+c.bp.invMass;if(total<=0)continue;const correction=Math.min(1.0,Math.max(fresh.penetration-0.25,0)*0.22);if(correction<=0)continue;const move=mulV(c.n,correction/total);if(c.ap.invMass){c.A.t.position[0]-=move.x*c.ap.invMass;c.A.t.position[1]-=move.y*c.ap.invMass;}if(c.bp.invMass){c.B.t.position[0]+=move.x*c.bp.invMass;c.B.t.position[1]+=move.y*c.bp.invMass;}changed=true;}if(!changed)break;}}
  function updateRuntimeCollisions(dt=1/120){const bodies=state.runtime.bodies||[];bodies.forEach(b=>b.colliding=false);const contacts=[];for(let i=0;i<bodies.length;i++){const A=runtimeColliderShape(bodies[i]);if(!A)continue;const aabbA=shapeAABB(A);for(let j=i+1;j<bodies.length;j++){const B=runtimeColliderShape(bodies[j]);if(!B)continue;const aabbB=shapeAABB(B);if(aabbA.r<aabbB.l||aabbA.l>aabbB.r||aabbA.b<aabbB.t||aabbA.t>aabbB.b)continue;const hit=collideShapes(A,B);if(!hit)continue;bodies[i].colliding=true;bodies[j].colliding=true;if(!(bodies[i].physics?.isCollider===true||bodies[j].physics?.isCollider===true))continue;const c=contactState(bodies[i],bodies[j],hit);if(c)contacts.push(c);}}for(let iter=0;iter<12;iter++)for(const c of contacts)solveVelocityContact(c);solvePositionContacts(contacts);for(const body of bodies){if(!Number.isFinite(body.vx))body.vx=0;if(!Number.isFinite(body.vy))body.vy=0;if(!Number.isFinite(body.omega))body.omega=0;if(Math.abs(body.vx)>100000||Math.abs(body.vy)>100000){body.vx=clamp(body.vx,-100000,100000);body.vy=clamp(body.vy,-100000,100000);}if(Math.abs(body.omega)>10000)body.omega=clamp(body.omega,-10000,10000);}}
  function runtimeIsCollided(aNode,targetLabel){
    const bodies=state.runtime.bodies||[];const a=bodies.find(b=>b.node?.id===aNode.id);if(!a)return false;const target=bodies.find(b=>b.node?.id===targetLabel)||bodies.find(b=>`${b.node?.name} [${b.node?.numericId}]`===String(targetLabel||''));if(!target||target===a)return false;return !!collideShapes(runtimeColliderShape(a),runtimeColliderShape(target));
  }
  function drawRuntimeColliders(ctx){if(!state.runtime.debug)return;for(const b of state.runtime.bodies||[]){const g=runtimeColliderShape(b);if(!g)continue;ctx.save();ctx.strokeStyle=b.colliding?'#ff4d4d':'#4b8dff';ctx.fillStyle=b.colliding?'rgba(255,77,77,.08)':'rgba(75,141,255,.08)';ctx.lineWidth=2;ctx.setLineDash([7,4]);ctx.beginPath();if(g.type==='Circle'){ctx.arc(g.x,g.y,g.radius,0,Math.PI*2);}else{g.vertices.forEach((v,i)=>{if(i===0)ctx.moveTo(v.x,v.y);else ctx.lineTo(v.x,v.y);});ctx.closePath();}ctx.fill();ctx.stroke();ctx.setLineDash([]);ctx.restore();}}
  function runtimeFindFolderByLabel(label){
    let found=null;const wanted=String(label||'');
    const walk=items=>{for(const item of (Array.isArray(items)?items:[])){if(item.type==='folder'){if(`${item.name} [${item.numericId}]`===wanted){found=item;return true;}if(walk(item.children))return true;}}return false;};
    walk(state.runtime.scene?.nodes);return found;
  }
  function runtimeFolderColliderBodies(label,bodyById=null){
    const folder=runtimeFindFolderByLabel(label);if(!folder)return [];
    const ids=[];const walk=items=>{for(const item of (Array.isArray(items)?items:[])){if(item.type==='node'){const body=bodyById?.get(item.id)||(state.runtime.bodies||[]).find(b=>b.node?.id===item.id);if(body?.collider?.collidable!==false && body?.collider)ids.push(body);}else if(item.type==='folder')walk(item.children);}};walk(folder.children);return ids;
  }
  function runtimeBodyRadius(body){const g=runtimeColliderShape(body);if(!g)return 0;const a=shapeAABB(g);return Math.max(a.w,a.h)*.5;}
  function pointInPolygon(p,vertices){
    let inside=false;
    for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){
      const a=vertices[i],b=vertices[j],cross=((a.y>p.y)!==(b.y>p.y))&&(p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y||1e-12)+a.x);
      if(cross)inside=!inside;
    }
    return inside;
  }
  function runtimeShapeClearance(shape,p){
    if(!shape)return Infinity;
    if(shape.type==='Circle')return Math.max(0,Math.hypot(p.x-shape.x,p.y-shape.y)-shape.radius);
    if(pointInPolygon(p,shape.vertices||[]))return 0;
    const q=closestPolygonPoint(shape,p);return q?.distance??Infinity;
  }
  function runtimeSegmentHitsShape(a,b,shape,pad=0){
    if(!shape)return false;
    const steps=Math.max(3,Math.min(7,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/Math.max(24,pad+18))));
    for(let i=1;i<=steps;i++){const t=i/steps,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};if(runtimeShapeClearance(shape,p)<=pad)return true;}
    return false;
  }
  function runtimeObstacleSignature(obstacles){
    return obstacles.map(o=>{const t=o.t||{};const c=o.collider||{};const tr=c.transform||{};return `${o.node?.id||''}:${Number(t.position?.[0]||0).toFixed(2)},${Number(t.position?.[1]||0).toFixed(2)},${Number(t.angle?.[0]||0).toFixed(2)},${Number(t.scale?.[0]??1).toFixed(2)},${Number(t.scale?.[1]??1).toFixed(2)}:${String(c.shapeType||'')}:${Number(tr.position?.[0]||0).toFixed(2)},${Number(tr.position?.[1]||0).toFixed(2)},${Number(tr.angle?.[0]||0).toFixed(2)},${Number(tr.scale?.[0]??1).toFixed(2)},${Number(tr.scale?.[1]??1).toFixed(2)}`}).join('|');
  }
  function runtimePathBlocked(a,b,obstacles,pad){
    const d=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.max(4,Math.min(96,Math.ceil(d/Math.max(6,Math.min(18,pad*.35+4)))));
    for(let i=0;i<=steps;i++){const t=i/steps,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};for(const sh of obstacles){if(runtimeShapeClearance(sh,p)<=pad)return true;}}
    return false;
  }
  function runtimePlanChasePath(body,target,obstacles,bodyRadius){
    const start={x:Number(body.t?.position?.[0])||0,y:Number(body.t?.position?.[1])||0};
    const goal={x:Number(target.t?.position?.[0])||0,y:Number(target.t?.position?.[1])||0};
    const pad=Math.max(2,bodyRadius+3);
    if(!obstacles.length||!runtimePathBlocked(start,goal,obstacles,pad))return[start,goal];
    let minX=Math.min(start.x,goal.x),maxX=Math.max(start.x,goal.x),minY=Math.min(start.y,goal.y),maxY=Math.max(start.y,goal.y);
    for(const sh of obstacles){const a=shapeAABB(sh);const e=pad+24;minX=Math.min(minX,a.l-e);maxX=Math.max(maxX,a.r+e);minY=Math.min(minY,a.t-e);maxY=Math.max(maxY,a.b+e);}
    const extent=Math.max(maxX-minX,maxY-minY,64),cell=Math.max(18,Math.min(64,Math.max(bodyRadius*1.75,extent/56)));
    const cols=Math.max(8,Math.min(64,Math.ceil((maxX-minX)/cell)+1)),rows=Math.max(8,Math.min(64,Math.ceil((maxY-minY)/cell)+1));
    const ox=minX,oy=minY;
    const idx=(x,y)=>y*cols+x;
    const points=new Array(cols*rows);const blocked=new Uint8Array(cols*rows);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const p={x:ox+x*cell,y:oy+y*cell};points[idx(x,y)]=p;for(const sh of obstacles){if(runtimeShapeClearance(sh,p)<=pad){blocked[idx(x,y)]=1;break;}}
    }
    function nearestFree(p,force=false){
      let bx=clamp(Math.round((p.x-ox)/cell),0,cols-1),by=clamp(Math.round((p.y-oy)/cell),0,rows-1),best=null;
      for(let r=0;r<Math.max(cols,rows);r++)for(let yy=Math.max(0,by-r);yy<=Math.min(rows-1,by+r);yy++)for(let xx=Math.max(0,bx-r);xx<=Math.min(cols-1,bx+r);xx++){
        const id=idx(xx,yy),q=points[id];if(!force&&blocked[id])continue;const d=(q.x-p.x)*(q.x-p.x)+(q.y-p.y)*(q.y-p.y);if(!best||d<best.d)best={x:xx,y:yy,d};
      }
      return best;
    }
    const s=nearestFree(start,true),g=nearestFree(goal,false)||nearestFree(goal,true);if(!s||!g)return[start,goal];
    const open=[{x:s.x,y:s.y,g:0,f:Math.hypot(g.x-s.x,g.y-s.y)}],came=new Map(),cost=new Map([[idx(s.x,s.y),0]]),closed=new Set();
    const dirs=[[-1,0,1],[1,0,1],[0,-1,1],[0,1,1],[-1,-1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,1,Math.SQRT2],[1,1,Math.SQRT2]];
    let goalId=idx(g.x,g.y);
    while(open.length){open.sort((a,b)=>a.f-b.f);const cur=open.shift(),cid=idx(cur.x,cur.y);if(closed.has(cid))continue;closed.add(cid);if(cid===goalId)break;
      for(const [dx,dy,m] of dirs){const nx=cur.x+dx,ny=cur.y+dy;if(nx<0||ny<0||nx>=cols||ny>=rows)continue;const nid=idx(nx,ny);if(closed.has(nid)||blocked[nid])continue;if(dx&&dy&&(blocked[idx(cur.x+dx,cur.y)]||blocked[idx(cur.x,cur.y+dy)]))continue;const a=points[cid],b=points[nid];const abx={x:(a.x+b.x)*.5,y:(a.y+b.y)*.5},ab1={x:a.x+(b.x-a.x)*.25,y:a.y+(b.y-a.y)*.25},ab3={x:a.x+(b.x-a.x)*.75,y:a.y+(b.y-a.y)*.75};let edgeBlocked=false;for(const sh of obstacles){if(runtimeShapeClearance(sh,ab1)<=pad||runtimeShapeClearance(sh,abx)<=pad||runtimeShapeClearance(sh,ab3)<=pad){edgeBlocked=true;break;}}if(edgeBlocked)continue;const ng=cur.g+m;if(ng>=(cost.get(nid)??Infinity))continue;cost.set(nid,ng);came.set(nid,cid);open.push({x:nx,y:ny,g:ng,f:ng+Math.hypot(g.x-nx,g.y-ny)});}
    }
    if(!came.has(goalId)&&goalId!==idx(s.x,s.y))return[start,goal];
    const ids=[];let at=goalId;ids.push(at);while(at!==idx(s.x,s.y)){at=came.get(at);if(at==null)return[start,goal];ids.push(at);}ids.reverse();
    const raw=ids.map(id=>points[id]);raw[0]=start;raw[raw.length-1]=goal;
    const smooth=[raw[0]];let i=0;while(i<raw.length-1){let j=raw.length-1;for(;j>i+1;j--)if(!runtimePathBlocked(raw[i],raw[j],obstacles,pad))break;smooth.push(raw[j]);i=j;}
    return smooth;
  }
  function runtimeSteeringForAI(body,ai,dt,bodyById){
    if(!body?.physics||!ai)return null;
    const target=bodyById.get(ai.targetId);if(!target)return null;
    const speed=Math.max(0,Number(ai.speed)||0);if(speed<=0)return{x:0,y:0,face:null};
    const pos={x:Number(body.t?.position?.[0])||0,y:Number(body.t?.position?.[1])||0};
    const targetPos={x:Number(target.t?.position?.[0])||0,y:Number(target.t?.position?.[1])||0};
    const bodyRadius=runtimeBodyRadius(body),obstacles=runtimeFolderColliderBodies(ai.map,bodyById).filter(o=>o!==body&&o!==target).map(runtimeColliderShape).filter(Boolean);
    if(ai.kind!=='chase'){
      const base=normV(subV(pos,targetPos));
      return{x:base.x*speed,y:base.y*speed,face:base};
    }
    const targetMoved=Math.hypot(targetPos.x-(ai.lastTargetX??targetPos.x),targetPos.y-(ai.lastTargetY??targetPos.y));
    const signature=runtimeObstacleSignature(runtimeFolderColliderBodies(ai.map,bodyById).filter(o=>o!==body&&o!==target));
    const cellHint=Math.max(24,bodyRadius*2+18),now=performance.now();
    if(!ai.path||!ai.path.length||now-(ai.lastPlanAt||0)>260||targetMoved>cellHint||signature!==ai.mapSignature){
      ai.path=runtimePlanChasePath(body,target,obstacles,bodyRadius);ai.pathIndex=ai.path.length>1?1:0;ai.lastPlanAt=now;ai.lastTargetX=targetPos.x;ai.lastTargetY=targetPos.y;ai.mapSignature=signature;
    }
    while(ai.pathIndex<ai.path.length-1&&Math.hypot(ai.path[ai.pathIndex].x-pos.x,ai.path[ai.pathIndex].y-pos.y)<=Math.max(10,bodyRadius*.7+10))ai.pathIndex++;
    let waypoint=ai.path[Math.min(ai.pathIndex,ai.path.length-1)]||targetPos;
    if(runtimePathBlocked(pos,waypoint,obstacles,Math.max(2,bodyRadius+3))){ai.path=null;ai.lastPlanAt=now;return{x:0,y:0,face:null};}
    const dir=normV(subV(waypoint,pos));return{x:dir.x*speed,y:dir.y*speed,face:dir};
  }
  function updateRuntimeMovementControllers(dt){
    const bodyById=new Map((state.runtime.bodies||[]).map(b=>[b.node?.id,b]));
    Object.entries(state.runtime.followTargets||{}).forEach(([ownerId,info])=>{const owner=bodyById.get(ownerId),target=bodyById.get(info?.targetId);if(!owner||!target||!owner.physics)return;const speed=Math.max(0,Number(info.speed)||0),dx=(Number(target.t?.position?.[0])||0)-(Number(owner.t?.position?.[0])||0),dy=(Number(target.t?.position?.[1])||0)-(Number(owner.t?.position?.[1])||0),d=Math.hypot(dx,dy);if(d<=Math.max(1,speed*dt)){owner.vx=0;owner.vy=0;}else{const k=speed/d;owner.vx=dx*k;owner.vy=dy*k;}if(!owner.physics.fixedRotation&&d>1e-6)owner.t.angle[0]=Math.atan2(dy,dx)*180/Math.PI;});
    Object.entries(state.runtime.aiTargets||{}).forEach(([ownerId,ai])=>{const owner=bodyById.get(ownerId);if(!owner||!owner.physics)return;const steer=runtimeSteeringForAI(owner,ai,dt,bodyById);if(!steer)return;owner.vx=steer.x;owner.vy=steer.y;if(!owner.physics.fixedRotation&&steer.face)owner.t.angle[0]=Math.atan2(steer.face.y,steer.face.x)*180/Math.PI;});
  }
  function stepRuntime(dt){const now=performance.now();if(state.runtime.pendingSceneId){const next=state.scenes.find(s=>s.id===state.runtime.pendingSceneId);if(next){runRuntimeUnloadScripts();state.runtime.scene=clone(next);state.runtime.sceneId=next.id;state.runtime.scene.camera=clone(ensureSceneCamera(next));state.runtime.bodies=buildRuntimeState(state.runtime.scene);state.runtime.camera=runtimeCameraFromScene(state.runtime.scene);state.runtime.events={key:createRuntimeKeyEventState(),lastKey:''};state.runtime.dynamicScriptsByNode=Object.create(null);state.runtime.dynamicConnectionsByNode=Object.create(null);runtimeAllNodes(state.runtime.scene).filter(({node})=>node.type==='node').forEach(({node})=>{state.runtime.dynamicScriptsByNode[node.id]=clone(state.script.nodesByNode[node.id]||[]);state.runtime.dynamicConnectionsByNode[node.id]=clone(state.script.connectionsByNode[node.id]||[]);});state.runtime.joysticks=sceneJoysticks(state.runtime.scene).map(j=>({variable:j.variable,distance:0,angle:0,value_x:0,value_y:0}));state.runtime.activeJoystickPointers={};state.runtime.followTargets=Object.create(null);state.runtime.aiTargets=Object.create(null);runRuntimeSceneScripts();}state.runtime.pendingSceneId='';}
    updateRuntimeMic();
    if(state.runtime.running)dispatchRuntimeEvent('onTick','tick',{delta:dt,time:now});
    const substeps=4,subDt=dt/substeps;
    for(let sub=0;sub<substeps;sub++){
      updateRuntimeMovementControllers(subDt);
      if(window.UIXRuntimeEngine?.stepPhysics) window.UIXRuntimeEngine.stepPhysics(state.runtime.bodies||[],subDt);
      else updateRuntimeCollisions(subDt);
    }
    processRuntimeTimers(now);updateRuntimeCamera(dt);clearRuntimeKeyEvents();}
  function runtimeCameraFromScene(scene){const cam=clone(ensureSceneCamera(scene));const baseX=Number(cam.transform.position?.[0]||0),baseY=Number(cam.transform.position?.[1]||0),baseAngle=Number(cam.transform.angle?.[0]||0);return {x:baseX,y:baseY,baseX,baseY,baseAngle,angle:baseAngle,enabled:!!cam.enabled,followId:cam.followId,followAnimation:cam.animation,speed:Number(cam.speed)||0,scale:Number(cam.scale)||1,bgColor:cam.bgColor,horizontal:Number(cam.horizontal)||0,vertical:Number(cam.vertical)||0};}
  function runtimeFollowTarget(){const id=state.runtime.camera?.followId;if(!id||id==='this'||id==='This')return null;const body=(state.runtime.bodies||[]).find(b=>b.node?.id===id);return body?body.t:null;}
  function updateRuntimeCamera(dt){
    const cam=state.runtime.camera;if(!cam)return;
    const target=runtimeFollowTarget();
    const baseX=Number(cam.baseX||0),baseY=Number(cam.baseY||0);
    const tx=(target?Number(target.position?.[0]||0):baseX)+Number(cam.horizontal||0);
    const ty=(target?Number(target.position?.[1]||0):baseY)+Number(cam.vertical||0);
    const speed=Math.max(0,Number(cam.speed)||0);
    if((cam.followAnimation||'Smooth')==='Quick'||speed<=0){cam.x=tx;cam.y=ty;}
    else {const k=1-Math.exp(-speed*Math.max(0,dt)/100);cam.x+=(tx-cam.x)*k;cam.y+=(ty-cam.y)*k;}
    cam.angle=Number(cam.baseAngle||0);
  }
  function hydrateRuntimeVariables(sceneId){state.runtime.globalVariables=clone(state.globalVariables);state.runtime.sceneVariablesByScene=Object.create(null);for(const s of state.scenes)state.runtime.sceneVariablesByScene[s.id]=clone(state.sceneVariablesByScene[s.id]||[]);state.runtime.localVarsByNode=clone(state.localVarsByNode);}
  let runtimeLast=0,runtimeFrame=0,runtimeAccumulator=0;

  function scriptNodeDefinition(name){
    return scriptNodes.find(def=>def && def.name===name) || null;
  }
  function runtimeScriptList(nodeId){
    const list=state.runtime?.dynamicScriptsByNode?.[nodeId];
    return Array.isArray(list)?list:[];
  }
  function runtimeConnectionList(){
    const list=state.runtime?.dynamicConnectionsByNode?.[state.runtime?.sceneId];
    return Array.isArray(list)?list:[];
  }
  function runtimeConnectionsForNode(nodeId){
    const all=state.runtime?.dynamicConnectionsByNode?.[state.runtime?.sceneId];
    if(Array.isArray(all))return all;
    const out=[];
    Object.values(state.runtime?.dynamicConnectionsByNode||{}).forEach(list=>{if(Array.isArray(list))out.push(...list.filter(c=>c.from===nodeId||c.to===nodeId));});
    return out;
  }
  function runtimeFindScriptConnection(nodeId,outputId){
    for(const list of Object.values(state.runtime?.dynamicConnectionsByNode||{})){
      if(!Array.isArray(list))continue;
      const hit=list.find(c=>c.from===nodeId&&c.output===outputId);
      if(hit)return hit;
    }
    return null;
  }
  function runtimeNodeForScript(sn){
    if(!sn)return null;
    const owner=Object.keys(state.runtime?.dynamicScriptsByNode||{}).find(nodeId=>runtimeScriptList(nodeId).some(x=>x.id===sn.id));
    return owner?runtimeFindNode(owner):null;
  }
  function runtimeValuesForScript(sn,node){
    const values={};
    flattenEditor(sn?.values||[]).forEach(item=>{
      const entry=item.entry;
      if(!entry)return;
      if(Object.prototype.hasOwnProperty.call(sn.expressions||{},item.path)){
        try{values[entry.name]=evaluateRuntimeExpression(sn.expressions[item.path],node,entry.type);}catch(err){values[entry.name]=entry.value;state.runtime.lastError=String(err?.message||err);}
      }else if(entry.type==='selector') values[entry.name]=Object.prototype.hasOwnProperty.call(entry,'selected') ? entry.selected : (evaluateSelectorRuntime(entry.value,node)[0] ?? '');
      else values[entry.name]=entry.value;
    });
    return values;
  }
  function evaluateRuntimeExpression(source,node,type='str'){
    const text=String(source??'');
    if(!text.trim())return type==='bool'?false:type==='int'?0:'';
    const ctx=runtimeContext(node);
    let value;
    try{
      value=Function('ctx','Math',`"use strict"; return (${text});`)(ctx,Math);
    }catch(err){throw new Error(`Expression error: ${err.message}`);}
    if(value===null)return null;
    if(type==='int'){
      if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Type error: int requires a finite number');
      return value;
    }
    if(type==='bool'){
      if(typeof value!=='boolean')throw new Error('Type error: bool requires true or false');
      return value;
    }
    if(type==='col'){
      if(typeof value!=='string')throw new Error('Type error: col requires a color string');
      parseColor(value);return value;
    }
    if(type==='selector'){
      if(typeof value!=='string')throw new Error('Type error: selector requires a string');
      return value;
    }
    return String(value);
  }
  function evaluateSelectorRuntime(fn,node){
    try{
      const value=typeof fn==='function'?fn(runtimeContext(node)):Array.isArray(fn)?fn:[];
      return Array.isArray(value)?value.map(v=>String(v)):[];
    }catch(err){state.runtime.lastError=String(err?.message||err);return[];}
  }
  function runtimeBodyForNode(node){return (state.runtime.bodies||[]).find(b=>b.node?.id===node?.id)||null;}
  function runtimeVariableArray(scope,node){
    if(scope==='Global')return state.runtime.globalVariables||[];
    if(scope==='Scene')return runtimeSceneVariables(state.runtime.sceneId);
    return state.runtime.localVarsByNode?.[node?.id]||[];
  }
  function runtimeSetVariable(scope,name,value,node){
    if(name===null||name===undefined||value===null||value===undefined)return false;
    const list=runtimeVariableArray(scope,node);const v=list.find(x=>x.name===name);if(!v)return false;
    if(v.dataType==='Bool')v.value=!!value;
    else if(v.dataType==='Int')v.value=Number(value);
    else v.value=String(value);
    return true;
  }
  function runtimeSetComponent(node,type,mutator){
    if(!node)return null;
    let c=component(node,type);if(!c){try{c=createComponent(type);node.components.push(c);}catch{return null;}}
    mutator(c);normalizeNode(node);return c;
  }
  async function prepareRuntimeMic(){
    ensureGameSettings();
    if(state.game.requirements?.['Use Mic']!==true)return null;
    if(!window.UIXRuntimeEngine?.prepareMicrophone)throw new Error('Microphone runtime support is unavailable');
    const stream=await window.UIXRuntimeEngine.prepareMicrophone(state.game);
    const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext)throw new Error('Web Audio is unavailable');
    const audioContext=new AudioContext();const source=audioContext.createMediaStreamSource(stream);const analyser=audioContext.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.15;source.connect(analyser);
    return {enabled:true,decibel:-100,speech:'',stream,audioContext,source,analyser,buffer:new Uint8Array(analyser.fftSize),speechRecognition:null,speechActive:false,pickupActive:false};
  }
  function cleanupRuntimeMic(){
    const mic=state.runtime?.mic;if(!mic)return;
    try{if(mic.speechRecognition){mic.speechActive=false;mic.speechRecognition.onend=null;mic.speechRecognition.stop();}}catch{}
    try{mic.source?.disconnect();}catch{}
    try{mic.audioContext?.close();}catch{}
    try{mic.stream?.getTracks?.().forEach(t=>t.stop());}catch{}
    if(state.runtime?.mic)state.runtime.mic={enabled:false,decibel:-100,speech:'',stream:null,audioContext:null,source:null,analyser:null,buffer:null,speechRecognition:null,speechActive:false,pickupActive:false};
  }
  function updateRuntimeMic(){
    const mic=state.runtime?.mic;if(!mic?.enabled||!mic.analyser||!mic.buffer)return;
    mic.analyser.getByteTimeDomainData(mic.buffer);let sum=0;for(const v of mic.buffer){const d=(v-128)/128;sum+=d*d;}
    const rms=Math.sqrt(sum/mic.buffer.length);mic.decibel=rms>0?Math.max(-100,20*Math.log10(rms)):-100;
    const picked=mic.decibel>-55;if(picked&&!mic.pickupActive)dispatchRuntimeEvent('onAudioPickup','pickup',{decibel:mic.decibel});mic.pickupActive=picked;
  }
  function runtimeStartSpeechRecognition(){
    const mic=state.runtime?.mic;if(!mic?.enabled)return false;
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Recognition){state.runtime.lastError='Speech recognition is not supported by this browser';return false;}
    try{if(mic.speechRecognition)runtimeStopSpeechRecognition();const rec=new Recognition();rec.lang=state.game.mic?.speechLanguage||'en-US';rec.continuous=state.game.mic?.continuous!==false;rec.interimResults=state.game.mic?.interimResults!==false;rec.onresult=e=>{let text='';for(let i=0;i<e.results.length;i++)text+=e.results[i][0]?.transcript||'';mic.speech=text.trim();};rec.onerror=e=>{if(e?.error!=='no-speech')state.runtime.lastError=`Speech recognition: ${e?.error||'error'}`;};rec.onend=()=>{mic.speechRecognition=null;if(mic.speechActive){setTimeout(()=>{if(mic.speechActive)runtimeStartSpeechRecognition();},50);}};mic.speechRecognition=rec;mic.speechActive=true;rec.start();return true;}catch(err){state.runtime.lastError=String(err?.message||err);return false;}
  }
  function runtimeStopSpeechRecognition(){const mic=state.runtime?.mic;if(!mic)return false;mic.speechActive=false;try{mic.speechRecognition?.stop();}catch{}mic.speechRecognition=null;return true;}

  function runtimeContext(node){
    const body=runtimeBodyForNode(node),text=node?component(node,'text'):null,sprite=node?component(node,'sprite'):null,anim=node?component(node,'animationsprite'):null,progress=node?component(node,'progressbar'):null,physics=node?component(node,'physics'):null,collider=node?component(node,'collider'):null;
    const locals=runtimeVariableArray('Local',node),globals=runtimeVariableArray('Global',node),sceneVars=runtimeVariableArray('Scene',node);
    const joy=Object.fromEntries((state.runtime.joysticks||[]).map(j=>[j.variable,{distance:j.distance||0,angle:j.angle||0,value_x:j.value_x||0,value_y:j.value_y||0}]));
    const velocity={};
    const setVX=v=>{if(body&&v!==null&&v!==undefined)body.vx=Number(v)||0;};
    const setVY=v=>{if(body&&v!==null&&v!==undefined)body.vy=Number(v)||0;};
    const setOmega=v=>{if(body&&v!==null&&v!==undefined)body.omega=(Number(v)||0)*Math.PI/180;};
    Object.defineProperties(velocity,{
      velocityX:{enumerable:true,get:()=>Number(body?.vx)||0,set:setVX},
      velocityY:{enumerable:true,get:()=>Number(body?.vy)||0,set:setVY},
      angularVelocity:{enumerable:true,get:()=>Number(body?.omega||0)*180/Math.PI,set:setOmega},
      x:{enumerable:true,get:()=>Number(body?.vx)||0,set:setVX},
      y:{enumerable:true,get:()=>Number(body?.vy)||0,set:setVY},
      vx:{enumerable:true,get:()=>Number(body?.vx)||0,set:setVX},
      vy:{enumerable:true,get:()=>Number(body?.vy)||0,set:setVY},
      omega:{enumerable:true,get:()=>Number(body?.omega)||0,set:v=>{if(body&&v!==null&&v!==undefined)body.omega=Number(v)||0;}},
      angularX:{enumerable:true,get:()=>Number(body?.omega||0)*180/Math.PI,set:setOmega},
      angular_velocity:{enumerable:true,get:()=>Number(body?.omega||0)*180/Math.PI,set:setOmega}
    });
    const ctx={
      local:Object.fromEntries(locals.map(v=>[v.name,v.value])),global:Object.fromEntries(globals.map(v=>[v.name,v.value])),scene:Object.fromEntries(sceneVars.map(v=>[v.name,v.value])),sceneVariables:Object.fromEntries(sceneVars.map(v=>[v.name,v.value])),
      transform:body?.t||component(node,'transform')||{},velocity,events:state.runtime.events||{key:createRuntimeKeyEventState(),lastKey:''},velocityX:Number(body?.vx)||0,velocityY:Number(body?.vy)||0,angularVelocity:Number(body?.omega||0)*180/Math.PI,angularX:Number(body?.omega||0)*180/Math.PI,text:text||{},sprite:sprite||{},animations:anim?.animations||[],progressBar:progress||{},physics:physics||{},collider:collider||{},node,scene:state.runtime.scene,sceneList:state.scenes,keybinds:keybindOptions(),inputs:state.runtime.inputs||{},joystick:joy,joysticksList:sceneJoysticks(state.runtime.scene).map(j=>({variable:j.variable})),mic:{get decibel(){return Number(state.runtime.mic?.decibel)||-100;},get speech(){return String(state.runtime.mic?.speech||'');},get active(){return !!state.runtime.mic?.enabled;},get speechActive(){return !!state.runtime.mic?.speechActive;}},startSpeechRecognition:runtimeStartSpeechRecognition,stopSpeechRecognition:runtimeStopSpeechRecognition,allNodes:runtimeAllNodes().map(x=>x.node),folderOptions:runtimeAllNodes().filter(x=>x.node?.type==='folder').map(x=>`${x.node.name} [${x.node.numericId}]`),spriteAssets:state.assets.Sprite||[],audioAssets:[...(state.assets.Audio||[]), ...(state.assets.MIDI||[])],midiAssets:state.assets.MIDI||[],
      TouchUpX:Number(state.runtime.inputs?.TouchUpX)||0,TouchUpY:Number(state.runtime.inputs?.TouchUpY)||0,TouchDownX:Number(state.runtime.inputs?.TouchDownX)||0,TouchDownY:Number(state.runtime.inputs?.TouchDownY)||0,TouchMoveX:Number(state.runtime.inputs?.TouchMoveX)||0,TouchMoveY:Number(state.runtime.inputs?.TouchMoveY)||0,
      MouseUpX:Number(state.runtime.inputs?.MouseUpX)||0,MouseUpY:Number(state.runtime.inputs?.MouseUpY)||0,MouseDownX:Number(state.runtime.inputs?.MouseDownX)||0,MouseDownY:Number(state.runtime.inputs?.MouseDownY)||0,MouseMoveX:Number(state.runtime.inputs?.MouseMoveX)||0,MouseMoveY:Number(state.runtime.inputs?.MouseMoveY)||0,
      ScreenUpX:Number(state.runtime.inputs?.ScreenUpX)||0,ScreenUpY:Number(state.runtime.inputs?.ScreenUpY)||0,ScreenDownX:Number(state.runtime.inputs?.ScreenDownX)||0,ScreenDownY:Number(state.runtime.inputs?.ScreenDownY)||0,ScreenMoveX:Number(state.runtime.inputs?.ScreenMoveX)||0,ScreenMoveY:Number(state.runtime.inputs?.ScreenMoveY)||0,
      setVariable:(scope,name,value)=>runtimeSetVariable(scope,name,value,node),
      setTransform:(x,y,sx,sy,angle)=>{const b=runtimeBodyForNode(node);if(b){if(x!==null&&x!==undefined)b.t.position[0]=Number(x);if(y!==null&&y!==undefined)b.t.position[1]=Number(y);if(sx!==null&&sx!==undefined)b.t.scale[0]=Number(sx);if(sy!==null&&sy!==undefined)b.t.scale[1]=Number(sy);if(angle!==null&&angle!==undefined)b.t.angle[0]=Number(angle);}},
      setNode:(name,id)=>{if(node){if(name!==null&&name!==undefined)node.name=String(name);if(id!==null&&id!==undefined){const n=Number(id);if(Number.isFinite(n))node.numericId=n;}}},
      setText:(v)=>runtimeSetComponent(node,'text',c=>{Object.keys(v||{}).forEach(k=>{if(v[k]===null||v[k]===undefined)return;const map={'Text':'txt','FG Color':'fgcol','BG Color':'bg','Font Size':'fontSize','Font Family':'fontFamily','PosX':'positionX','PosY':'positionY','Border':'border','Border Color':'borderColor','Border Width':'borderWidth'};const dest=map[k];if(dest==='positionX')c.position[0]=Number(v[k]);else if(dest==='positionY')c.position[1]=Number(v[k]);else if(dest==='borderColor'){c.border=c.border||{};c.border.color=v[k];}else if(dest==='borderWidth'){c.border=c.border||{};c.border.width=Number(v[k]);}else if(dest)c[dest]=v[k];});}),
      setSprite:(v)=>runtimeSetComponent(node,'sprite',c=>{if(v.Type!==null&&v.Type!==undefined)c.sourceType=v.Type;if(v.Sprite!==null&&v.Sprite!==undefined){c.name=v.Sprite;c.src=(state.assets.Sprite||[]).find(a=>a.name===v.Sprite)?.value||c.src;}if(v.Animation!==null&&v.Animation!==undefined)c.animation=v.Animation;if(v.Pixelated!==null&&v.Pixelated!==undefined)c.pixelated=!!v.Pixelated;}),
      setPhysics:(v)=>runtimeSetComponent(node,'physics',c=>Object.keys(v||{}).forEach(k=>{if(v[k]===null||v[k]===undefined)return;const map={'Fixed Rotation':'fixedRotation','isCollider':'isCollider','Body':'body','Gravity':'gravity','Friction':'friction','Bounciness':'bounciness'};const d=map[k];if(d)c[d]=v[k];})),
      setCollider:(v)=>runtimeSetComponent(node,'collider',c=>{if(v.Collider!==null&&v.Collider!==undefined)c.collidable=!!v.Collider;if(v.Type!==null&&v.Type!==undefined)c.shapeType=v.Type;c.transform=c.transform||{position:[0,0],scale:[1,1],angle:[0]};if(v.PosX!==null&&v.PosX!==undefined)c.transform.position[0]=Number(v.PosX);if(v.PosY!==null&&v.PosY!==undefined)c.transform.position[1]=Number(v.PosY);if(v.ScaleX!==null&&v.ScaleX!==undefined)c.transform.scale[0]=Number(v.ScaleX);if(v.ScaleY!==null&&v.ScaleY!==undefined)c.transform.scale[1]=Number(v.ScaleY);if(v.Angle!==null&&v.Angle!==undefined)c.transform.angle[0]=Number(v.Angle);}),
      setProgressBar:(v)=>runtimeSetComponent(node,'progressbar',c=>Object.keys(v||{}).forEach(k=>{if(v[k]===null||v[k]===undefined)return;const map={'Width':'width','Height':'height','Value':'value','Min':'min','Max':'max','PosX':'positionX','PosY':'positionY','BG Color':'bgCol','Fill Color':'fillCol','TL':'tl','TR':'tr','BR':'br','BL':'bl','Outline Color':'outlineColor','Outline Size':'outlineSize','Direction':'direction'};const d=map[k];if(d==='positionX')c.position[0]=Number(v[k]);else if(d==='positionY')c.position[1]=Number(v[k]);else if(d)c[d]=v[k];if(d==='tl'||d==='tr'||d==='br'||d==='bl')c.cornerRadius[['tl','tr','br','bl'].indexOf(d)]=Number(v[k]);})),
      setVelocity:(x,y,angular)=>{const b=runtimeBodyForNode(node);if(b){if(x!==null&&x!==undefined)b.vx=Number(x);if(y!==null&&y!==undefined)b.vy=Number(y);if(angular!==null&&angular!==undefined)b.omega=Number(angular)*Math.PI/180;}},
      setCamera:(v)=>{const c=state.runtime.camera||{};if(v.Enabled!==null&&v.Enabled!==undefined)c.enabled=!!v.Enabled;if(v.PosX!==null&&v.PosX!==undefined)c.x=Number(v.PosX),c.baseX=c.x;if(v.PosY!==null&&v.PosY!==undefined)c.y=Number(v.PosY),c.baseY=c.y;if(v.Angle!==null&&v.Angle!==undefined)c.angle=Number(v.Angle),c.baseAngle=c.angle;if(v.Horizontal!==null&&v.Horizontal!==undefined)c.horizontal=Number(v.Horizontal);if(v.Vertical!==null&&v.Vertical!==undefined)c.vertical=Number(v.Vertical);if(v.Animation!==null&&v.Animation!==undefined)c.followAnimation=v.Animation;if(v.Speed!==null&&v.Speed!==undefined)c.speed=Number(v.Speed);if(v.Scale!==null&&v.Scale!==undefined)c.scale=Math.max(.01,Number(v.Scale));if(v['BG Color']!==null&&v['BG Color']!==undefined)c.bgColor=v['BG Color'];if(v.Follow!==null&&v.Follow!==undefined){const t=runtimeAllNodes().find(({node:n})=>`${n.name} [${n.numericId}]`===String(v.Follow));c.followId=t?.node.id||((String(v.Follow).toLowerCase()==='this')?node?.id:'this');}},
      followObject:(label,speed)=>{const t=runtimeAllNodes().find(({node:n})=>`${n.name} [${n.numericId}]`===String(label));if(t)state.runtime.followTargets[node.id]={targetId:t.node.id,speed:Math.max(0,Number(speed)||0)};},
      chase:(mapLabel,label,speed)=>{const t=runtimeAllNodes().find(({node:n})=>`${n.name} [${n.numericId}]`===String(label));if(t){const old=state.runtime.aiTargets[node.id];const next={...(old||{}),kind:'chase',map:String(mapLabel||''),targetId:t.node.id,speed:Math.max(0,Number(speed)||0)};if(old&& (old.map!==next.map||old.targetId!==next.targetId||old.speed!==next.speed)){next.path=null;next.pathIndex=0;}state.runtime.aiTargets[node.id]=next;}},
      avoid:(mapLabel,label,speed)=>{const t=runtimeAllNodes().find(({node:n})=>`${n.name} [${n.numericId}]`===String(label));if(t)state.runtime.aiTargets[node.id]={kind:'avoid',map:String(mapLabel||''),targetId:t.node.id,speed:Math.max(0,Number(speed)||0)};},
      destroyObject:()=>runtimeDestroyNode(node),
      createObject:(label,x,y,angle,vx,vy,angular)=>{const t=runtimeAllNodes().find(({node:n})=>`${n.name} [${n.numericId}]`===String(label));if(t)runtimeAddObject(t.node.id,x,y,angle,vx,vy,angular);},
      playAudio:(v)=>runtimePlayAudio(v),stopAudio:()=>runtimeStopAudio(),clearAudio:()=>runtimeClearAudio(),
      isCollidedWith:(label)=>runtimeIsCollided(node,label),
      runtime:state.runtime,
      loadScene:(name)=>{const s=state.scenes.find(v=>v.name===name);if(s)state.runtime.pendingSceneId=s.id;}
    };
    sceneJoysticks(state.runtime.scene).forEach(j=>{const st=(state.runtime.joysticks||[]).find(x=>x.variable===j.variable)||{};const base=j.variable||'joystick';ctx[`${base}_distance`]=Number(st.distance)||0;ctx[`${base}_angle`]=Number(st.angle)||0;ctx[`${base}_value_x`]=Number(st.value_x)||0;ctx[`${base}_value_y`]=Number(st.value_y)||0;});
    return ctx;
  }
  let runtimeMIDIContext=null;
  function runtimeMIDIBytes(value){
    if(value instanceof Uint8Array)return value;
    if(value instanceof ArrayBuffer)return new Uint8Array(value);
    if(typeof value!=='string')throw new Error('Invalid MIDI asset data');
    const comma=value.indexOf(',');
    const encoded=comma>=0?value.slice(comma+1):value;
    const bin=atob(encoded);
    const out=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
    return out;
  }
  function runtimeMIDISecondsMap(song){
    const ppq=Math.max(1,Number(song?.ppq||song?.ticksPerQuarter||480));
    const tempos=Array.isArray(song?.tempos)?song.tempos.slice().sort((a,b)=>Number(a.tick)-Number(b.tick)):[];
    const firstUs=60000000/Math.max(1,Number(song?.bpm)||120);
    return tick=>{
      let lastTick=0,lastSec=0,us=firstUs;
      for(const ev of tempos){
        const et=Math.max(0,Number(ev.tick)||0);
        if(et>tick)break;
        if(et>lastTick)lastSec+=(et-lastTick)*us/1000000/ppq;
        lastTick=et;
        const bpm=Number(ev.bpm);if(Number.isFinite(bpm)&&bpm>0)us=60000000/bpm;
      }
      return lastSec+Math.max(0,tick-lastTick)*us/1000000/ppq;
    };
  }
  function runtimePlayMIDI(asset,v){
    const parser=window.UIXMIDIParser;
    if(!parser?.parse)throw new Error('Offline MIDI parser is unavailable');
    const song=parser.parse(runtimeMIDIBytes(asset.value));
    const notes=[];
    const tickToSec=runtimeMIDISecondsMap(song);
    (song.tracks||[]).forEach((track,ti)=>{
      (track.notes||[]).forEach(note=>{
        const tick=Number(note.tick)||0,durTicks=Math.max(1,Number(note.duration)||1);
        const start=tickToSec(tick),end=tickToSec(tick+durTicks);
        notes.push({start,end:Math.max(start+0.01,end),pitch:Math.max(0,Math.min(127,Number(note.pitch)||0)),velocity:Math.max(1,Math.min(127,Number(note.velocity)||100)),track:ti});
      });
    });
    notes.sort((a,b)=>a.start-b.start||a.pitch-b.pitch);
    const songDuration=notes.reduce((m,n)=>Math.max(m,n.end),0);
    if(!songDuration)return null;
    if(!runtimeMIDIContext)runtimeMIDIContext=new (window.AudioContext||window.webkitAudioContext)();
    const audio=runtimeMIDIContext;
    if(audio.state==='suspended')audio.resume();
    const master=audio.createGain();master.gain.value=1;master.connect(audio.destination);
    const oscillators=new Set();let timer=0,cursor=0,loops=0,stopped=false;
    const lookAhead=0.18,intervalMs=40,startAt=Math.min(songDuration,Math.max(0,Number(v?.start)||0)/1000),maxDuration=Math.max(0,Number(v?.duration)||0)/1000;
    const stopAt=maxDuration>0?Math.min(songDuration,startAt+maxDuration):songDuration;
    let base=audio.currentTime-startAt;
    while(cursor<notes.length&&notes[cursor].end<=startAt)cursor++;
    const fadeIn=Math.max(0,Number(v?.fadein)||0)/1000,fadeOut=Math.max(0,Number(v?.fadeout)||0)/1000;
    const wave=['sine','triangle','square','sawtooth'];
    let player;
    const cleanup=()=>{if(stopped)return;stopped=true;if(timer)clearTimeout(timer);oscillators.forEach(o=>{try{o.stop();}catch{}});oscillators.clear();try{master.disconnect();}catch{}};
    if(fadeIn>0){master.gain.setValueAtTime(0,base);master.gain.linearRampToValueAtTime(1,base+fadeIn);}
    const finish=()=>{cleanup();state.runtime.audio=state.runtime.audio.filter(x=>x!==player);};
    const scheduleNote=(n,when)=>{
      const osc=audio.createOscillator(),gain=audio.createGain(),dur=Math.max(0.01,n.end-Math.max(n.start,startAt)),vol=0.2*(n.velocity/127);
      osc.type=wave[n.track%wave.length];osc.frequency.value=440*Math.pow(2,(n.pitch-69)/12);
      gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(vol,when+Math.min(0.008,dur*.25));
      gain.gain.setValueAtTime(vol,when+Math.max(0.009,dur-Math.min(0.012,dur*.2)));gain.gain.linearRampToValueAtTime(0,when+dur);
      osc.connect(gain).connect(master);osc.start(when);osc.stop(when+dur+0.02);oscillators.add(osc);osc.onended=()=>oscillators.delete(osc);
    };
    player={type:'midi',pause:()=>{cleanup();state.runtime.audio=state.runtime.audio.filter(x=>x!==player);}};
    const schedule=()=>{
      if(stopped)return;
      const now=audio.currentTime-base;
      if(now>=stopAt){
        if(v?.loop&&maxDuration<=0){loops++;base=audio.currentTime-startAt;cursor=0;while(cursor<notes.length&&notes[cursor].end<=startAt)cursor++;master.gain.cancelScheduledValues(audio.currentTime);master.gain.setValueAtTime(1,audio.currentTime);return schedule();}
        if(fadeOut>0){const t=audio.currentTime;master.gain.cancelScheduledValues(t);master.gain.setValueAtTime(master.gain.value,t);master.gain.linearRampToValueAtTime(0,t+fadeOut);setTimeout(finish,fadeOut*1000+60);}else finish();
        return;
      }
      const horizon=Math.min(stopAt,now+lookAhead);
      while(cursor<notes.length&&notes[cursor].start<=horizon){const n=notes[cursor++];if(n.end<=startAt||n.end<=now)continue;const when=base+Math.max(n.start,startAt);if(when<audio.currentTime-0.01)continue;scheduleNote({...n,end:Math.min(n.end,stopAt)},when);}
      timer=setTimeout(()=>{timer=0;schedule();},intervalMs);
    };
    state.runtime.audio.push(player);schedule();return player;
  }
  function runtimePlayAudio(v){
    const name=typeof v==='string'?v:v?.src;
    const asset=[...(state.assets.Audio||[]),...(state.assets.MIDI||[])].find(a=>a.name===name);if(!asset?.value)return;
    try{
      const isMIDI=asset.kind==='MIDI'||asset.type==='audio/midi'||/\.(mid|midi)$/i.test(asset.filename||'');
      if(isMIDI){runtimePlayMIDI(asset,v);return;}
      const audio=new Audio(asset.value);audio.loop=!!v?.loop;const start=Math.max(0,Number(v?.start)||0),duration=Math.max(0,Number(v?.duration)||0);audio.addEventListener('loadedmetadata',()=>{try{audio.currentTime=Math.min(start,Math.max(0,(audio.duration||start)-0.001));}catch{}});if(duration>0)setTimeout(()=>{try{audio.pause();}catch{}},duration);audio.play?.();state.runtime.audio.push(audio);audio.onended=()=>{state.runtime.audio=state.runtime.audio.filter(a=>a!==audio);};
    }catch(err){state.runtime.lastError=String(err?.message||err);}
  }
  function runtimeStopAudio(){(state.runtime.audio||[]).forEach(a=>{try{a.pause();}catch{}});}
  function runtimeClearAudio(){runtimeStopAudio();state.runtime.audio=[];}
  function routeRuntimeOutput(sourceSn,outputId){
    const sourceNode=runtimeNodeForScript(sourceSn);if(!sourceNode)return;
    const lists=Object.values(state.runtime.dynamicConnectionsByNode||{});
    for(const list of lists){if(!Array.isArray(list))continue;const c=list.find(x=>x.from===sourceSn.id&&x.output===outputId);if(!c)continue;const targetNode=runtimeFindNode((runtimeScriptList(sourceNode.id).find(x=>x.id===c.to)?sourceNode.id:null));
      let targetScript=null,targetOwner=null;
      for(const [owner,arr] of Object.entries(state.runtime.dynamicScriptsByNode||{})){const hit=(Array.isArray(arr)?arr:[]).find(x=>x.id===c.to);if(hit){targetScript=hit;targetOwner=owner;break;}}
      if(targetScript){executeRuntimeScriptNode(targetScript,scriptNodeDefinition(targetScript.defName),runtimeFindNode(targetOwner),false);}
    }
  }
  function executeRuntimeScriptNode(sn,def,node,isEvent=false){
    if(!sn||!def||!node)return null;
    if(!scriptRequirementEnabled(def))return null;
    if(def.receiver && !isEvent && def.name==='Interval'){const key=sn.id;state.runtime.intervalStates[key] ||= {active:false,next:0};const st=state.runtime.intervalStates[key];st.active=true;st.ms=Math.max(1,Number(runtimeValuesForScript(sn,node).Milliseconds)||1000);st.next=performance.now()+st.ms;return null;}
    if(def.receiver && !isEvent && def.name==='Timeout'){const key=sn.id,now=performance.now(),v=runtimeValuesForScript(sn,node);state.runtime.timers.push({kind:'timeout',key,nodeId:node.id,at:now+Math.max(0,Number(v.Milliseconds)||0)});return null;}
    const ctx=runtimeContext(node);const values=runtimeValuesForScript(sn,node);
    let result={};
    try{result=def.func(ctx,values)||{};}catch(err){state.runtime.lastError=String(err?.message||err);return null;}
    Object.entries(result||{}).forEach(([out,val])=>{if(val)routeRuntimeOutput(sn,out);});
    return result;
  }
  function runRuntimeSceneScripts(){
    runtimeAllNodes().filter(({node})=>node.type==='node').forEach(({node})=>runtimeScriptList(node.id).filter(sn=>sn.defName==='onLoad').forEach(sn=>executeRuntimeScriptNode(sn,scriptNodeDefinition(sn.defName),node,true)));
  }
  function runRuntimeUnloadScripts(){
    runtimeAllNodes().filter(({node})=>node.type==='node').forEach(({node})=>runtimeScriptList(node.id).filter(sn=>sn.defName==='onUnload').forEach(sn=>executeRuntimeScriptNode(sn,scriptNodeDefinition(sn.defName),node,true)));
  }
  function processRuntimeTimers(now){
    const due=(state.runtime.timers||[]);state.runtime.timers=[];
    due.forEach(t=>{if(t.kind==='timeout'&&now>=t.at){const node=runtimeFindNode(t.nodeId);const sn=runtimeScriptList(t.nodeId).find(x=>x.id===t.key);if(node&&sn){routeRuntimeOutput(sn,'next');routeRuntimeOutput(sn,'out');}}else state.runtime.timers.push(t);});
    Object.entries(state.runtime.intervalStates||{}).forEach(([id,st])=>{if(!st.active||now<st.next)return;let n=0;while(now>=st.next&&n++<8){const hit=Object.values(state.runtime.dynamicScriptsByNode||{}).flatMap(v=>Array.isArray(v)?v:[]).find(sn=>sn.id===id);if(hit){routeRuntimeOutput(hit,'next');routeRuntimeOutput(hit,'out');}st.next+=st.ms;}});
  }

  function createRuntimeKeyEventState(){
    const key=Object.create(null);
    keybindOptions().forEach(k=>{key[k]=false;});
    return key;
  }
  function setRuntimeKeyEvent(key){
    if(!state.runtime.events) state.runtime.events={key:createRuntimeKeyEventState(),lastKey:''};
    if(!state.runtime.events.key) state.runtime.events.key=createRuntimeKeyEventState();
    const name=String(key||'');
    if(!name)return;
    if(!Object.prototype.hasOwnProperty.call(state.runtime.events.key,name)) state.runtime.events.key[name]=false;
    state.runtime.events.key[name]=true;
    state.runtime.events.lastKey=name;
  }
  function clearRuntimeKeyEvents(){
    const keys=state.runtime.events?.key;if(!keys)return;
    Object.keys(keys).forEach(k=>{keys[k]=false;});
    if(state.runtime.events)state.runtime.events.lastKey='';
  }

  function dispatchRuntimeEvent(defName,eventType,values={},targetNodeId=null){

    if(!state.runtime.running)return;
    state.runtime.inputs=Object.assign(state.runtime.inputs||{},values);
    runtimeAllNodes().filter(({node})=>node.type==='node').forEach(({node})=>{
      // Pointer events are delivered only to the node under the pointer.
      // Keyboard/screen/joystick events remain broadcast when no target is supplied.
      if(targetNodeId && node.id!==targetNodeId)return;
      runtimeScriptList(node.id).forEach(sn=>{
        if(sn.defName!==defName)return;
        const def=scriptNodeDefinition(sn.defName);if(!def||def.receiver)return;
        const first=flattenEditor(sn.values)[0]?.entry;
        if(first?.type==='selector'){
          const selected=first.selected??'';
          if(defName==='onKeybind' && selected!==values.key)return;
          if(['onTouch','onMouse','onScreenInput'].includes(defName) && selected!==eventType)return;
          if(defName==='onJoystick' && selected!==values.Variable)return;
          if(defName==='onConnectionChange' && selected!==values.connection)return;
        }
        executeRuntimeScriptNode(sn,def,node,true);
      });
    });
  }
  function runtimeJoystickLayout(j,W=1280,H=720){const size=Array.isArray(j.size)?j.size:[110,110],w=Math.max(1,Number(size[0])||110),h=Math.max(1,Number(size[1])||110),p=j.position||{};const x=p.left!=null?Number(p.left)+w/2:p.right!=null?W-Number(p.right)-w/2:W/2;const y=p.top!=null?Number(p.top)+h/2:p.bottom!=null?H-Number(p.bottom)-h/2:H/2;return{x,y,w,h,radius:Math.min(w,h)/2};}
  function runtimeJoystickAt(x,y){
    for(const j of sceneJoysticks(state.runtime.scene).slice().reverse()){
      const r=runtimeJoystickLayout(j),hitRadius=Math.max(r.w,r.h)*0.52;
      if(Math.hypot(x-r.x,y-r.y)<=hitRadius)return{j,r};
    }
    return null;
  }
  function runtimeProjection(canvas){
    const rect=canvas?.getBoundingClientRect?.()||{width:1,height:1};
    const width=Math.max(1,rect.width),height=Math.max(1,rect.height);
    const type=normalizeScreenType(state.game.screenType);
    const baseW=1280,baseH=720;
    let viewW=baseW,viewH=baseH,scaleX=width/baseW,scaleY=height/baseH,offsetX=0,offsetY=0;
    if(type==='Windowboxing'){
      const s=Math.min(width/baseW,height/baseH);scaleX=scaleY=s;offsetX=(width-baseW*s)/2;offsetY=(height-baseH*s)/2;
    }else if(type==='Stretch'){
      scaleX=width/baseW;scaleY=height/baseH;
    }else if(type==='Crop'){
      const s=Math.max(width/baseW,height/baseH);scaleX=scaleY=s;offsetX=(width-baseW*s)/2;offsetY=(height-baseH*s)/2;
    }else{
      const s=height/baseH;scaleX=scaleY=s;viewW=width/s;viewH=baseH;
    }
    return {width,height,type,baseW,baseH,viewW,viewH,scaleX,scaleY,offsetX,offsetY,dpr:Math.max(1,Number(window.devicePixelRatio)||1)};
  }
  function runtimePointerPosition(e){
    const canvas=$('#runtimeCanvas');
    if(!canvas)return null;
    const r=runtimeProjection(canvas);
    const px=e.clientX-canvas.getBoundingClientRect().left,py=e.clientY-canvas.getBoundingClientRect().top;
    return {x:(px-r.offsetX)/r.scaleX+((r.viewW-r.baseW)/2),y:(py-r.offsetY)/r.scaleY};
  }
  function updateRuntimeJoystick(e,type){
    const p=runtimePointerPosition(e); if(!p)return false;
    const active=state.runtime.activeJoystickPointers ||= Object.create(null);
    let stateEntry=active[e.pointerId];
    if(type==='down'){
      const hit=runtimeJoystickAt(p.x,p.y);
      if(!hit)return false;
      const dx=p.x-hit.r.x,dy=p.y-hit.r.y;
      const d=Math.hypot(dx,dy);
      const knobRadius=Math.min(hit.r.w,hit.r.h)*0.22;
      const grabbedKnob=d<=hit.r.radius*0.7;
      stateEntry={variable:hit.j.variable,offsetX:grabbedKnob?dx:0,offsetY:grabbedKnob?dy:0};
      active[e.pointerId]=stateEntry;
      canvasPointerCapture(e);
    }
    if(!stateEntry)return false;
    const j=sceneJoysticks(state.runtime.scene).find(v=>v.variable===stateEntry.variable);
    if(!j)return false;
    const r=runtimeJoystickLayout(j);
    if(type==='up'||type==='cancel'){
      const st=(state.runtime.joysticks||[]).find(v=>v.variable===stateEntry.variable);
      if(st){st.distance=0;st.angle=0;st.value_x=0;st.value_y=0;}
      delete active[e.pointerId];
      dispatchRuntimeEvent('onJoystick',type,{Variable:stateEntry.variable});
      return true;
    }
    let dx=p.x-r.x-stateEntry.offsetX,dy=p.y-r.y-stateEntry.offsetY;
    const rad=Math.max(1,r.radius);
    const d=Math.hypot(dx,dy);
    if(d>rad){const k=rad/d;dx*=k;dy*=k;}
    const st=(state.runtime.joysticks||[]).find(v=>v.variable===stateEntry.variable);
    if(!st)return false;
    const normalized=Math.min(1,Math.hypot(dx,dy)/rad);
    st.distance=normalized;
    st.angle=normalized===0?0:(Math.atan2(dy,dx)*180/Math.PI+360)%360;
    st.value_x=clamp(dx/rad,-1,1);
    st.value_y=clamp(dy/rad,-1,1);
    dispatchRuntimeEvent('onJoystick',type,{Variable:stateEntry.variable});
    return true;
  }
  function canvasPointerCapture(e){try{$('#runtimeCanvas')?.setPointerCapture?.(e.pointerId);}catch{}}
  function drawRuntimeUIComponents(ctx,W=1280,H=720){for(const st of state.runtime.joysticks||[]){const j=sceneJoysticks(state.runtime.scene).find(v=>v.variable===st.variable);if(!j)continue;const r=runtimeJoystickLayout(j,W,H),travel=Math.min(r.w,r.h)*.28,dx=(Number(st.value_x)||0)*travel,dy=(Number(st.value_y)||0)*travel;ctx.save();ctx.fillStyle=colorCss(j.bgColor,'rgba(51,51,51,.8)');ctx.beginPath();ctx.ellipse(r.x,r.y,r.w/2,r.h/2,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle=colorCss(j.knobColor,'#fff');ctx.beginPath();ctx.arc(r.x+dx,r.y+dy,Math.min(r.w,r.h)*.22,0,Math.PI*2);ctx.fill();ctx.restore();}}
  function runtimeNodeAtPoint(x,y){
    const ctx=$('#runtimeCanvas')?.getContext?.('2d');
    for(const {node} of runtimeAllNodes().slice().reverse()){
      if(node.type!=='node')continue;
      const t=component(node,'transform')||{position:[0,0],scale:[1,1],angle:[0]};
      const nx=Number(t.position?.[0]||0),ny=Number(t.position?.[1]||0);
      let dx=x-nx,dy=y-ny;
      const a=Number(t.angle?.[0]||0)*Math.PI/180;
      ({x:dx,y:dy}=rotatePoint(dx,dy,-a));
      const sx=Math.max(1e-6,Math.abs(Number(t.scale?.[0]||1))),sy=Math.max(1e-6,Math.abs(Number(t.scale?.[1]||1)));
      dx/=sx;dy/=sy;
      const geo=spriteLocalGeometry(node);
      if(geo){if(Math.abs(dx-geo.x)<=geo.w/2&&Math.abs(dy-geo.y)<=geo.h/2)return node;continue;}
      let size={w:90,h:54};
      const text=component(node,'text');if(text){const c=ctx||document.createElement('canvas').getContext('2d');size=getTextMetrics(node,text,c);}
      if(Math.abs(dx)<=size.w/2&&Math.abs(dy)<=size.h/2)return node;
    }
    return null;
  }
  function nodeInputValues(node,x,y,type){
    const t=component(node,'transform')||{};
    let dx=x-Number(t.position?.[0]||0),dy=y-Number(t.position?.[1]||0);
    const angle=Number(t.angle?.[0]||0)*Math.PI/180;
    ({x:dx,y:dy}=rotatePoint(dx,dy,-angle));
    const sx=Math.max(1e-6,Math.abs(Number(t.scale?.[0]||1))),sy=Math.max(1e-6,Math.abs(Number(t.scale?.[1]||1)));
    return {
      [`${type}X`]:dx/sx,
      [`${type}Y`]:dy/sy
    };
  }
  function installRuntimeInputHandlers(overlay){
    const canvas=$('#runtimeCanvas',overlay);if(!canvas)return;
    canvas.style.touchAction='none';
    overlay.tabIndex=0;overlay.focus?.();
    const screenPoint=(e)=>{
      const m=runtimeProjection(canvas),r=canvas.getBoundingClientRect();
      const px=e.clientX-r.left,py=e.clientY-r.top;
      return {x:(px-m.offsetX)/m.scaleX-m.viewW/2,y:(py-m.offsetY)/m.scaleY-m.viewH/2};
    };
    const worldPoint=(e)=>{
      const p=screenPoint(e),cam=state.runtime.camera||{};
      const zoom=Math.max(.0001,Number(cam.scale)||1);
      const a=Number(cam.angle||0)*Math.PI/180;
      const q=rotatePoint(p.x/zoom,p.y/zoom,-a);
      return {x:q.x+Number(cam.x||0),y:q.y+Number(cam.y||0)};
    };
    const activeTouchNodes=Object.create(null),activeMouseNodes=Object.create(null);
    const sendScreen=(type,e)=>{const p=screenPoint(e),prev=state.runtime.inputs||{},values={
      ScreenUpX:type==='up'?p.x:prev.ScreenUpX??p.x,ScreenUpY:type==='up'?p.y:prev.ScreenUpY??p.y,
      ScreenDownX:type==='down'?p.x:prev.ScreenDownX??p.x,ScreenDownY:type==='down'?p.y:prev.ScreenDownY??p.y,
      ScreenMoveX:type==='move'?p.x:prev.ScreenMoveX??p.x,ScreenMoveY:type==='move'?p.y:prev.ScreenMoveY??p.y
    };
    dispatchRuntimeEvent('onScreenInput',type,values);};
    const handlePointerDown=e=>{
      e.preventDefault();
      canvas.setPointerCapture?.(e.pointerId);
      const screen=screenPoint(e), world=worldPoint(e);
      updateRuntimeJoystick(e,'down');
      if(e.pointerType==='touch'){
        const node=runtimeNodeAtPoint(world.x,world.y);
        if(node){
          activeTouchNodes[e.pointerId]=node.id;
          dispatchRuntimeEvent('onTouch','down',nodeInputValues(node,world.x,world.y,'TouchDown'),node.id);
        }
      }else if(e.pointerType==='mouse' || !e.pointerType){
        const node=runtimeNodeAtPoint(world.x,world.y);
        if(node){
          activeMouseNodes[e.pointerId]=node.id;
          dispatchRuntimeEvent('onMouse','down',nodeInputValues(node,world.x,world.y,'MouseDown'),node.id);
        }
      }
      state.runtime.inputs.PointerType=e.pointerType||'mouse';
      state.runtime.inputs.PointerId=Number(e.pointerId)||0;
      sendScreen('down',e);
    };
    const handlePointerMove=e=>{
      e.preventDefault();
      updateRuntimeJoystick(e,'move');
      const world=worldPoint(e);
      const touchId=activeTouchNodes[e.pointerId],mouseId=activeMouseNodes[e.pointerId];
      if(e.pointerType==='touch'&&touchId){const node=runtimeFindNode(touchId);if(node)dispatchRuntimeEvent('onTouch','move',nodeInputValues(node,world.x,world.y,'TouchMove'),node.id);}
      if(e.pointerType==='mouse'&&mouseId){const node=runtimeFindNode(mouseId);if(node)dispatchRuntimeEvent('onMouse','move',nodeInputValues(node,world.x,world.y,'MouseMove'),node.id);}
      sendScreen('move',e);
    };
    const handlePointerUp=e=>{
      e.preventDefault();
      const world=worldPoint(e);
      updateRuntimeJoystick(e,'up');
      const touchId=activeTouchNodes[e.pointerId],mouseId=activeMouseNodes[e.pointerId];
      if(e.pointerType==='touch'&&touchId){const node=runtimeFindNode(touchId);if(node)dispatchRuntimeEvent('onTouch','up',nodeInputValues(node,world.x,world.y,'TouchUp'),node.id);delete activeTouchNodes[e.pointerId];}
      if(e.pointerType==='mouse'&&mouseId){const node=runtimeFindNode(mouseId);if(node)dispatchRuntimeEvent('onMouse','up',nodeInputValues(node,world.x,world.y,'MouseUp'),node.id);delete activeMouseNodes[e.pointerId];}
      sendScreen('up',e);
    };
    const handlePointerCancel=e=>{
      e.preventDefault();
      const world=worldPoint(e);updateRuntimeJoystick(e,'cancel');
      const touchId=activeTouchNodes[e.pointerId],mouseId=activeMouseNodes[e.pointerId];
      if(e.pointerType==='touch'&&touchId){const node=runtimeFindNode(touchId);if(node)dispatchRuntimeEvent('onTouch','up',nodeInputValues(node,world.x,world.y,'TouchUp'),node.id);delete activeTouchNodes[e.pointerId];}
      if(e.pointerType==='mouse'&&mouseId){const node=runtimeFindNode(mouseId);if(node)dispatchRuntimeEvent('onMouse','up',nodeInputValues(node,world.x,world.y,'MouseUp'),node.id);delete activeMouseNodes[e.pointerId];}
      sendScreen('up',e);
    };
    canvas.addEventListener('pointerdown',handlePointerDown,{passive:false});
    canvas.addEventListener('pointermove',handlePointerMove,{passive:false});
    canvas.addEventListener('pointerup',handlePointerUp,{passive:false});
    canvas.addEventListener('pointercancel',handlePointerCancel,{passive:false});
  }
  function normalizeRuntimeKey(e){
    if(!e) return '';
    if(e.key===' ') return 'Space';
    if(typeof e.key==='string' && /^[a-z]$/.test(e.key)) return e.key.toUpperCase();
    if(typeof e.code==='string') {
      if(/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
      if(/^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
    }
    return typeof e.key==='string' ? e.key : '';
  }
  function capitalize(v){return String(v).charAt(0).toUpperCase()+String(v).slice(1);}

  async function startRuntime(debug){
    ensureGameSettings();
    if(editorAnimationRAF){cancelAnimationFrame(editorAnimationRAF);editorAnimationRAF=0;}
    runtimeAccumulator=0;

    const preferred=state.scenes.find(s=>s.id===state.game.preferredSceneId)||currentScene();
    if(!preferred)return;
    let runtimeMic=null;
    try{runtimeMic=await prepareRuntimeMic();}catch(err){status(`Microphone permission failed: ${err.message||err}`);return;}
    const sceneClone=clone(preferred);ensureSceneCamera(sceneClone);hydrateRuntimeVariables(preferred.id);
    const dynamicScriptsByNode=Object.create(null),dynamicConnectionsByNode=Object.create(null);runtimeAllNodes(sceneClone).filter(({node})=>node.type==='node').forEach(({node})=>{dynamicScriptsByNode[node.id]=clone(state.script.nodesByNode[node.id]||[]);dynamicConnectionsByNode[node.id]=clone(state.script.connectionsByNode[node.id]||[]);});
    state.runtime={running:true,debug:!!debug,scene:sceneClone,sceneId:preferred.id,pendingSceneId:'',bodies:[],camera:runtimeCameraFromScene(sceneClone),timers:[],intervalStates:Object.create(null),signalQueue:[],audio:[],lastError:'',globalVariables:clone(state.globalVariables||[]),sceneVariablesByScene:clone(state.sceneVariablesByScene||{}),localVarsByNode:clone(state.localVarsByNode||{}),inputs:{},events:{key:createRuntimeKeyEventState(),lastKey:''},mic:runtimeMic||{enabled:false,decibel:-100,speech:'',stream:null,audioContext:null,source:null,analyser:null,buffer:null,speechRecognition:null,speechActive:false,pickupActive:false},dynamicScriptsByNode,dynamicConnectionsByNode,followTargets:Object.create(null),aiTargets:Object.create(null),joysticks:sceneJoysticks(sceneClone).map(j=>({variable:j.variable,distance:0,angle:0,value_x:0,value_y:0})),activeJoystickPointers:{}};
    state.runtime.bodies=buildRuntimeState(sceneClone); updateRuntimeCamera(0);

    if(window.__UIX_STANDALONE__){
      const root=$('#runtimeRoot')||document.body;
      const canvas=$('#runtimeCanvas')||(()=>{const c=document.createElement('canvas');c.id='runtimeCanvas';c.width=1280;c.height=720;c.style.cssText='display:block;width:100vw;height:100vh;touch-action:none;image-rendering:auto;';root.append(c);return c;})();
      if(root!==document.body)root.style.cssText=root.style.cssText||'position:fixed;inset:0;width:100vw;height:100vh;overflow:hidden;background:#111;display:grid;place-items:center;';
      applyRuntimeScreenType(root,canvas,state.game.screenType);
      canvas.style.touchAction='none';
      installRuntimeInputHandlers(root);
      runRuntimeSceneScripts();
      runtimeLast=performance.now();
      runtimeFrame=requestAnimationFrame(runtimeTick);
      return;
    }

    $('#runtimeOverlay')?.remove();
    const overlay=document.createElement('div');overlay.id='runtimeOverlay';overlay.innerHTML=`<div class="runtime-toolbar"><strong>${debug?'Debug':'Play'} · ${esc(sceneClone.name)}</strong><button type="button">■ Stop</button></div><div class="runtime-viewport"><canvas id="runtimeCanvas" width="1280" height="720"></canvas></div>${debug?'<div id="runtimeDebug" class="runtime-debug"></div>':''}`;document.body.append(overlay);$('button',overlay).onclick=stopRuntime;const overlayCanvas=$('#runtimeCanvas',overlay);applyRuntimeScreenType($('#runtimeOverlay .runtime-viewport',overlay),overlayCanvas,state.game.screenType);installRuntimeInputHandlers(overlay);runRuntimeSceneScripts();runtimeLast=performance.now();runtimeFrame=requestAnimationFrame(runtimeTick);
  }
  function stopRuntime(){state.runtime.running=false;cancelAnimationFrame(runtimeFrame);(state.runtime.audio||[]).forEach(a=>{try{a.pause();}catch{}});cleanupRuntimeMic();state.runtime.bodies=[];$('#runtimeOverlay')?.remove();if(!window.__UIX_STANDALONE__)drawWorkplace();}
  function runtimeTick(now){
    if(!state.runtime.running)return;
    let frameDt=Math.min(.05,Math.max(0,(now-runtimeLast)/1000));runtimeLast=now;runtimeAccumulator=Math.min(runtimeAccumulator+frameDt,.25);
    const fixedDt=1/60;let steps=0;
    while(runtimeAccumulator>=fixedDt&&steps<8){stepRuntime(fixedDt);runtimeAccumulator-=fixedDt;steps++;}
    drawRuntime();runtimeFrame=requestAnimationFrame(runtimeTick);
  }
  function renderRuntimeDebug(){const host=$('#runtimeDebug');if(!host)return;host.innerHTML='';const rows=[];(state.runtime.globalVariables||[]).filter(v=>v.debug).forEach(v=>rows.push(`${v.name}: ${v.value}`));runtimeSceneVariables().filter(v=>v.debug).forEach(v=>rows.push(`${v.name}: ${v.value}`));(state.runtime.bodies||[]).forEach(b=>(state.runtime.localVarsByNode?.[b.node?.id]||[]).filter(v=>v.debug).forEach(v=>rows.push(`${v.name}: ${v.value}`)));rows.forEach(txt=>{const div=document.createElement('div');div.textContent=txt;host.append(div);});}
  const RUNTIME_BASE_WIDTH=1280,RUNTIME_BASE_HEIGHT=720;
  function runtimeViewportMetrics(canvas){
    const m=runtimeProjection(canvas);
    const pw=Math.max(1,Math.round(m.width*m.dpr)),ph=Math.max(1,Math.round(m.height*m.dpr));
    if(canvas.width!==pw)canvas.width=pw;
    if(canvas.height!==ph)canvas.height=ph;
    return m;
  }
  function applyRuntimeScreenType(root,canvas,type){
    const t=normalizeScreenType(type);
    ['Windowboxing','Stretch','Crop','Smart Camera'].forEach(v=>{
      const slug=v==='Smart Camera'?'smart-camera':v.toLowerCase();
      root?.classList.toggle('screen-'+slug,t===v);
      root?.classList.toggle('uix-screen-'+slug,t===v);
      canvas?.classList.toggle('screen-'+slug,t===v);
      canvas?.classList.toggle('uix-screen-'+slug,t===v);
    });
    if(root)root.dataset.screenType=t;
    if(canvas)canvas.dataset.screenType=t;
  }
  function drawRuntime(){
    const c=$('#runtimeCanvas');if(!c)return;
    const ctx=c.getContext('2d');
    const m=runtimeViewportMetrics(c);
    const W=m.width,H=m.height,cam=state.runtime.camera||{x:0,y:0,angle:0,scale:1,bgColor:'#202020'};
    const zoom=Math.max(.01,Number(cam.scale)||1);
    ctx.setTransform(m.dpr,0,0,m.dpr,0,0);
    ctx.imageSmoothingEnabled=true;
    ctx.fillStyle=colorCss(cam.bgColor,'#202020');ctx.fillRect(0,0,W,H);

    ctx.save();
    ctx.translate(m.type==='Crop'?W/2:W/2,m.type==='Crop'?H/2:H/2);
    if(m.type==='Windowboxing'){
      ctx.translate(m.offsetX-W/2+m.baseW*m.scaleX/2,m.offsetY-H/2+m.baseH*m.scaleY/2);
      ctx.scale(m.scaleX*zoom,m.scaleY*zoom);
    }else if(m.type==='Stretch'){
      ctx.scale(m.scaleX*zoom,m.scaleY*zoom);
    }else if(m.type==='Crop'){
      ctx.scale(m.scaleX*zoom,m.scaleY*zoom);
    }else{
      ctx.scale(m.scaleX*zoom,m.scaleY*zoom);
    }
    ctx.rotate(Number(cam.angle||0)*Math.PI/180);
    ctx.translate(-Number(cam.x||0),-Number(cam.y||0));
    for(const b of state.runtime.bodies||[])drawNodeVisual(ctx,b.node,b.t.position[0],b.t.position[1],b.t.scale[0],b.t.scale[1],b.t.angle[0]);
    drawRuntimeColliders(ctx);
    ctx.restore();

    // Screen-space UI uses the logical screen box. Smart Camera expands/contracts
    // that box with the real display aspect ratio; Stretch/Crop/Windowboxing keep 1280x720.
    ctx.save();
    if(m.type==='Windowboxing'){
      ctx.translate(m.offsetX,m.offsetY);ctx.scale(m.scaleX,m.scaleY);
    }else if(m.type==='Stretch'){
      ctx.scale(m.scaleX,m.scaleY);
    }else if(m.type==='Crop'){
      ctx.translate(m.offsetX,m.offsetY);ctx.scale(m.scaleX,m.scaleY);
    }else{
      ctx.scale(m.scaleX,m.scaleY);
    }
    drawRuntimeUIComponents(ctx,m.viewW,m.viewH);
    ctx.restore();
    renderRuntimeDebug();
  }

  // ---------------- Events ----------------
  function setupLongPress(el,callback){el.addEventListener('pointerdown',e=>{if(e.button!==0)return;const startX=e.clientX,startY=e.clientY,timer=setTimeout(()=>callback(e),550);const move=ev=>{if(Math.hypot(ev.clientX-startX,ev.clientY-startY)>8){clearTimeout(timer);document.removeEventListener('pointermove',move);}};document.addEventListener('pointermove',move);document.addEventListener('pointerup',()=>{clearTimeout(timer);document.removeEventListener('pointermove',move);},{once:true});});}
  function installEvents(){
    document.addEventListener('pointerdown',e=>{
      const nativeSelect=e.target?.closest?.('select');
      if(nativeSelect&&e.button!==2){e.preventDefault();e.stopPropagation();openNativeSelect(nativeSelect);return;}
      const path=e.composedPath?e.composedPath():[];
      const insideInteractive=path.some(target=>target?.nodeType===1 && target.matches?.('.context-menu,.menu-trigger,.select-wrap,.floating-select-menu'));
      if(insideInteractive)return;
      const openOutsideClosable=$$('.context-menu.open').some(menu=>menu.dataset.closeOutside!=='false');
      if(openOutsideClosable || activeSelectMenu)closeMenus();
    },true);
    document.addEventListener('click',e=>{
      const act=e.target.closest('[data-action]');
      if(act){ action(act.dataset.action,act); return; }
      const menu=e.target.closest('[data-menu]');
      if(menu){ e.stopPropagation(); toggleMenu(menu.dataset.menu); return; }
      const sub=e.target.closest('[data-menu-sub]');
      if(sub){ e.stopPropagation(); toggleSubMenu(sub.dataset.menuSub,sub); return; }
      const toggle=e.target.closest('[data-toggle-panel]');
      if(toggle){ e.stopPropagation(); togglePanel(toggle.dataset.togglePanel); closeMenus(); return; }
      const restore=e.target.closest('[data-restore-panel]');
      if(restore){ const panel=restore.dataset.restorePanel==='selection'?'selectionPanel':'componentPanel'; state.panels[panel]=true; applyPanelState(); return; }
      const proj=e.target.closest('[data-project-action]');
      if(proj){ projectAction(proj.dataset.projectAction); return; }
      const mode=e.target.closest('[data-mode]');
      if(mode){ setMode(mode.dataset.mode); return; }
      const tab=e.target.closest('[data-asset-tab]');
      if(tab){ state.activeAssetTab=tab.dataset.assetTab; renderAssetManager(); return; }
    });
    $('#componentContent')?.addEventListener('pointerdown',e=>{const card=e.target.closest('.component-card[data-component-key]');if(!card||e.target.closest('.comp-actions'))return;state.ui.selectedComponentKey=card.dataset.componentKey;$$('.component-card.component-selected').forEach(el=>el.classList.remove('component-selected'));card.classList.add('component-selected');drawWorkplace();},{capture:true});
    window.addEventListener('online',()=>dispatchRuntimeEvent('onConnectionChange','Online',{connection:'Online'}));
    window.addEventListener('offline',()=>dispatchRuntimeEvent('onConnectionChange','Offline',{connection:'Offline'}));
    window.addEventListener('beforeunload',e=>{
      if(state.project?.created&&!window.__UIX_STANDALONE__){e.preventDefault();e.returnValue='';}
    });
    document.addEventListener('keydown',e=>{
      if(!state.runtime?.running&&state.project?.created&&(e.key==='F5'||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='r'))&&!e.shiftKey){e.preventDefault();e.stopPropagation();status('Reload blocked. Use the project controls to reload.');return;}
      if(state.runtime?.running){
        const key=normalizeRuntimeKey(e);
        if(key && !e.repeat){setRuntimeKeyEvent(key);dispatchRuntimeEvent('onKeybind','down',{key,code:e.code,repeat:false,shiftKey:!!e.shiftKey,ctrlKey:!!e.ctrlKey,altKey:!!e.altKey,metaKey:!!e.metaKey});}
        return;
      }
      // Escape fallback remains here for menus/modals that are not handled by the shared binding layer.
      if(e.key==='Escape' && !window.UIXKeyBinds?.findMatch?.(e,'editor')){
        if($('.context-menu.open')){closeMenus();return;}
        const topId=modalStack.at(-1),top=topId?$('#'+topId):null;if(top){closeModal(top);return;}
      }
    });  window.UIXKeyBinds?.registerHandler('editor',(command,data)=>{
    switch(command){
      case 'save': saveProjectToProjectStorage(); return;
      case 'new': action('new-project'); return;
      case 'open': openLoadChoice(); return;
      case 'copy': copyNode(); return;
      case 'cut': cutNode(); return;
      case 'paste': pasteNode(); return;
      case 'duplicate': pasteNode(); return;
      case 'export': action('export-project'); return;
      case 'rename': { const n=selectedNode(); if(n) promptModal('Rename Node','Node name',n.name||'Node',v=>{const next=String(v||'').trim();if(!next)return;pushHistory();n.name=next;renderAll();}); return; }
      case 'settings': openEditorSettings(); return;
      case 'contextMenu': { const n=selectedNode(); if(n){ const c=$('#workplaceCanvas')?.getBoundingClientRect(); mainNodeContextMenu(n,c?c.left+c.width/2:20,c?c.top+c.height/2:20); } return; }
      case 'delete': deleteSelectedNodes(); return;
      case 'selectAll': { const ids=allNodes().map(x=>x.node.id);state.selectedIds=ids;state.selectedId=ids.at(-1)||'scene-camera';state.selectionAnchorId=state.selectedId;renderAll();return; }
      case 'deselectAll': clearNodeSelection();renderAll();return;
      case 'undo': undo(); return;
      case 'redo': redo(); return;
      case 'snap': snapSelectedMainNode(); return;
      case 'frame': snapSelectedMainNode(); return;
      case 'next': moveMainSelection(1); return;
      case 'previous': moveMainSelection(-1); return;
      case 'fullscreen': toggleFullscreen(); return;
      case 'escape': if($('.context-menu.open'))closeMenus();else{const top=modalStack.at(-1)?$('#'+modalStack.at(-1)):null;if(top)closeModal(top);} return;
      case 'play': if(state.runtime.running)stopRuntime();else startRuntime(false); return;
      case 'zoomIn': state.zoom=clamp(state.zoom*1.1,.2,5);drawWorkplace();return;
      case 'zoomOut': state.zoom=clamp(state.zoom*.9,.2,5);drawWorkplace();return;
      case 'resetZoom': state.zoom=1;state.pan={x:0,y:0};drawWorkplace();return;
      case 'centerCamera': state.pan={x:0,y:0};drawWorkplace();return;
    }
  });
  window.UIXKeyBinds?.registerHandler('script',(command,data)=>{
    switch(command){
      case 'copy': copyScriptNodes();break;case 'cut':cutScriptNodes();break;case 'paste':pasteScriptNodes();break;case 'duplicate':pasteScriptNodes();break;
      case 'delete':requestDeleteScriptNodes(selectedScriptNodes().map(x=>x.id));break;case 'selectAll':state.script.selectedNodeIds=scriptList().map(x=>x.id);state.script.selectedNodeId=state.script.selectedNodeIds.at(-1)||null;renderScriptCanvas();break;
      case 'deselectAll':state.script.selectedNodeIds=[];state.script.selectedNodeId=null;renderScriptCanvas();break;case 'contextMenu':{const sn=selectedScriptNodes().at(-1);if(sn){const el=document.querySelector(`.script-node-card[data-script-id="${sn.id}"]`);const r=el?.getBoundingClientRect();scriptContextMenu(sn,r?r.left+r.width/2:20,r?r.top+r.height/2:20);}break;}case 'undo':undo();break;case 'redo':redo();break;case 'snap':{const sn=scriptList().find(x=>x.id===state.script.selectedNodeId)||selectedScriptNodes().at(-1);if(sn) snapScriptToNode(sn);}break;
      case 'frame':{const sn=scriptList().find(x=>x.id===state.script.selectedNodeId)||selectedScriptNodes().at(-1);if(sn)snapScriptToNode(sn);}break;case 'next':{const list=scriptList(),i=list.findIndex(x=>x.id===state.script.selectedNodeId),n=list[clamp((i<0?0:i)+1,0,list.length-1)];if(n){selectScriptNode(n,{});renderScriptCanvas();}}break;case 'previous':{const list=scriptList(),i=list.findIndex(x=>x.id===state.script.selectedNodeId),n=list[clamp((i<0?0:i)-1,0,list.length-1)];if(n){selectScriptNode(n,{});renderScriptCanvas();}}break;case 'escape':closeModal($('#scriptModal'));break;
      case 'zoomIn':state.script.zoom=clamp(state.script.zoom*1.1,.25,3);applyScriptTransform();break;case 'zoomOut':state.script.zoom=clamp(state.script.zoom*.9,.25,3);applyScriptTransform();break;case 'resetZoom':state.script.zoom=1;applyScriptTransform();break;
    }
  });
  window.UIXKeyBinds?.registerHandler('sprite',(command,data)=>window.UIXSpriteEditor?.handleShortcut?.(command,data));
  window.UIXKeyBinds?.registerHandler('midi',(command,data)=>window.UIXMIDIEditor?.handleShortcut?.(command,data));
  renderKeybindHints();

    document.addEventListener('contextmenu',e=>{if(e.target.closest('input,textarea,.select-button,.top-button,.mode-button'))return;});
    document.addEventListener('fullscreenchange',updateFullscreenButton);
    $('#modalBackdrop').addEventListener('click',e=>{
      const topId=modalStack.at(-1),top=topId?$('#'+topId):null;
      if(top?.dataset.closeOutside==='true') closeModal(top);
      e.stopPropagation();
    });
    $('#confirmModalOk').addEventListener('click',doConfirm);
    $('#exportProjectIcon')?.addEventListener('click',()=>openAssetSelector('Sprite',asset=>{state.project.exportSettings ||= {};state.project.exportSettings.iconAssetId=asset.id;state.project.exportSettings.iconName=asset.name;$('#exportProjectIcon').textContent=asset.name||'Select Sprite';updateExportPwaJson();}));
    $('#exportPwaEnabled')?.addEventListener('change',e=>{$('#exportPwaEditor').hidden=!e.target.checked;if(e.target.checked){exportPwaManifest=defaultPwaManifest($('#exportProjectName').value||state.project.name,$('#exportProjectVersion').value||'1.0.0');syncExportPwaFields();}});
    ['exportProjectName','exportProjectVersion'].forEach(id=>$('#'+id)?.addEventListener('input',()=>{if($('#exportPwaEnabled')?.checked){exportPwaManifest.name=$('#exportProjectName').value;exportPwaManifest.version=$('#exportProjectVersion').value||'1.0.0';syncExportPwaFields();}}));
    ['pwaName','pwaShortName','pwaStartUrl','pwaDisplay','pwaOrientation','pwaThemeColor','pwaBackgroundColor','pwaDescription'].forEach(id=>$('#'+id)?.addEventListener('change',updateExportPwaJson));
    $('#pwaApplyJson')?.addEventListener('click',applyPwaJson);
    $('#exportProjectDownload')?.addEventListener('click',downloadExportProject);
    $('#expressionInput').addEventListener('input',validateExpression);
    $('#colorWheel').addEventListener('pointerdown',e=>{e.currentTarget.setPointerCapture(e.pointerId);pickWheel(e);});
    $('#colorWheel').addEventListener('pointermove',e=>{if(e.buttons)pickWheel(e);});
    $('#colorTextInput').addEventListener('change',()=>{try{state.color.rgba=parseColor($('#colorTextInput').value);syncColorUI();}catch{status('Invalid color');}});
    $('#assetFileInput').addEventListener('change',e=>{if(e.target.files.length)importAssets(e.target.files);e.target.value='';});
    const assetDropZone=$('#assetModal');
    assetDropZone?.addEventListener('dragover',e=>{if(e.dataTransfer?.files?.length){e.preventDefault();e.stopPropagation();assetDropZone.classList.add('asset-drag-over');}});
    assetDropZone?.addEventListener('dragleave',e=>{if(!assetDropZone.contains(e.relatedTarget))assetDropZone.classList.remove('asset-drag-over');});
    assetDropZone?.addEventListener('drop',e=>{
      const files=e.dataTransfer?.files;
      if(!files?.length)return;
      e.preventDefault();e.stopPropagation();assetDropZone.classList.remove('asset-drag-over');
      const accepted=[],rejected=[];
      [...files].forEach(file=>{
        const name=String(file?.name||''),mime=String(file?.type||'').toLowerCase();
        const isImage=mime.startsWith('image/')||/\.svg$/i.test(name);
        const isAudio=mime.startsWith('audio/')||/\.(mp3|wav|ogg|m4a|uixaudio)$/i.test(name);
        if(isImage||isAudio)accepted.push(file);else rejected.push(name||'Unnamed file');
      });
      if(rejected.length)status(`Rejected: ${rejected.join(', ')}. Drag & Drop accepts only image or audio files.`);
      if(accepted.length)importAssets(accepted);
    });
    $('#projectFileInput')?.addEventListener('change',e=>{const file=e.target.files?.[0];if(file)importProjectFile(file);e.target.value='';});
    document.addEventListener('wheel',e=>{if(e.ctrlKey)e.preventDefault();},{passive:false});
    document.addEventListener('gesturestart',e=>e.preventDefault());document.addEventListener('gesturechange',e=>e.preventDefault());document.addEventListener('gestureend',e=>e.preventDefault());
  }

  window.UIXApp={showModal,closeModal,status,askConfirm,addSpriteAsset,replaceSpriteAsset,deleteSpriteAsset,saveSpriteFrames,openColorModal,refreshAssets:renderAssetManager,loadProjectBytes,startRuntime,stopRuntime,hasLoadedProject,isRuntimeRunning:()=>!!state.runtime?.running,showContextMenu,snapSelectedMainNode};
  function ensureViewportNotice(){
    let notice=$('#uixViewportNarrowNotice');
    if(!notice){
      notice=document.createElement('div');
      notice.id='uixViewportNarrowNotice';
      notice.className='uix-viewport-narrow-notice';
      notice.setAttribute('role','alertdialog');
      notice.setAttribute('aria-modal','true');
      notice.setAttribute('aria-live','assertive');
      notice.innerHTML='<div class="uix-viewport-narrow-card"><strong>The width is not ideal for editing.</strong><span>Try expanding the window or rotate your device if you are on mobile.</span></div>';
      document.body.append(notice);
    }
    return notice;
  }
  function installViewportLock(){
    if(window.__UIXViewportLockInstalled)return;
    window.__UIXViewportLockInstalled=true;
    const stop=e=>{
      if(!document.documentElement.classList.contains('uix-narrow-edit-lock'))return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    ['keydown','keyup','keypress','pointerdown','pointermove','pointerup','pointercancel','mousedown','mousemove','mouseup','touchstart','touchmove','touchend','click','dblclick','contextmenu','wheel','dragstart','drop'].forEach(type=>document.addEventListener(type,stop,true));
  }
  function setViewportEditLock(blocked){
    const root=document.documentElement;
    root.classList.toggle('uix-narrow-edit-lock',blocked);
    if(blocked){
      const active=document.activeElement;
      if(active&&typeof active.blur==='function')active.blur();
      try{window.getSelection?.()?.removeAllRanges?.();}catch{}
    }
  }
  function updateViewportNotice(){
    const app=$('#appShell');if(!app)return;
    const notice=ensureViewportNotice();
    const blocked=window.innerWidth<window.innerHeight && !app.classList.contains('exited') && !window.__UIX_STANDALONE__;
    notice.hidden=!blocked;
    setViewportEditLock(blocked);
    installViewportLock();
  }
  function updateTopbarModeRailPosition(){
    const bar=$('#topbar'),modes=$$('.top-part.part-modes',bar)[0];if(!bar||!modes)return;
    if(!bar.classList.contains('topbar-modes-rail'))return;
    const dock=$('#inspectorDock');
    if(dock&&!dock.hidden){
      const r=dock.getBoundingClientRect();
      modes.style.right=`${Math.max(8,window.innerWidth-r.left+8)}px`;
    }else modes.style.right='8px';
  }
  function applyTopbarAnchors(){
    const bar=$('#topbar');if(!bar)return;
    const parts=$$('.top-part',bar);
    const scene=parts.find(p=>p.classList.contains('scene-part'));
    const actions=parts.find(p=>p.classList.contains('part-actions'));
    const modes=parts.find(p=>p.classList.contains('part-modes'));
    const left=parts.find(p=>p.classList.contains('part-left'));
    const right=parts.find(p=>p.classList.contains('part-right'));
    const w=bar.clientWidth||window.innerWidth;
    const rail=w<760;
    const compact=w<1120 || rail;
    bar.classList.toggle('topbar-modes-rail',rail);
    bar.dataset.compact=compact?'true':'false';
    bar.style.width='100%';
    bar.style.minWidth='0';
    [left,scene,actions,modes,right].forEach(p=>{if(!p)return;p.style.gridColumn='';p.style.justifySelf='';p.style.position='';p.style.top='';p.style.right='';p.style.zIndex='';p.style.flexDirection='';});
    if(rail){
      bar.style.gridTemplateColumns='minmax(0,1fr) max-content max-content minmax(0,1fr)';
      if(left){left.style.gridColumn='1';left.style.justifySelf='start';}
      if(scene){scene.style.gridColumn='2';scene.style.justifySelf='center';}
      if(actions){actions.style.gridColumn='3';actions.style.justifySelf='center';}
      if(right){right.style.gridColumn='4';right.style.justifySelf='end';}
      if(modes){
        modes.style.position='fixed';
        modes.style.top='calc(var(--topbar-height) + 10px)';
        modes.style.zIndex='85';
        modes.style.flexDirection='column';
      }
      updateTopbarModeRailPosition();
    }else{
      bar.style.gridTemplateColumns='minmax(0,1fr) max-content max-content max-content minmax(0,1fr)';
      if(left){left.style.gridColumn='1';left.style.justifySelf='start';}
      if(scene){scene.style.gridColumn='2';scene.style.justifySelf='center';}
      if(actions){actions.style.gridColumn='3';actions.style.justifySelf='center';}
      if(modes){modes.style.gridColumn='4';modes.style.justifySelf='center';}
      if(right){right.style.gridColumn='5';right.style.justifySelf='end';}
    }
    updateViewportNotice();
  }
  window.addEventListener('resize',()=>{applyTopbarAnchors();updateViewportNotice();positionPanelRestoreRail();applyScriptPanelState();});

  async function bootstrapURLLoad(){
    if(window.__UIX_STANDALONE__) return;
    const raw=new URLSearchParams(location.search).get('load');
    if(!raw)return;
    await loadProjectFromURL(raw);
  }

  // Editor initialization and standalone runtime share this source file.
  installEditorServiceWorker();
  if(window.__UIX_STANDALONE__){
    document.documentElement.classList.add('uix-standalone');
  }else{
    state.scenes=[makeScene('Main')];state.currentSceneId=state.scenes[0].id;state.selectedIds=[];state.selectionAnchorId=null;ensureGameSettings();
    installEvents();enableWorkplace();enableScriptCanvas();enablePanelResize();renderAll();applyTopbarAnchors();
    const bootURL=new URLSearchParams(location.search).get('load');
    if(bootURL)bootstrapURLLoad();
    else restoreCurrentProjectFromSession().then(restored=>{if(!restored)showModal($('#projectModal'));else{hideAllModals();resetAutoSaveTimer();}}).catch(()=>showModal($('#projectModal')));
  }
})();
