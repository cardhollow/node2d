# Node2D

Node2D is a browser-based 2D game engine and visual editor by CardHollow (v42.2.0). Build games with Scenes, Nodes, Components, visual ScriptNodes, assets, cameras, audio, MIDI, runtime testing, and web export.

## Version 42.2.0
- Component cards on a Node now have Move Up / Move Down buttons (also in the card's right-click menu). Visual components are drawn in list order, so the lowest card is painted on top: add Text then Sprite and the Sprite covers the Text; move Text below the Sprite to put it on top. Applies to every visual component, including ones added later.
- Node, Script and Transform stay fixed at the top.

## Version 42.1.4
- Every remaining text/emoji icon (close ×, + / − toggles, ‹ › chevrons, checkboxes, tree and component icons, Sprite Editor Preview/Layers, MIDI editor toolbar, Help and Updates pages) is now an SVG from `js/svgIconData.js`.
- `<i class="ui-svg" data-icon="name"></i>` placeholders are filled in automatically, including for UI added later; JS uses `UIXIcons.get(name)` or `UIXIcons.set(element,name)`.

## Version 42.1.3
- `js/svgIconData.js` is now the single source of truth for every icon. `index.html` only holds `<i data-icon="name">` placeholders that are filled in at startup, and menus/editors request icons by name.
- Removed the old text-glyph (⧉ ✂ ▣ …) lookup table; context menu items now use icon names directly.

## Version 42.1.2
- All interface icons (top bar, menus, modes, Sprite Editor tools, layer controls, context menus, ScriptNode actions) now use one original SVG icon set that follows the surrounding text colour.
- Icons live in `js/svgIconData.js` and are inlined, so they work offline and from `file://` previews. The `svgIcons/` folder and every reference to it (including the service worker cache list) were removed.

## Version 42.1.1
- Raw JSON project import and export (uncompressed project data, separate from `.ndc`).
- Read-only, syntax-coloured JSON viewer.
- Visual components render in component order, so the most recently added visual component appears above earlier ones.
- Bundled SVG icons used across the main navigation and project actions.

- Fixed icons not appearing when opening `index.html` directly from local storage on Android or other `file://` previews. Static interface icons are inline SVG; dynamically-created action icons use `js/svgIconData.js`.

## More information
- Help: https://cardhollow.github.io/node2d/help
- Try App: https://cardhollow.github.io/node2d/help
- GitHub / Source: https://github.com/cardhollow/node2d

## Offline Mode
Node2D caches the editor in your browser while you are online. When opened offline, it loads the most recently cached version. When the connection returns, it requests the newest version and refreshes the cache.

## Installation
Node2D is installable on supported browsers and devices. Some mobile browsers can install it to the device home screen/app launcher.

## Samples
Load Local includes a Flappy Bird sample loader. The sample is fetched once, saved in Local NDC storage, and marked with the `flappybirdsample` local-storage flag so it is not offered again on that device.

## Assets
GIF files are imported and converted into individual PNG Sprite assets. For example, Apple.gif becomes Apple1.png, Apple2.png, and so on. Each resulting PNG is static; use them with Animation Sprite for playback.
