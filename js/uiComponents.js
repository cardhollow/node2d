(() => {
  'use strict';

  const UIComponentSettings = {
    joystick: {
      name: 'Joystick',
      variable: 'joystick',
      bgColor: '#333333CC',
      knobColor: '#FFFFFFFF',
      size: [110, 110],
      position: { left: 10, top: null, right: null, bottom: 10 }
    }
  };

  const clone = value => JSON.parse(JSON.stringify(value));

  function createJoystick(index = 1) {
    const base = clone(UIComponentSettings.joystick);
    base.id = `joystick-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    base.variable = index === 1 ? 'joystick' : `joystick${index}`;
    return base;
  }

  window.UIXUIComponents = { UIComponentSettings, createJoystick };
})();
