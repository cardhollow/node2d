(() => {
  'use strict';

  // Change the definitions here to change how newly-created nodes are built.
  const NodeSettings = {
    node: { default: true, removable: false, index: null, locked: false },
    script: { default: true, removable: false, name: 'Script' },
    transform: {
      default: true, removable: false,
      position: [0, 0], scale: [1, 1], angle: [0]
    },
    text: {
      default: false, removable: true,
      fgcol: '#FFFFFFFF', bg: '#00000000', txt: 'Text', position: [0, 0],
      fontSize: 32, fontFamily: 'sans-serif',
      border: { enabled: false, color: '#FFFFFFFF', width: 1, radius: [0, 0, 0, 0] }
    },
    input: {
      default: false, removable: true,
      txt: '', placeholder: 'Input', width: 260, height: 48,
      position: [0, 0], scale: [1, 1], multiline: false,
      fgCol: '#FFFFFFFF', bgCol: '#202020FF', outlineCol: '#FFFFFFFF',
      fontSize: 24, fontFamily: 'sans-serif', padding: 10,
      outlineWidth: 1, borderRadius: 6, maxLength: 0
    },
    sprite: { default: false, removable: true, name: '', src: '', pixelated: true, sourceType: 'Sprite', animation: '', opacity: 1, position: [0, 0], size: [0, 0] },
    animationsprite: { default: false, removable: true, name: 'Animation', animations: [{ name: 'Default', fps: 8, sprites: [] }], activeAnimation: 'Default', sprites: [] },
    physics: {
      default: false, removable: true,
      body: 'Static', gravity: 980, friction: 0.5, bounciness: 0, fixedRotation: false, isCollider: false
    },
    collider: {
      default: false, removable: true,
      transform: { position: [0, 0], scale: [1, 1], angle: [0] }, type: 'Rect', collidable: true
    },
    progressbar: {
      default: false, removable: true,
      width: 200, height: 24, value: 50, min: 0, max: 100,
      position: [0, 0], bgCol: '#303030FF', fillCol: '#FFFFFFFF',
      cornerRadius: [0, 0, 0, 0],
      outline: { color: '#000000FF', size: 0 },
      direction: 'left'
    }
  };

  const COMPONENT_LABELS = {
    node: 'Node', script: 'Script', transform: 'Transform', text: 'Text', input: 'Input Component',
    sprite: 'Sprite', animationsprite: 'Animation Sprite', physics: 'Physics', collider: 'Collider', progressbar: 'Progress Bar'
  };

  const clone = value => JSON.parse(JSON.stringify(value));

  function createComponent(type) {
    const cfg = NodeSettings[type] || {};
    const component = clone(cfg);
    component.type = type;
    component.removable = cfg.removable !== false;
    if (['node', 'script', 'transform'].includes(type)) component.removable = false;
    delete component.default;
    return component;
  }

  function createDefaultComponents() {
    return Object.keys(NodeSettings)
      .filter(type => NodeSettings[type].default)
      .map(createComponent);
  }

  function normalizeNode(node) {
    node.components = Array.isArray(node.components) ? node.components : [];
    const byType = new Map();
    node.components.forEach(component => {
      if (!component || !component.type || byType.has(component.type)) return;
      byType.set(component.type, component);
    });
    ['node', 'script', 'transform'].forEach(type => {
      if (!byType.has(type)) byType.set(type, createComponent(type));
    });
    node.components = ['node', 'script', 'transform']
      .map(type => byType.get(type))
      .concat([...byType.entries()]
        .filter(([type]) => !['node', 'script', 'transform'].includes(type))
        .map(([, component]) => component));
    node.components.forEach(component => {
      component.removable = ['node', 'script', 'transform'].includes(component.type)
        ? false : component.removable !== false;
      if (component.type === 'node') {
        component.index = Number.isFinite(Number(component.index)) ? Math.max(0, Math.floor(Number(component.index))) : null;
        component.locked = !!component.locked;
      }
      if (component.type === 'sprite') {
        component.sourceType = component.sourceType || 'Sprite';
        component.animation = component.animation || '';
        component.opacity = Number.isFinite(Number(component.opacity)) ? Math.max(0, Math.min(1, Number(component.opacity))) : 1;
        component.pixelated = component.pixelated !== false;
        component.position = Array.isArray(component.position) ? component.position : [0, 0];
        component.size = Array.isArray(component.size) ? component.size : [0, 0];
      }
      if (component.type === 'animationsprite') {
        if (!Array.isArray(component.animations)) component.animations = [];
        if (Array.isArray(component.sprites) && component.sprites.length) {
          if (!component.animations.length) component.animations = [{ name: 'Default', fps: Number(component.fps)||8, sprites: component.sprites }];
          else if (!component.animations[0].sprites?.length) component.animations[0].sprites = component.sprites;
        }
        if (!component.animations.length) component.animations = [{name:'Default',fps:8,sprites:[]}];
        component.animations.forEach((a,i)=>{a.name=a.name||`Animation ${i+1}`;a.fps=Math.max(1,Number(a.fps)||8);a.sprites=Array.isArray(a.sprites)?a.sprites:[];});
        component.activeAnimation = component.activeAnimation || component.animations[0].name;
        const active = component.animations.find(a=>a.name===component.activeAnimation) || component.animations[0];
        component.sprites = active.sprites;
      }
      if (component.type === 'collider') {
        component.transform = component.transform || { position: [0, 0], scale: [1, 1], angle: [0] };
        component.transform.position = Array.isArray(component.transform.position) ? component.transform.position : [0, 0];
        component.transform.scale = Array.isArray(component.transform.scale) ? component.transform.scale : [1, 1];
        component.transform.angle = Array.isArray(component.transform.angle) ? component.transform.angle : [0];
        component.shapeType = ['Rect', 'Circle', 'Triangle'].includes(component.shapeType) ? component.shapeType : (['Rect', 'Circle', 'Triangle'].includes(component.type) ? component.type : 'Rect');
        component.collidable = component.collidable !== false;
      }
      if (component.type === 'text') {
        component.position = Array.isArray(component.position) ? component.position : [0, 0];
        component.border = component.border || { enabled: false, color: component.fgcol || '#FFFFFFFF', width: 1, radius: [0,0,0,0] };
        component.border.radius = Array.isArray(component.border.radius) ? component.border.radius : [0,0,0,0];
      }
      if (component.type === 'input') {
        component.txt = String(component.txt ?? '');
        component.placeholder = String(component.placeholder ?? 'Input');
        component.width = Math.max(1, Number(component.width) || 260);
        component.height = Math.max(1, Number(component.height) || 48);
        component.position = Array.isArray(component.position) ? component.position : [0, 0];
        component.scale = Array.isArray(component.scale) ? component.scale : [1, 1];
        component.scale[0] = Number.isFinite(Number(component.scale[0])) ? Number(component.scale[0]) : 1;
        component.scale[1] = Number.isFinite(Number(component.scale[1])) ? Number(component.scale[1]) : 1;
        component.multiline = !!component.multiline;
        component.fgCol = component.fgCol || '#FFFFFFFF';
        component.bgCol = component.bgCol || '#202020FF';
        component.outlineCol = component.outlineCol || '#FFFFFFFF';
        component.fontSize = Math.max(1, Number(component.fontSize) || 24);
        component.fontFamily = component.fontFamily || 'sans-serif';
        component.padding = Math.max(0, Number(component.padding) || 0);
        component.outlineWidth = Math.max(0, Number(component.outlineWidth) || 0);
        component.borderRadius = Math.max(0, Number(component.borderRadius) || 0);
        component.maxLength = Math.max(0, Math.floor(Number(component.maxLength) || 0));
      }
      if (component.type === 'physics') {
        component.body = ['Static', 'Kinematic', 'Dynamic'].includes(component.body) ? component.body : 'Static';
        component.gravity = Number.isFinite(Number(component.gravity)) ? Number(component.gravity) : 980;
        component.friction = Math.max(0, Number(component.friction) || 0);
        component.bounciness = Math.max(0, Math.min(1, Number(component.bounciness) || 0));
        component.fixedRotation = !!component.fixedRotation;
        component.isCollider = !!component.isCollider;
      }
      if (component.type === 'progressbar') {
        component.position = Array.isArray(component.position) ? component.position : [0, 0];
        component.cornerRadius = Array.isArray(component.cornerRadius) ? component.cornerRadius : [0, 0, 0, 0];
        component.outline = component.outline || { color: '#000000FF', size: 0 };
        component.direction = component.direction === 'right' ? 'right' : 'left';
      }
    });
    return node;
  }

  function createNode(id, numericId, name) {
    return {
      id, numericId, type: 'node', name,
      components: createDefaultComponents()
    };
  }

  window.UIXNodeConfig = {
    NodeSettings,
    COMPONENT_LABELS,
    createComponent,
    createDefaultComponents,
    createNode,
    normalizeNode
  };
})();
