(() => {
  'use strict';

  const defaults = [
    {name:'Save Project', command:'save', scope:'all', keys:'Ctrl+S'},
    {name:'New Project', command:'new', scope:'editor', keys:'Ctrl+N'},
    {name:'Open / Load', command:'open', scope:'editor', keys:'Ctrl+O'},
    {name:'Export', command:'export', scope:'editor', keys:'Ctrl+E'},
    {name:'Copy', command:'copy', scope:'all', keys:'Ctrl+C'},
    {name:'Cut', command:'cut', scope:'all', keys:'Ctrl+X'},
    {name:'Paste', command:'paste', scope:'all', keys:'Ctrl+V'},
    {name:'Duplicate', command:'duplicate', scope:'all', keys:'Ctrl+D'},
    {name:'Delete', command:'delete', scope:'all', keys:'Delete'},
    {name:'Backspace Delete', command:'delete', scope:'all', keys:'Backspace'},
    {name:'Rename', command:'rename', scope:'all', keys:'F2'},
    {name:'Select All', command:'selectAll', scope:'all', keys:'Ctrl+A'},
    {name:'Deselect All', command:'deselectAll', scope:'all', keys:'Ctrl+Shift+A'},
    {name:'Undo', command:'undo', scope:'all', keys:'Ctrl+Z'},
    {name:'Redo', command:'redo', scope:'all', keys:'Ctrl+Y'},
    {name:'Redo (Alternate)', command:'redo', scope:'all', keys:'Ctrl+Shift+Z'},
    {name:'Snap to Target', command:'snap', scope:'all', keys:'Ctrl+Q'},
    {name:'Escape / Close', command:'escape', scope:'all', keys:'Escape'},
    {name:'Open Context Menu', command:'contextMenu', scope:'all', keys:'Shift+F10'},

    {name:'Play / Stop', command:'play', scope:'editor', keys:'Space'},
    {name:'Fullscreen', command:'fullscreen', scope:'editor', keys:'F11'},
    {name:'Zoom In', command:'zoomIn', scope:'editor', keys:'Ctrl+='},
    {name:'Zoom Out', command:'zoomOut', scope:'editor', keys:'Ctrl+-'},
    {name:'Reset Zoom', command:'resetZoom', scope:'editor', keys:'Ctrl+0'},
    {name:'Center Camera', command:'centerCamera', scope:'editor', keys:'F'},
    {name:'Next Selection', command:'next', scope:'editor', keys:'ArrowDown'},
    {name:'Previous Selection', command:'previous', scope:'editor', keys:'ArrowUp'},
    {name:'Editor Settings', command:'settings', scope:'editor', keys:'Ctrl+.'},

    {name:'Play / Stop MIDI', command:'play', scope:'midi', keys:'Space'},
    {name:'Stop MIDI', command:'stop', scope:'midi', keys:'Enter'},
    {name:'Save MIDI', command:'saveMIDI', scope:'midi', keys:'Ctrl+S'},
    {name:'Export MIDI', command:'exportMIDI', scope:'midi', keys:'Ctrl+E'},
    {name:'Import MIDI', command:'importMIDI', scope:'midi', keys:'Ctrl+I'},
    {name:'Duplicate MIDI Selection', command:'duplicate', scope:'midi', keys:'Ctrl+D'},

    {name:'Save Sprite', command:'saveSprite', scope:'sprite', keys:'Ctrl+S'},
  ];

  const keyBinds = defaults.map(x => ({...x, func:(data)=>runCommand(x.command,data)}));
  const STORE='uix.editor.keybinds.v4';
  const handlers=new Map();
  let loaded=false;

  function runCommand(command,data={}){
    const scope=data.scope||'editor';
    const handler=handlers.get(scope)||handlers.get('all')||handlers.get('*');
    return handler?.(command,data);
  }
  function registerHandler(scope,fn){if(typeof fn==='function')handlers.set(scope,fn);return ()=>handlers.delete(scope);}
  function getAll(){return keyBinds;}
  function load(){
    if(loaded)return;
    loaded=true;
    try{
      const saved=JSON.parse(localStorage.getItem(STORE)||'null');
      keyBinds.forEach(k=>{const v=saved?.[k.command+'|'+k.name];if(typeof v==='string')k.keys=v;});
    }catch{}
  }
  function save(){const out={};keyBinds.forEach(k=>out[k.command+'|'+k.name]=k.keys||'');try{localStorage.setItem(STORE,JSON.stringify(out));}catch{} }
  function reset(){defaults.forEach(d=>{const k=keyBinds.find(x=>x.command===d.command&&x.name===d.name);if(k)k.keys=d.keys;});save();}
  function normalizeToken(v){
    const s=String(v||'').trim().toLowerCase();
    if(['ctrl','control'].includes(s))return 'Ctrl';
    if(['cmd','command','meta','⌘'].includes(s))return 'Meta';
    if(['alt','option'].includes(s))return 'Alt';
    if(s==='shift')return 'Shift';
    const map={esc:'Escape',spacebar:'Space',return:'Enter',del:'Delete',backspace:'Backspace',ins:'Insert',pgup:'PageUp',pgdn:'PageDown',left:'ArrowLeft',right:'ArrowRight',up:'ArrowUp',down:'ArrowDown','+':'=','=':'=','-':'-'};
    if(map[s])return map[s];
    if(/^f\d{1,2}$/i.test(s))return s.toUpperCase();
    if(s.length===1)return s.toUpperCase();
    return s.charAt(0).toUpperCase()+s.slice(1);
  }
  function parse(keys){return String(keys||'').split(/\s*,\s*|\s*\|\s*|\s+/).map(v=>v.trim()).filter(Boolean).map(combo=>combo.split('+').map(normalizeToken));}
  function eventParts(e){
    const out=[];
    if(e.ctrlKey)out.push('Ctrl');if(e.metaKey)out.push('Meta');if(e.altKey)out.push('Alt');if(e.shiftKey)out.push('Shift');
    let k=e.key;if(k===' ')k='Space';else if(k==='Esc')k='Escape';else if(k==='OS')k='Meta';else if(k.length===1)k=k.toUpperCase();else k=k.charAt(0).toUpperCase()+k.slice(1);if(k==='+')k='=';out.push(k);return out;
  }
  function matches(e,keys){
    const actual=eventParts(e),aMods=actual.filter(x=>['Ctrl','Meta','Alt','Shift'].includes(x)).sort().join('+'),aKey=actual.find(x=>!['Ctrl','Meta','Alt','Shift'].includes(x));
    return parse(keys).some(parts=>{const k=parts.find(x=>!['Ctrl','Meta','Alt','Shift'].includes(x)),mods=parts.filter(x=>['Ctrl','Meta','Alt','Shift'].includes(x)).sort().join('+'),metaEquivalent=(mods==='Ctrl'&&aMods==='Meta')||(mods==='Meta'&&aMods==='Ctrl');return k===aKey&&(mods===aMods||metaEquivalent);});
  }
  function findMatch(e,scope){
    load();
    const hits=keyBinds.filter(k=>k.keys&&(k.scope==='all'||k.scope===scope)&&matches(e,k.keys));
    hits.sort((a,b)=>(a.scope===scope?0:1)-(b.scope===scope?0:1));
    return hits[0]||null;
  }
  function display(keys){return String(keys||'').replace(/Meta/g,'⌘').replace(/Ctrl/g,'Ctrl').replace(/ArrowLeft/g,'←').replace(/ArrowRight/g,'→').replace(/ArrowUp/g,'↑').replace(/ArrowDown/g,'↓').replace(/Escape/g,'Esc').replace(/Backspace/g,'Backspace').replace(/Space/g,'Space');}
  function shortcutFor(command,scope='editor'){load();const k=keyBinds.find(x=>x.command===command&&(x.scope===scope||x.scope==='all'));return k?.keys||'';}

  load();
  if(window.UIX_EDITOR_CONTEXT!==false) document.addEventListener('keydown',e=>{
    const target=e.target;
    if(target?.classList?.contains('keybind-input'))return;
    const modal=target?.closest?.('.uix-midi-modal')||document.querySelector('.uix-midi-modal:not([hidden])');
    const script=target?.closest?.('#scriptModal')||document.querySelector('#scriptModal:not([hidden])');
    const sprite=target?.closest?.('.sprite-paint-modal')||document.querySelector('.sprite-paint-modal:not([hidden])');
    const scope=modal?'midi':script?'script':sprite?'sprite':'editor';
    const textEditing=!!target?.closest?.('input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],[role="combobox"]');
    // Editor shortcuts must never steal keys from an active text/value editor.
    // This applies to Ctrl/Cmd shortcuts, Delete/Backspace, function keys, and all other bindings.
    if(textEditing)return;
    const hit=findMatch(e,scope);if(!hit)return;
    if(hit.scope==='editor'&&window.UIXApp?.isRuntimeRunning?.())return;
    e.preventDefault();e.stopPropagation();hit.func({event:e,scope,command:hit.command,keyBind:hit,display:display(hit.keys)});
  },true);

  window.UIXKeyBinds={keyBinds,getAll,registerHandler,runCommand,load,save,reset,findMatch,display,shortcutFor,normalizeToken};
})();
