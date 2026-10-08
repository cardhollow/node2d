(() => {
  'use strict';

  const scriptNodes = [
    { name:'onLoad', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onTick', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onKeybind', receiver:false, group:'Events', output:[{id:'out'}], editor:[{name:'Keybind',type:'selector',value:ctx=>(ctx?.keybinds||['Enter',...Array.from({length:10},(_,i)=>String(i)),...Array.from({length:26},(_,i)=>String.fromCharCode(65+i))]),selected:'Enter'}], func:()=>({out:true}) },
    { name:'onTouch', receiver:false, group:'Events', output:[{id:'out'}], editor:[{name:'Event',type:'selector',value:()=>['up','down','move'],selected:'down'}], func:()=>({out:true}) },
    { name:'onMouse', receiver:false, group:'Events', output:[{id:'out'}], editor:[{name:'Event',type:'selector',value:()=>['up','down','move'],selected:'down'}], func:()=>({out:true}) },
    { name:'onPointer', label:'OnPointer', receiver:false, group:'Events', output:[{id:'out'}], editor:[{name:'Event',type:'selector',value:()=>['up','down','move'],selected:'down'}], func:()=>({out:true}) },
    { name:'onScreenInput', receiver:false, group:'Events', output:[{id:'out'}], editor:[{name:'Event',type:'selector',value:()=>['up','down','move'],selected:'down'}], func:()=>({out:true}) },
    { name:'onJoystick', receiver:false, group:'Events', output:[{id:'out'}], editor:[{name:'Variable',type:'selector',value:ctx=>(ctx?.joysticksList||[]).map(j=>j.variable),selected:''}], func:()=>({out:true}) },
    { name:'onAudioPickup', require:'Use Mic', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onInputFocus', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onInputChange', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onColorChange', label:'OnColorChange', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onInputBlur', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onConnectionChange', receiver:false, group:'Events', output:[{id:'out'}], editor:[{name:'Connection',type:'selector',value:()=>['Online','Offline'],selected:navigator.onLine?'Online':'Offline'}], func:()=>({out:true}) },
    { name:'onCollideWith', receiver:false, group:'Events', output:[{id:'next'},{id:'truth'}], editor:[{name:'Target',type:'selector',value:ctx=>(ctx?.allNodes||[]).filter(n=>n?.type==='node').map(n=>`${n.name} [${n.numericId}]`),selected:''},{name:'applyByName',type:'bool',value:false}], func:()=>({next:true,truth:true}) },
    { name:'onUnload', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onClientJoined', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    { name:'onClientLeft', receiver:false, group:'Events', output:[{id:'out'}], editor:[], func:()=>({out:true}) },
    {
      name:'loadScene', receiver:true, group:'Actions',
      editor:[{name:'Scene',type:'selector',value:ctx=>(ctx?.sceneList||[]).map(s=>s.name),selected:'Main'}],
      func:(ctx,v)=>{ ctx.loadScene?.(v.Scene); return {}; }
    },
    {name:'saveState',receiver:true,group:'Actions',output:[{id:'out'}],editor:[{name:'Name',type:'str',value:''}],func:(ctx,v)=>{ctx.saveState?.(v.Name);return {out:true};}},
    {name:'loadState',receiver:true,group:'Actions',editor:[{name:'Name',type:'str',value:''}],func:(ctx,v)=>{ctx.loadState?.(v.Name);return {}; }},
    {name:'removeState',receiver:true,group:'Actions',output:[{id:'out'}],editor:[{name:'Name',type:'str',value:''}],func:(ctx,v)=>{ctx.removeState?.(v.Name);return {out:true};}},
    {name:'clearState',receiver:true,group:'Actions',output:[{id:'out'}],editor:[],func:(ctx)=>{ctx.clearState?.();return {out:true};}},
    {name:'duplicateFolder',label:'Duplicate Folder',receiver:true,group:'Actions',output:[{id:'out'}],editor:[{name:'Folder',type:'selector',value:ctx=>(ctx?.folderOptions||[]).map(v=>String(v)),selected:''},{name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null},{name:'ScaleX',type:'int',value:null},{name:'ScaleY',type:'int',value:null},{name:'Angle',type:'int',value:null},{name:'MUE',type:'bool',value:null}],func:(ctx,v)=>{if(v?.Folder)ctx.duplicateFolder?.(v.Folder,v?.PosX,v?.PosY,v?.ScaleX,v?.ScaleY,v?.Angle,v?.MUE===true);return {out:true};}},
    {name:'setTransformFolder',label:'setTransformFolder',receiver:true,group:'Actions',output:[{id:'out'}],editor:[{name:'Folder',type:'selector',value:ctx=>(ctx?.folderOptions||[]).map(v=>String(v)),selected:''},{name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null},{name:'ScaleX',type:'int',value:null},{name:'ScaleY',type:'int',value:null},{name:'Angle',type:'int',value:null},{name:'MUE',type:'bool',value:null}],func:(ctx,v)=>{ctx.setTransformFolder?.(v?.Folder,v?.PosX,v?.PosY,v?.ScaleX,v?.ScaleY,v?.Angle,v?.MUE===true);return {out:true};}},
    {
      name:'setVariable', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[
        {name:'Type',type:'selector',value:()=>['Global','Local','Scene','Server'],selected:'Global'},
        {name:'Name',type:'selector',value:ctx=>ctx?.variableNames||[],selected:null},
        {name:'Value',type:'str',value:null}
      ],
      func:(ctx,v)=>{ctx.setVariable?.(v.Type,v.Name,v.Value);return {out:true};}
    },
    {
      name:'saveVariable', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[
        {name:'Scope',type:'selector',value:()=>['Global','Local','Scene','Server'],selected:'Global'},
        {name:'Name',type:'selector',value:ctx=>ctx?.variableNames||[],selected:null},
        {name:'StorageType',type:'selector',value:()=>['local','session','indexedDB'],selected:'local'}
      ],
      func:async(ctx,v)=>({out:!!(await ctx.saveVariable?.(v.Scope,v.Name,v.StorageType))})
    },
    {
      name:'loadVariable', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[
        {name:'Scope',type:'selector',value:()=>['Global','Local','Scene','Server'],selected:'Global'},
        {name:'Name',type:'selector',value:ctx=>ctx?.variableNames||[],selected:null},
        {name:'StorageType',type:'selector',value:()=>['local','session','indexedDB'],selected:'local'}
      ],
      func:async(ctx,v)=>({out:!!(await ctx.loadVariable?.(v.Scope,v.Name,v.StorageType))})
    },
    {
      name:'createRoom', receiver:true, group:'Actions', output:[{id:'out'},{id:'success'},{id:'err'}],
      editor:[{name:'room/clientID',type:'str',value:''}],
      func:async(ctx,v)=>{
        try{await ctx.network?.createRoom?.(v['room/clientID']);return {out:true,success:true};}
        catch(error){ctx.network?.reportError?.(error);return {out:true,err:true};}
      }
    },
    {
      name:'joinRoom', receiver:true, group:'Actions', output:[{id:'out'},{id:'success'},{id:'err'}],
      editor:[{name:'room',type:'str',value:''},{name:'clientID',type:'str',value:''}],
      func:async(ctx,v)=>{
        try{await ctx.network?.joinRoom?.(v.room,v.clientID);return {out:true,success:true};}
        catch(error){ctx.network?.reportError?.(error);return {out:true,err:true};}
      }
    },
    {name:'setVisible',receiver:true,group:'Actions',output:[{id:'out'}],editor:[{name:'Visibility',type:'bool',value:true}],func:(ctx,v)=>{ctx.setVisible?.(!!v.Visibility);return {out:true};}},
    {
      name:'createParticles', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[
        {name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null},
        {name:'ScaleX',type:'int',value:1},{name:'ScaleY',type:'int',value:1},
        {name:'VelocityX',type:'int',value:0},{name:'VelocityY',type:'int',value:0},
        {name:'AccelerationX',type:'int',value:0},{name:'AccelerationY',type:'int',value:0},
        {name:'Angle',type:'int',value:0},
        {name:'Type',type:'selector',value:()=>['Circle','Trail','Box','Sprite'],selected:'Circle'},
        {name:'Source',type:'selector',value:()=>['Sprite','Animation'],selected:'Sprite'},
        {name:'Sprite',type:'selector',value:ctx=>(ctx?.spriteAssets||[]).map(a=>a.name),selected:''},
        {name:'Animation',type:'selector',value:ctx=>(ctx?.animations||[]).map(a=>a?.name).filter(Boolean),selected:''},
        {name:'Strength',type:'int',value:100},
        {name:'Color',type:'col',value:'#FFFFFFFF'},
        {name:'Lifetime',type:'int',value:1000},{name:'Count',type:'int',value:1},{name:'Index',type:'int',value:0}
      ],
      func:(ctx,v)=>{ctx.createParticles?.(v);return {out:true};}
    },
    {
      name:'setTransform', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[
        [{name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null}],
        [{name:'ScaleX',type:'int',value:null},{name:'ScaleY',type:'int',value:null}],
        {name:'Angle',type:'int',value:null}
      ],
      func:(ctx,v)=>{ctx.setTransform?.(v.PosX,v.PosY,v.ScaleX,v.ScaleY,v.Angle);return {out:true};}
    },
    {
      name:'setNode', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Name',type:'str',value:''},{name:'Id',type:'int',value:1}],
      func:(ctx,v)=>{ctx.setNode?.(v.Name,v.Id);return {out:true};}
    },
    {
      name:'setText', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Text',type:'str',value:'text'},{name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null},{name:'FontSize',type:'int',value:null},{name:'FontFamily',type:'str',value:null},{name:'Align',type:'selector',value:()=>['Top','Center','Bottom'],selected:'Center'},{name:'Justify',type:'selector',value:()=>['Left','Center','Right'],selected:'Center'},{name:'FG Color',type:'col',value:null},{name:'BG Color',type:'col',value:null},{name:'Border',type:'bool',value:null},{name:'Border Color',type:'col',value:null},{name:'Border Width',type:'int',value:null}],
      func:(ctx,v)=>{ctx.setText?.(v);return {out:true};}
    },
    {
      name:'setSprite', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Type',type:'selector',value:()=>['Image','Texture'],selected:'Image'},{name:'Source',type:'selector',value:()=>['Sprite','Animation'],selected:'Sprite'},{name:'Sprite',type:'selector',value:ctx=>(ctx?.spriteAssets||[]).map(a=>a.name),selected:null},{name:'Animation',type:'selector',value:ctx=>(ctx?.animations||[]).map(a=>a.name),selected:null},{name:'Scale Type',type:'selector',value:()=>['Stretch','Crop'],selected:'Stretch'},{name:'Modulate',type:'col',value:null},{name:'Pixelated',type:'bool',value:null},{name:'Opacity',type:'int',value:100}],
      func:(ctx,v)=>{ctx.setSprite?.(v);return {out:true};}
    },
    {name:'stopAnimation',receiver:true,group:'Actions',output:[{id:'out'}],editor:[],func:(ctx)=>{ctx.stopAnimation?.();return {out:true};}},
    {name:'startAnimation',receiver:true,group:'Actions',output:[{id:'out'}],editor:[],func:(ctx)=>{ctx.startAnimation?.();return {out:true};}},
    {name:'stepAnimation',receiver:true,group:'Actions',output:[{id:'out'}],editor:[{name:'forward',type:'bool',value:true}],func:(ctx,v)=>{ctx.stepAnimation?.(!!v.forward);return {out:true};}},
    {
      name:'setInputComponent', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Text',type:'str',value:null},{name:'Placeholder',type:'str',value:null},[{name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null}],[{name:'ScaleX',type:'int',value:null},{name:'ScaleY',type:'int',value:null}],{name:'Width',type:'int',value:null},{name:'Height',type:'int',value:null},{name:'Multiline',type:'bool',value:null},{name:'FG Color',type:'col',value:null},{name:'BG Color',type:'col',value:null},{name:'Outline Color',type:'col',value:null},{name:'Font Size',type:'int',value:null},{name:'Font Family',type:'str',value:null},{name:'Align',type:'selector',value:()=>['Top','Center','Bottom'],selected:null},{name:'Justify',type:'selector',value:()=>['Left','Center','Right'],selected:null},{name:'Padding',type:'int',value:null},{name:'Outline Width',type:'int',value:null},{name:'Border Radius',type:'int',value:null},{name:'Max Length',type:'int',value:null}],
      func:(ctx,v)=>{ctx.setInputComponent?.(v);return {out:true};}
    },
    {
      name:'setPhysics', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Body',type:'selector',value:()=>['Static','Kinematic','Dynamic'],selected:null},{name:'Mass',type:'number',value:null},{name:'Gravity',type:'int',value:null},{name:'Friction',type:'int',value:null},{name:'Bounciness',type:'int',value:null},{name:'Fixed Rotation',type:'bool',value:null},{name:'isCollider',type:'bool',value:null}],
      func:(ctx,v)=>{ctx.setPhysics?.(v);return {out:true};}
    },
    {
      name:'setCollider', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Collider',type:'bool',value:null},{name:'Type',type:'selector',value:()=>['Rect','Circle','Triangle'],selected:null},{name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null},{name:'ScaleX',type:'int',value:null},{name:'ScaleY',type:'int',value:null},{name:'Angle',type:'int',value:null}],
      func:(ctx,v)=>{ctx.setCollider?.(v);return {out:true};}
    },
    {
      name:'setProgressBar', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Width',type:'int',value:null},{name:'Height',type:'int',value:null},{name:'Value',type:'int',value:null},{name:'Min',type:'int',value:null},{name:'Max',type:'int',value:null},{name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null},{name:'BG Color',type:'col',value:null},{name:'Fill Color',type:'col',value:null},{name:'TL',type:'int',value:null},{name:'TR',type:'int',value:null},{name:'BR',type:'int',value:null},{name:'BL',type:'int',value:null},{name:'Outline Color',type:'col',value:null},{name:'Outline Size',type:'int',value:null},{name:'Direction',type:'selector',value:()=>['left','right'],selected:null}],
      func:(ctx,v)=>{ctx.setProgressBar?.(v);return {out:true};}
    },
    {
      name:'Follow Object', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Target',type:'selector',value:ctx=>(ctx?.allNodes||[]).filter(n=>n?.type==='node').map(n=>`${n.name} [${n.numericId}]`),selected:''},{name:'Speed',type:'int',value:100}],
      func:(ctx,v)=>{ctx.followObject?.(v.Target,v.Speed);return {out:true};}
    },
    {name:'Destroy Object',receiver:true,group:'Actions',editor:[],func:ctx=>{ctx.destroyObject?.();return {}; }},
    {name:'focusInput',receiver:true,group:'Actions',output:[{id:'out'}],editor:[],func:ctx=>{ctx.focusInput?.();return {out:true};}},
    {name:'blurInput',receiver:true,group:'Actions',output:[{id:'out'}],editor:[],func:ctx=>{ctx.blurInput?.();return {out:true};}},
    {
      name:'Chase', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Map',type:'selector',selectFolder:true,value:ctx=>(ctx?.folderOptions||[]),selected:''},{name:'Target',type:'selector',value:ctx=>(ctx?.allNodes||[]).filter(n=>n?.type==='node').map(n=>`${n.name} [${n.numericId}]`),selected:''},{name:'Speed',type:'int',value:100}],
      func:(ctx,v)=>{ctx.chase?.(v.Map,v.Target,v.Speed);return {out:true};}
    },
    {
      name:'Avoid', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Map',type:'selector',selectFolder:true,value:ctx=>(ctx?.folderOptions||[]),selected:''},{name:'Target',type:'selector',value:ctx=>(ctx?.allNodes||[]).filter(n=>n?.type==='node').map(n=>`${n.name} [${n.numericId}]`),selected:''},{name:'Speed',type:'int',value:100}],
      func:(ctx,v)=>{ctx.avoid?.(v.Map,v.Target,v.Speed);return {out:true};}
    },
    {
      name:'Create Object', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'Object',type:'selector',value:ctx=>(ctx?.allNodes||[]).filter(n=>n?.type==='node').map(n=>`${n.name} [${n.numericId}]`),selected:''},{name:'PosX',type:'int',value:0},{name:'PosY',type:'int',value:0},{name:'Angle',type:'int',value:0},{name:'ScaleX',type:'int',value:1},{name:'ScaleY',type:'int',value:1},{name:'VelocityX',type:'int',value:null},{name:'VelocityY',type:'int',value:null},{name:'AngularVelocity',type:'int',value:null}],
      func:(ctx,v)=>{ctx.createObject?.(v.Object,v.PosX,v.PosY,v.Angle,v.ScaleX,v.ScaleY,v.VelocityX,v.VelocityY,v.AngularVelocity);return {out:true};}
    },
    {
      name:'setVelocity', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'VelocityX',type:'int',value:null},{name:'VelocityY',type:'int',value:null},{name:'AngularVelocity',type:'int',value:null}],
      func:(ctx,v)=>{ctx.setVelocity?.(v.VelocityX,v.VelocityY,v.AngularVelocity);return {out:true};}
    },
    {
      name:'setSubCam', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[
        {name:'Name',type:'str',value:null},
        [{name:'Cam X',type:'int',value:null},{name:'Cam Y',type:'int',value:null}],
        [{name:'Cam Size X',type:'int',value:null},{name:'Cam Size Y',type:'int',value:null}],
        {name:'Cam Angle',type:'int',value:null}
      ],
      func:(ctx,v)=>{ctx.setSubCam?.({Name:v.Name,camX:v['Cam X'],camY:v['Cam Y'],camSizeX:v['Cam Size X'],camSizeY:v['Cam Size Y'],camAngle:v['Cam Angle']});return {out:true};}
    },
    {
      name:'setCanvas', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[
        {name:'Sub Camera',type:'selector',value:ctx=>['None','Main Cam',...(ctx?.allNodes||[]).filter(n=>n?.type==='node' && n?.components?.some(c=>c?.type==='subcamera')).map(n=>`${n.components.find(c=>c.type==='subcamera')?.name||n.name} [${n.numericId}]`)],selected:'None'},
        [{name:'Width',type:'int',value:null},{name:'Height',type:'int',value:null}],
        [{name:'Pos X',type:'int',value:null},{name:'Pos Y',type:'int',value:null}],
        [{name:'Scale X',type:'int',value:null},{name:'Scale Y',type:'int',value:null}],
        {name:'Render',type:'selector',value:['Stretch','Crop','Windowboxing'],selected:'Windowboxing'},
        {name:'BG Color',type:'col',value:null},
        {name:'Pixelated',type:'bool',value:null}
      ],
      func:(ctx,v)=>{ctx.setCanvas?.(v);return {out:true};}
    },
    {
      name:'setCamera', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[
        {name:'Enabled',type:'bool',value:null},
        {name:'Follow',type:'selector',value:ctx=>['This',...(ctx?.allNodes||[]).filter(n=>n?.type==='node').map(n=>`${n.name} [${n.numericId}]`)],selected:null},
        {name:'PosX',type:'int',value:null},{name:'PosY',type:'int',value:null},{name:'Angle',type:'int',value:null},
        {name:'Horizontal',type:'int',value:null},{name:'Vertical',type:'int',value:null},
        {name:'Animation',type:'selector',value:()=>['Quick','Smooth','Linear','Ease In','Ease Out','Ease In Out','Sine In','Sine Out','Sine In Out','Back In Out'],selected:null},
        {name:'Speed',type:'int',value:null},{name:'Scale',type:'int',value:null},{name:'BG Color',type:'col',value:null}
      ],
      func:(ctx,v)=>{ctx.setCamera?.(v);return {out:true};}
    },
    {
      name:'playAudio', receiver:true, group:'Actions', output:[{id:'out'}],
      editor:[{name:'src',type:'selector',value:ctx=>(ctx?.audioAssets||[]).map(a=>a.name),selected:''},{name:'volume',type:'int',value:100},{name:'start',type:'int',value:0},{name:'duration',type:'int',value:0},{name:'loop',type:'bool',value:false},{name:'fadein',type:'int',value:0},{name:'fadeout',type:'int',value:0},{name:'panValue',type:'int',value:0}],
      func:(ctx,v)=>{ctx.playAudio?.(v);return {out:true};}
    },
    {name:'stopAudio',receiver:true,group:'Actions',output:[{id:'out'}],editor:[],func:ctx=>{ctx.stopAudio?.();return {out:true};}},
    {name:'clearAudio',receiver:true,group:'Actions',output:[{id:'out'}],editor:[],func:ctx=>{ctx.clearAudio?.();return {out:true};}},
    {name:'Boolean',receiver:true,group:'Controls',output:[{id:'next'},{id:'truth'},{id:'falsy'}],editor:[{name:'Value',type:'bool',value:true}],func:(ctx,v)=>({next:true,truth:!!v.Value,falsy:!v.Value})},
    {name:'Interval',receiver:true,group:'Controls',output:[{id:'next'},{id:'out',col:'#d56cff'}],editor:[{name:'Milliseconds',type:'int',value:1000},{name:'cancellable',type:'bool',value:false}],func:()=>({out:true})},
    {name:'Timeout',receiver:true,group:'Controls',output:[{id:'next'},{id:'out',col:'#d56cff'}],editor:[{name:'Milliseconds',type:'int',value:1000},{name:'cancellable',type:'bool',value:false}],func:()=>({out:true})},
    {name:'isVisible',receiver:true,group:'Controls',output:[{id:'next'},{id:'truth'},{id:'falsy'}],editor:[],func:ctx=>{const yes=!!ctx.isVisible?.();return {next:true,truth:yes,falsy:!yes};}},
    {name:'isCollidedWith',receiver:true,group:'Controls',output:[{id:'next'},{id:'truth'},{id:'falsy'}],editor:[{name:'Target',type:'selector',value:ctx=>(ctx?.allNodes||[]).filter(n=>n?.type==='node').map(n=>`${n.name} [${n.numericId}]`),selected:''},{name:'applyByName',type:'bool',value:false}],func:(ctx,v)=>{const yes=!!ctx.isCollidedWith?.(v.Target,!!(v.applyByName??v['Apply By Name']));return {next:true,truth:yes,falsy:!yes};}}
  ];
  const SCRIPT_OUTPUT_DEFAULT_COLORS={truth:'#3c9cff',falsy:'#ff4d4d',false:'#ff4d4d',success:'#4cd97b',err:'#ff9d45',error:'#ff9d45'};
  scriptNodes.forEach(def=>{
    if(!Array.isArray(def.output))return;
    def.output.forEach(out=>{
      const id=String(out?.id||'').toLowerCase();
      if((def.name==='Interval'||def.name==='Timeout')){
        if(id==='out')out.col='#d56cff';
        return;
      }
      if(!out.col&&SCRIPT_OUTPUT_DEFAULT_COLORS[id])out.col=SCRIPT_OUTPUT_DEFAULT_COLORS[id];
    });
  });
  scriptNodes.forEach(n=>{if(!Object.prototype.hasOwnProperty.call(n,'require'))n.require='';});
  const scriptNodeOrder=['onLoad','onTick','onKeybind','onTouch','onMouse','onPointer','onScreenInput','onJoystick','onAudioPickup','onInputFocus','onInputChange','onColorChange','onInputBlur','onConnectionChange','onCollideWith','onUnload','onClientJoined','onClientLeft','saveState','loadState','removeState','clearState','setVariable','saveVariable','loadVariable','createRoom','joinRoom','setVisible','createParticles','setTransform','setText','stopAnimation','startAnimation','stepAnimation','setSprite','setInputComponent','setVelocity','setProgressBar','setPhysics','setCollider','setSubCam','setCanvas','setCamera','Follow Object','Chase','Avoid','Create Object','duplicateFolder','setTransformFolder','Destroy Object','focusInput','blurInput','playAudio','startSpeechRecognition','stopSpeechRecognition','stopAudio','clearAudio','loadScene','Boolean','isVisible','isCollidedWith','Interval','Timeout'];
  scriptNodes.splice(0,scriptNodes.length,...scriptNodeOrder.map(name=>scriptNodes.find(n=>n.name===name)).filter(Boolean));
  window.UIXScriptNodes={scriptNodes};
})();
