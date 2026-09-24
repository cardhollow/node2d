# UIX Editor v47

This build keeps the working editor/runtime UI from the previous stable build and adds a dedicated `js/runtimeEngine.js` for the runtime physics step.

The runtime physics module handles:
- Dynamic/Kinematic integration
- Gravity
- Convex Rect/Circle/Triangle contacts
- Two-point polygon contact manifolds
- Normal impulses
- Friction impulses
- Rotation and angular velocity
- Fixed Rotation
- Restitution/Bounciness
- Positional penetration correction
- Collider detection flags

`app.js` delegates each runtime physics substep to `UIXRuntimeEngine.stepPhysics(...)`.


## MIDI Editor

This build adds a modal MIDI Editor beside the Sprite Editor. It supports note drawing, erasing, moving, resizing, track management, BPM, snap/length controls, waveform preview, looping, MIDI import, and MIDI export.

The MIDI implementation is fully offline: `js/midiParser.js` contains the bundled Standard MIDI File parser/encoder, and `js/midiEditor.js` contains the editor UI and Web Audio preview. No external MIDI library is required.
## Project / NDC
- `Game Settings > Preferred Scene` selects the first scene used by Play and Debug.
- `File > Project > Save in Project` stores the current `.ndc` in IndexedDB.
- `Ctrl+S` performs the same local project save.
- `File > Project > Export .ndc` exports the complete project as one Node Compressed file.
- `File > Project > Import .ndc` restores scenes, scripts, variables, UI data, and binary assets.
- `js/ndcCodec.js` is fully offline and uses iterative dictionary pair compression, stopping when the next pass is no smaller.

NDC4 stores project text through a compact dictionary and binary assets without Base64 inside the NDC container. It also reads NDC1/NDC2/NDC3 files for compatibility.


Rebuild baseline: embedded editor Play/Debug runtime from pre-export v47. No playerRuntime.js is used. NDC remains format 1 (NDC1/NDP1) with dictionary text compression, binary asset deduplication, and repeated LZ passes. Project export reads the current engine JS files at export time.
