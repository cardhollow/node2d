(() => {
  'use strict';

  // Asset containers shared by the editor and runtime. Project save/export serializes these assets.
  const Assets = {
    Sprite: [],
    Audio: [],
    MIDI: []
  };

  window.UIXAssets = { Assets };
})();
