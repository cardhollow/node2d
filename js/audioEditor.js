(() => {
  'use strict';

  // Audio Editor: record, import, multi-track edit, effects, markers and WAV export.
  // All audio is held as immutable Float32Array channels at one project sample rate,
  // so undo/redo is a cheap snapshot of references and every effect is plain JS DSP.
  const { Assets } = window.UIXAssets;
  const SR = 44100;
  let LANE_H = 112; // shrinks on short (landscape phone) screens
  const BLOCK = 256, MAX_HISTORY = 60;
  const COLORS = ['#e4ca4e', '#6fb8e4', '#e47f7f', '#8fd18f', '#c79be4', '#e4a24e'];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const db2lin = d => Math.pow(10, d / 20);
  const lin2db = v => 20 * Math.log10(Math.max(1e-9, v));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------------ DSP */
  const DSP = {
    peak(chs) { let p = 0; for (const a of chs) for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; } return p; },
    gain(a, g) { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * g; return o; },
    invert(a) { return DSP.gain(a, -1); },
    reverse(a) { const n = a.length, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a[n - 1 - i]; return o; },
    fade(a, dir, curve) {
      const n = a.length, o = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 1; let g = dir === 'in' ? t : 1 - t;
        if (curve === 'smooth') g = g * g * (3 - 2 * g); else if (curve === 'exp') g = g * g;
        o[i] = a[i] * g;
      }
      return o;
    },
    // ratio is the read step: 2 = twice as fast (half length), 0.5 = half speed.
    resample(a, ratio) {
      const n = a.length, m = Math.max(1, Math.round(n / ratio)), o = new Float32Array(m);
      for (let i = 0; i < m; i++) {
        const p = i * ratio, i0 = Math.floor(p), f = p - i0, a0 = i0 < n ? a[i0] : 0, a1 = i0 + 1 < n ? a[i0 + 1] : a0;
        o[i] = a0 + (a1 - a0) * f;
      }
      return o;
    },
    biquad(type, sr, f, q, gainDb) {
      f = clamp(f, 10, sr * 0.49); q = Math.max(0.05, q);
      const A = Math.pow(10, (gainDb || 0) / 40), w0 = 2 * Math.PI * f / sr, cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * q);
      let b0, b1, b2, a0, a1, a2;
      if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
      else if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
      else if (type === 'peaking') { b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; }
      else {
        const s = 2 * Math.sqrt(A) * alpha;
        if (type === 'lowshelf') { b0 = A * ((A + 1) - (A - 1) * cos + s); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - s); a0 = (A + 1) + (A - 1) * cos + s; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - s; }
        else { b0 = A * ((A + 1) + (A - 1) * cos + s); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - s); a0 = (A + 1) - (A - 1) * cos + s; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - s; }
      }
      return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
    },
    runBiquad(a, c) {
      const o = new Float32Array(a.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < a.length; i++) {
        const x = a[i], y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y; o[i] = y;
      }
      return o;
    },
    filter(chs, sr, type, f, q, gainDb) { const c = DSP.biquad(type, sr, f, q, gainDb); return chs.map(a => DSP.runBiquad(a, c)); },
    // Dynamics helpers read a linked (max of channels) level so stereo images are not skewed.
    linkedLevel(chs, i) { let m = 0; for (const a of chs) { const v = Math.abs(a[i]); if (v > m) m = v; } return m; },
    gate(chs, sr, thDb, attackMs, releaseMs, floorDb) {
      const n = chs[0].length, th = db2lin(thDb), floor = floorDb <= -90 ? 0 : db2lin(floorDb);
      const aC = Math.exp(-1 / (sr * Math.max(1e-4, attackMs / 1000))), rC = Math.exp(-1 / (sr * Math.max(1e-4, releaseMs / 1000)));
      const out = chs.map(() => new Float32Array(n)); let env = 0, g = floor;
      for (let i = 0; i < n; i++) {
        env = Math.max(DSP.linkedLevel(chs, i), env * rC);
        const target = env >= th ? 1 : floor;
        g += (target - g) * (1 - (target > g ? aC : rC));
        for (let c = 0; c < chs.length; c++) out[c][i] = chs[c][i] * g;
      }
      return out;
    },
    compress(chs, sr, thDb, ratio, attackMs, releaseMs, makeupDb) {
      const n = chs[0].length, aC = Math.exp(-1 / (sr * Math.max(1e-4, attackMs / 1000))), rC = Math.exp(-1 / (sr * Math.max(1e-4, releaseMs / 1000)));
      const out = chs.map(() => new Float32Array(n)); let env = 0; const makeup = db2lin(makeupDb);
      for (let i = 0; i < n; i++) {
        const x = DSP.linkedLevel(chs, i); env = x > env ? aC * env + (1 - aC) * x : rC * env + (1 - rC) * x;
        const over = Math.max(0, lin2db(env) - thDb), g = db2lin(-over * (1 - 1 / Math.max(1, ratio))) * makeup;
        for (let c = 0; c < chs.length; c++) out[c][i] = chs[c][i] * g;
      }
      return out;
    },
    echo(chs, sr, delayMs, feedback, mix) {
      const d = Math.max(1, Math.round(sr * delayMs / 1000)), fb = clamp(feedback, 0, 0.95);
      const repeats = fb < 0.01 ? 1 : Math.min(40, Math.ceil(Math.log(0.01) / Math.log(fb)));
      const tail = Math.min(Math.round(sr * 8), d * repeats), n = chs[0].length, m = n + tail;
      return chs.map(a => {
        const o = new Float32Array(m), w = new Float32Array(m);
        for (let i = 0; i < m; i++) {
          const x = i < n ? a[i] : 0;
          w[i] = (i >= d ? a[i - d] !== undefined && i - d < n ? a[i - d] : 0 : 0) + (i >= d ? fb * w[i - d] : 0);
          o[i] = x + mix * w[i];
        }
        return o;
      });
    },
    // Compact Freeverb-style reverb: 4 damped combs in parallel into 2 allpasses.
    reverb(chs, sr, room, damp, mix) {
      const n = chs[0].length, tail = Math.round(sr * (0.4 + room * 2.6)), m = n + tail, scale = sr / 44100;
      const combs = [1116, 1188, 1277, 1356], aps = [556, 441], fb = 0.7 + room * 0.28, d1 = clamp(damp, 0, 0.95);
      return chs.map((a, ch) => {
        const spread = ch ? 23 : 0, o = new Float32Array(m);
        const cb = combs.map(l => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0, store: 0 }));
        const ap = aps.map(l => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0 }));
        for (let i = 0; i < m; i++) {
          const x = i < n ? a[i] : 0, inp = x * 0.25; let wet = 0;
          for (const c of cb) { const y = c.buf[c.i]; c.store = y * (1 - d1) + c.store * d1; c.buf[c.i] = inp + c.store * fb; if (++c.i >= c.buf.length) c.i = 0; wet += y; }
          for (const p of ap) { const bo = p.buf[p.i], y = -wet + bo; p.buf[p.i] = wet + bo * 0.5; if (++p.i >= p.buf.length) p.i = 0; wet = y; }
          o[i] = x * (1 - mix * 0.5) + wet * mix * 0.9;
        }
        return o;
      });
    },
    mixdown(tracks, sr) {
      const live = tracks.filter(t => !t.mute && (!tracks.some(x => x.solo) || t.solo));
      let len = 0; for (const t of tracks) len = Math.max(len, Math.round(t.offset * sr) + t.L.length);
      const L = new Float32Array(len), R = new Float32Array(len);
      for (const t of live) {
        const off = Math.round(t.offset * sr), gl = t.vol * (t.pan > 0 ? 1 - t.pan : 1), gr = t.vol * (t.pan < 0 ? 1 + t.pan : 1);
        for (let i = 0; i < t.L.length; i++) { L[off + i] += t.L[i] * gl; R[off + i] += t.R[i] * gr; }
      }
      return [L, R];
    },
    toMono(chs) { if (chs.length < 2) return chs; const o = new Float32Array(chs[0].length); for (let i = 0; i < o.length; i++) o[i] = (chs[0][i] + chs[1][i]) / 2; return [o]; },
    encodeWAV(chs, sr, bits) {
      const ch = chs.length, n = chs[0].length, bytes = bits === 8 ? 1 : 2, dataLen = n * ch * bytes, buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
      const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
      v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bytes, true); v.setUint16(32, ch * bytes, true); v.setUint16(34, bytes * 8, true); w(36, 'data'); v.setUint32(40, dataLen, true);
      let p = 44;
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
        const s = clamp(chs[c][i], -1, 1);
        if (bytes === 1) { v.setUint8(p, Math.round(s * 127.5 + 127.5)); p += 1; } else { v.setInt16(p, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true); p += 2; }
      }
      return new Uint8Array(buf);
    },
    bytesToDataURL(bytes, mime) {
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return `data:${mime};base64,${btoa(bin)}`;
    },
    buildPeaks(a) {
      const nb = Math.ceil(a.length / BLOCK), min = new Float32Array(nb), max = new Float32Array(nb);
      for (let b = 0; b < nb; b++) { let lo = 1, hi = -1; const e = Math.min(a.length, (b + 1) * BLOCK); for (let i = b * BLOCK; i < e; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; } min[b] = lo; max[b] = hi; }
      return { min, max };
    }
  };

  /* -------------------------------------------------------------- Effects */
  const FX = {
    gain: { label: 'Gain', params: [{ k: 'db', label: 'Gain (dB)', min: -40, max: 40, step: 0.5, v: 0 }], run: (c, sr, p) => c.map(a => DSP.gain(a, db2lin(p.db))) },
    normalize: { label: 'Normalize', params: [{ k: 'peak', label: 'Peak (dBFS)', min: -24, max: 0, step: 0.5, v: -1 }], run: (c, sr, p) => { const pk = DSP.peak(c); return pk < 1e-6 ? c : c.map(a => DSP.gain(a, db2lin(p.peak) / pk)); } },
    fadein: { label: 'Fade In', params: [{ k: 'curve', label: 'Curve', options: ['linear', 'smooth', 'exp'], v: 'smooth' }], run: (c, sr, p) => c.map(a => DSP.fade(a, 'in', p.curve)) },
    fadeout: { label: 'Fade Out', params: [{ k: 'curve', label: 'Curve', options: ['linear', 'smooth', 'exp'], v: 'smooth' }], run: (c, sr, p) => c.map(a => DSP.fade(a, 'out', p.curve)) },
    reverse: { label: 'Reverse', params: [], run: c => c.map(DSP.reverse) },
    invert: { label: 'Invert Polarity', params: [], run: c => c.map(DSP.invert) },
    speed: { label: 'Speed / Pitch', params: [{ k: 'factor', label: 'Speed (x)', min: 0.25, max: 4, step: 0.05, v: 1.5 }], run: (c, sr, p) => c.map(a => DSP.resample(a, p.factor)) },
    lowpass: { label: 'Low-pass Filter', params: [{ k: 'f', label: 'Cutoff (Hz)', min: 100, max: 20000, step: 50, v: 6000 }, { k: 'q', label: 'Resonance', min: 0.3, max: 8, step: 0.1, v: 0.7 }], run: (c, sr, p) => DSP.filter(c, sr, 'lowpass', p.f, p.q) },
    highpass: { label: 'High-pass Filter', params: [{ k: 'f', label: 'Cutoff (Hz)', min: 20, max: 8000, step: 10, v: 120 }, { k: 'q', label: 'Resonance', min: 0.3, max: 8, step: 0.1, v: 0.7 }], run: (c, sr, p) => DSP.filter(c, sr, 'highpass', p.f, p.q) },
    eq: { label: '3-Band EQ', params: [{ k: 'low', label: 'Low 200 Hz (dB)', min: -18, max: 18, step: 0.5, v: 0 }, { k: 'mid', label: 'Mid 1 kHz (dB)', min: -18, max: 18, step: 0.5, v: 0 }, { k: 'high', label: 'High 4 kHz (dB)', min: -18, max: 18, step: 0.5, v: 0 }], run: (c, sr, p) => { let o = c; o = DSP.filter(o, sr, 'lowshelf', 200, 0.8, p.low); o = DSP.filter(o, sr, 'peaking', 1000, 0.9, p.mid); return DSP.filter(o, sr, 'highshelf', 4000, 0.8, p.high); } },
    gate: { label: 'Noise Gate', params: [{ k: 'th', label: 'Threshold (dB)', min: -80, max: 0, step: 1, v: -45 }, { k: 'a', label: 'Attack (ms)', min: 1, max: 100, step: 1, v: 5 }, { k: 'r', label: 'Release (ms)', min: 10, max: 800, step: 5, v: 120 }, { k: 'floor', label: 'Reduction (dB)', min: -90, max: -6, step: 1, v: -60 }], run: (c, sr, p) => DSP.gate(c, sr, p.th, p.a, p.r, p.floor) },
    compressor: { label: 'Compressor', params: [{ k: 'th', label: 'Threshold (dB)', min: -60, max: 0, step: 1, v: -20 }, { k: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, v: 4 }, { k: 'a', label: 'Attack (ms)', min: 1, max: 100, step: 1, v: 10 }, { k: 'r', label: 'Release (ms)', min: 10, max: 800, step: 5, v: 120 }, { k: 'makeup', label: 'Makeup (dB)', min: 0, max: 24, step: 0.5, v: 3 }], run: (c, sr, p) => DSP.compress(c, sr, p.th, p.ratio, p.a, p.r, p.makeup) },
    echo: { label: 'Echo', params: [{ k: 'ms', label: 'Delay (ms)', min: 30, max: 1000, step: 10, v: 280 }, { k: 'fb', label: 'Feedback', min: 0, max: 0.9, step: 0.05, v: 0.4 }, { k: 'mix', label: 'Mix', min: 0, max: 1, step: 0.05, v: 0.5 }], run: (c, sr, p) => DSP.echo(c, sr, p.ms, p.fb, p.mix) },
    reverb: { label: 'Reverb', params: [{ k: 'room', label: 'Room size', min: 0, max: 1, step: 0.05, v: 0.5 }, { k: 'damp', label: 'Damping', min: 0, max: 0.95, step: 0.05, v: 0.4 }, { k: 'mix', label: 'Mix', min: 0, max: 1, step: 0.05, v: 0.35 }], run: (c, sr, p) => DSP.reverb(c, sr, p.room, p.damp, p.mix) }
  };

  /* --------------------------------------------------------------- Helpers */
  let seq = 0, modal = null, closeHook = null;
  const fmtTime = t => { t = Math.max(0, t); const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
  const status = m => window.UIXApp?.status?.(m);
  const allAssets = () => ['Sprite', 'Audio', 'MIDI', 'Font'].flatMap(t => Assets[t] || []);
  const stem = n => String(n || 'Audio').replace(/\.[^.]+$/, '');
  function uniqueFilename(base, ignore) {
    const clean = String(base || 'Audio').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Audio';
    const used = f => allAssets().some(a => a !== ignore && String(a?.filename || '').toLowerCase() === f.toLowerCase());
    if (!used(`${clean}.wav`)) return `${clean}.wav`;
    for (let i = 2; i < 100000; i++) if (!used(`${clean} (${i}).wav`)) return `${clean} (${i}).wav`;
    return `${clean} (${Date.now()}).wav`;
  }
  async function decodeBytes(arrayBuffer) {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) throw new Error('Web Audio is unavailable in this browser');
    const ab = await new Ctx(2, 1, SR).decodeAudioData(arrayBuffer.slice(0));
    const L = Float32Array.from(ab.getChannelData(0)), R = ab.numberOfChannels > 1 ? Float32Array.from(ab.getChannelData(1)) : Float32Array.from(L);
    return { L, R };
  }
  const newTrack = (name, pcm, offset, index) => ({ name, color: COLORS[index % COLORS.length], L: pcm.L, R: pcm.R, offset: Math.max(0, offset || 0), vol: 1, pan: 0, mute: false, solo: false });
  const cloneTrack = t => ({ name: t.name, color: t.color, L: t.L, R: t.R, offset: t.offset, vol: t.vol, pan: t.pan, mute: t.mute, solo: t.solo });

  /* ---------------------------------------------------------------- Editor */
  function closeEditor() {
    if (closeHook) { try { closeHook(); } catch { /* ignore */ } closeHook = null; }
    if (modal) { window.UIXApp?.closeModal?.(modal); modal.remove(); modal = null; }
  }

  async function openEdit(asset) {
    let pcm = null;
    try { pcm = await decodeBytes(await (await fetch(asset.value)).arrayBuffer()); }
    catch (err) { status(`Could not open audio: ${err?.message || err}`); return; }
    openEditor({ name: stem(asset.filename || asset.name), sourceAsset: asset, tracks: [newTrack(stem(asset.name || 'Audio'), pcm, 0, 0)], markers: Array.isArray(asset.markers) ? asset.markers.map(m => ({ ...m })) : [] });
  }
  function openCreate() { openEditor({ name: 'Recording', sourceAsset: null, tracks: [], markers: [] }); }

  function openEditor(config) {
    closeEditor();
    modal = document.createElement('section');
    modal.className = 'modal uix-audio-modal';
    modal.id = `uix-audio-modal-${++seq}`;
    modal.dataset.closeOutside = 'false';
    modal.innerHTML = `
      <div class="uix-audio-header">
        <div class="uix-audio-title"><strong>Audio Editor</strong><input data-au-name class="uix-audio-name" maxlength="80" placeholder="Audio name" aria-label="Audio name"></div>
        <div class="uix-audio-actions"><button class="btn uix-audio-panelbtn" data-au-sidetoggle type="button" aria-expanded="false">Panel</button><button class="btn" data-au-cancel type="button">Cancel</button><button class="btn primary" data-au-save type="button">Save Audio</button></div>
      </div>
      <div class="uix-audio-toolbar">
        <div class="uix-audio-grp">
          <button class="uix-audio-tb rec" data-au-rec type="button" title="Record from microphone"><span class="dot"></span><span>Record</span></button>
          <button class="uix-audio-tb" data-au-recpause type="button" title="Pause / resume recording" disabled>Pause</button>
          <button class="uix-audio-tb" data-au-stop type="button" title="Stop (Space)">Stop</button>
          <button class="uix-audio-tb" data-au-play type="button" title="Play / pause (Space)">Play</button>
          <button class="uix-audio-tb toggle" data-au-loop type="button" title="Loop playback">Loop</button>
          <span class="uix-audio-time" data-au-time>0:00.00</span>
        </div><div class="uix-audio-sep"></div>
        <div class="uix-audio-grp">
          <button class="uix-audio-tb" data-au-undo type="button" title="Undo (Ctrl+Z)">Undo</button>
          <button class="uix-audio-tb" data-au-redo type="button" title="Redo (Ctrl+Y)">Redo</button>
        </div><div class="uix-audio-sep"></div>
        <div class="uix-audio-grp">
          <button class="uix-audio-tb" data-au-cut type="button" title="Cut (Ctrl+X)">Cut</button>
          <button class="uix-audio-tb" data-au-copy type="button" title="Copy (Ctrl+C)">Copy</button>
          <button class="uix-audio-tb" data-au-paste type="button" title="Paste (Ctrl+V)">Paste</button>
          <button class="uix-audio-tb" data-au-delete type="button" title="Delete selection (Del)">Delete</button>
          <button class="uix-audio-tb" data-au-trim type="button" title="Keep only the selection">Trim</button>
          <button class="uix-audio-tb" data-au-silence type="button" title="Silence the selection">Silence</button>
          <button class="uix-audio-tb" data-au-split type="button" title="Split the active track at the playhead into two tracks">Split</button>
        </div><div class="uix-audio-sep"></div>
        <div class="uix-audio-grp">
          <button class="uix-audio-tb active" data-au-tool="select" type="button" title="Select ranges">Select</button>
          <button class="uix-audio-tb" data-au-tool="move" type="button" title="Drag a track to move it in time">Move</button>
          <button class="uix-audio-tb" data-au-zoomout type="button" title="Zoom out (-)">−</button>
          <button class="uix-audio-tb" data-au-zoomin type="button" title="Zoom in (+)">+</button>
          <button class="uix-audio-tb" data-au-fit type="button" title="Fit everything">Fit</button>
        </div><div class="uix-audio-sep"></div>
        <div class="uix-audio-grp">
          <button class="uix-audio-tb" data-au-import type="button">Import Audio</button>
          <button class="uix-audio-tb" data-au-addtrack type="button">Add Empty Track</button>
        </div>
      </div>
      <div class="uix-audio-main">
        <div class="uix-audio-stage">
          <div class="uix-audio-rulerrow"><div class="uix-audio-corner">Tracks</div><div class="uix-audio-rulerwrap"><canvas data-au-ruler></canvas></div></div>
          <div class="uix-audio-scroll" data-au-scroll>
            <div class="uix-audio-headers" data-au-headers></div>
            <div class="uix-audio-lanes" data-au-lanewrap><canvas data-au-lanes></canvas><div class="uix-audio-empty" data-au-empty>Record from your microphone, import a file, or drop audio here.</div></div>
          </div>
          <div class="uix-audio-hbar"><input type="range" data-au-hscroll min="0" max="1000" value="0" aria-label="Scroll timeline"></div>
          <div class="uix-audio-statusbar"><span data-au-sel>No selection</span><span class="uix-audio-meter"><i data-au-meter></i></span></div>
        </div>
        <aside class="uix-audio-side">
          <section class="uix-audio-card"><h4>Effects</h4>
            <select data-au-fx aria-label="Effect"></select>
            <div class="uix-audio-fxparams" data-au-fxparams></div>
            <button class="btn primary" data-au-fxapply type="button">Apply</button>
            <p class="uix-audio-hint" data-au-fxhint></p>
          </section>
          <section class="uix-audio-card"><h4>Markers</h4>
            <div class="uix-audio-row"><button class="btn" data-au-addmarker type="button">Add at playhead</button><button class="btn" data-au-recopt type="button" title="Toggle microphone voice cleanup">Voice cleanup: Off</button></div>
            <div class="uix-audio-markers" data-au-markers></div>
          </section>
          <section class="uix-audio-card"><h4>Export</h4>
            <label class="uix-audio-field"><span>Sample rate</span><select data-au-exrate><option value="44100">44.1 kHz</option><option value="22050">22.05 kHz</option><option value="11025">11.025 kHz</option></select></label>
            <label class="uix-audio-field"><span>Channels</span><select data-au-exch><option value="2">Stereo</option><option value="1">Mono</option></select></label>
            <label class="uix-audio-field"><span>Bit depth</span><select data-au-exbits><option value="16">16-bit</option><option value="8">8-bit</option></select></label>
            <label class="uix-audio-check"><input type="checkbox" data-au-exclip checked><span>Prevent clipping</span></label>
            <button class="btn" data-au-saveas type="button" title="Save the selected range as a separate audio asset">Save selection as new asset</button>
            <p class="uix-audio-hint" data-au-exinfo></p>
          </section>
        </aside>
      </div>
      <input type="file" data-au-file accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac,.aac" multiple hidden>`;
    document.body.append(modal);
    window.UIXApp?.showModal?.(modal);
    const q = s => modal.querySelector(s), qa = s => [...modal.querySelectorAll(s)];

    const st = {
      name: config.name || 'Recording', source: config.sourceAsset || null,
      tracks: (config.tracks || []).map(cloneTrack), markers: (config.markers || []).map(m => ({ name: String(m.name || 'Marker'), time: Math.max(0, Number(m.time) || 0) })),
      active: 0, sel: null, head: 0, tool: 'select', pps: 100, view: 0, loop: false, clip: null,
      history: [], redo: [], playing: false, ctx: null, src: null, playStart: 0, playFrom: 0, playTo: 0, raf: 0, voice: false,
      rec: null, W: 0, H: 0, dpr: 1, dirty: false
    };
    q('[data-au-name]').value = st.name;
    const rulerC = q('[data-au-ruler]'), laneC = q('[data-au-lanes]'), scrollEl = q('[data-au-scroll]'), headersEl = q('[data-au-headers]'), hbar = q('[data-au-hscroll]');

    const totalLen = () => Math.max(10, ...st.tracks.map(t => t.offset + t.L.length / SR + 2));
    const tToX = t => (t - st.view) * st.pps, xToT = x => x / st.pps + st.view;
    const activeTrack = () => st.tracks[st.active] || null;
    const snapshot = () => ({ tracks: st.tracks.map(cloneTrack), markers: st.markers.map(m => ({ ...m })), active: st.active, sel: st.sel ? { ...st.sel } : null });
    const restore = s => { st.tracks = s.tracks.map(cloneTrack); st.markers = s.markers.map(m => ({ ...m })); st.active = clamp(s.active, 0, Math.max(0, st.tracks.length - 1)); st.sel = s.sel ? { ...s.sel } : null; };
    const pushHistory = () => { st.history.push(snapshot()); if (st.history.length > MAX_HISTORY) st.history.shift(); st.redo = []; st.dirty = true; invalidateMix(); };
    let mixCache = null; const invalidateMix = () => { mixCache = null; };
    const getMix = () => mixCache || (mixCache = DSP.mixdown(st.tracks, SR));

    function sizeCanvases() {
      LANE_H = window.innerHeight <= 520 ? 76 : 112;
      const wrap = q('[data-au-lanewrap]'), rw = q('.uix-audio-rulerwrap');
      st.dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(50, Math.floor(wrap.clientWidth)), H = Math.max(LANE_H * Math.max(1, st.tracks.length), scrollEl.clientHeight);
      st.W = W; st.H = H;
      for (const [c, h] of [[laneC, H], [rulerC, 28]]) { c.width = Math.round(W * st.dpr); c.height = Math.round(h * st.dpr); c.style.width = `${W}px`; c.style.height = `${h}px`; }
      rw.style.height = '28px';
      headersEl.style.minHeight = `${H}px`;
    }

    /* ----- drawing ----- */
    function peaksFor(t) {
      if (t._pk && t._pkL === t.L && t._pkR === t.R) return t._pk;
      t._pk = { L: DSP.buildPeaks(t.L), R: t.R === t.L ? null : DSP.buildPeaks(t.R) }; t._pkL = t.L; t._pkR = t.R; return t._pk;
    }
    function colExtent(t, pk, s0, s1) {
      let lo = 1, hi = -1;
      const scan = (arr, p) => {
        if (s1 - s0 >= BLOCK * 2 && p) { const b0 = Math.floor(s0 / BLOCK), b1 = Math.min(p.min.length - 1, Math.ceil(s1 / BLOCK)); for (let b = b0; b <= b1; b++) { if (p.min[b] < lo) lo = p.min[b]; if (p.max[b] > hi) hi = p.max[b]; } }
        else { const e = Math.min(arr.length, Math.max(s1, s0 + 1)); for (let i = Math.max(0, s0); i < e; i++) { const v = arr[i]; if (v < lo) lo = v; if (v > hi) hi = v; } }
      };
      scan(t.L, pk.L); if (t.R !== t.L) scan(t.R, pk.R || pk.L);
      return lo > hi ? null : [lo, hi];
    }
    function drawLanes() {
      const g = laneC.getContext('2d'), W = st.W, H = st.H; g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); g.clearRect(0, 0, W, H);
      const rows = Math.max(1, st.tracks.length);
      for (let i = 0; i < Math.ceil(H / LANE_H); i++) { g.fillStyle = i === st.active && st.tracks[i] ? '#2a2922' : i % 2 ? '#222' : '#252525'; g.fillRect(0, i * LANE_H, W, LANE_H); g.fillStyle = '#333'; g.fillRect(0, (i + 1) * LANE_H - 1, W, 1); }
      st.tracks.forEach((t, i) => {
        const y = i * LANE_H, mid = y + LANE_H / 2, amp = LANE_H / 2 - 8, len = t.L.length / SR;
        const x0 = tToX(t.offset), x1 = tToX(t.offset + len); if (x1 < 0 || x0 > W) return;
        g.globalAlpha = t.mute ? 0.35 : 1; g.fillStyle = t.color + '18'; g.fillRect(Math.max(0, x0), y + 3, Math.min(W, x1) - Math.max(0, x0), LANE_H - 7);
        g.strokeStyle = t.color + '88'; g.lineWidth = 1; g.strokeRect(Math.round(x0) + .5, y + 3.5, Math.round(x1 - x0), LANE_H - 7);
        const pk = peaksFor(t); g.fillStyle = t.color;
        for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
          const s0 = Math.floor((xToT(x) - t.offset) * SR), s1 = Math.ceil((xToT(x + 1) - t.offset) * SR);
          if (s1 < 0 || s0 >= t.L.length) continue;
          const e = colExtent(t, pk, s0, s1); if (!e) continue;
          const top = mid - clamp(e[1], -1, 1) * amp, bot = mid - clamp(e[0], -1, 1) * amp; g.fillRect(x, top, 1, Math.max(1, bot - top));
        }
        g.globalAlpha = 1; g.fillStyle = '#ffffff1c'; g.fillRect(Math.max(0, x0), mid, Math.min(W, x1) - Math.max(0, x0), 1);
      });
      if (st.sel) { const xa = tToX(st.sel.a), xb = tToX(st.sel.b); g.fillStyle = '#e4ca4e22'; g.fillRect(xa, 0, xb - xa, H); g.fillStyle = '#e4ca4e'; g.fillRect(xa, 0, 1, H); g.fillRect(xb, 0, 1, H); if (st.tracks.length) { g.fillStyle = '#e4ca4e1c'; g.fillRect(xa, st.active * LANE_H, xb - xa, LANE_H); } }
      g.fillStyle = '#e4ca4e'; for (const m of st.markers) { const x = tToX(m.time); if (x >= 0 && x <= W) g.fillRect(Math.round(x), 0, 1, H); }
      const hx = tToX(st.playing ? currentTime() : st.head); if (hx >= 0 && hx <= W) { g.fillStyle = '#ff5f5f'; g.fillRect(Math.round(hx), 0, 1, H); }
    }
    function drawRuler() {
      const g = rulerC.getContext('2d'), W = st.W; g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); g.clearRect(0, 0, W, 28);
      g.fillStyle = '#292929'; g.fillRect(0, 0, W, 28); g.fillStyle = '#414141'; g.fillRect(0, 27, W, 1);
      const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]; const step = steps.find(s => s * st.pps >= 70) || 600;
      g.font = '10px ui-monospace,Consolas,monospace'; g.textBaseline = 'top';
      for (let t = Math.floor(st.view / step) * step; t < xToT(W) + step; t += step) { const x = Math.round(tToX(t)) + .5; g.fillStyle = '#666'; g.fillRect(x, 16, 1, 11); g.fillStyle = '#999'; g.fillText(fmtTime(t), x + 3, 3); }
      for (const m of st.markers) { const x = tToX(m.time); if (x < -60 || x > W) continue; g.fillStyle = '#e4ca4e'; g.beginPath(); g.moveTo(x, 27); g.lineTo(x - 4, 19); g.lineTo(x + 4, 19); g.closePath(); g.fill(); g.fillStyle = '#e4ca4e'; g.fillText(m.name, x + 6, 16); }
      const hx = tToX(st.playing ? currentTime() : st.head); g.fillStyle = '#ff5f5f'; g.fillRect(Math.round(hx) - 4, 0, 9, 3); g.fillRect(Math.round(hx), 0, 1, 28);
    }
    function redraw() { drawRuler(); drawLanes(); updateTime(); }
    function updateTime() { q('[data-au-time]').textContent = fmtTime(st.playing ? currentTime() : st.head); }

    function renderHeaders() {
      headersEl.innerHTML = '';
      st.tracks.forEach((t, i) => {
        const d = document.createElement('div'); d.className = `uix-audio-th${i === st.active ? ' active' : ''}`; d.style.height = `${LANE_H}px`; d.style.setProperty('--tc', t.color);
        d.innerHTML = `<div class="uix-audio-th-top"><input class="uix-audio-th-name" value="${esc(t.name)}" maxlength="40" aria-label="Track name"><button class="uix-audio-mini${t.mute ? ' on' : ''}" data-m title="Mute">M</button><button class="uix-audio-mini${t.solo ? ' on' : ''}" data-s title="Solo">S</button><button class="uix-audio-mini" data-x title="Remove track">×</button></div>
          <label class="uix-audio-th-row"><span>Vol</span><input type="range" min="0" max="2" step="0.01" value="${t.vol}" data-v><output>${Math.round(t.vol * 100)}%</output></label>
          <label class="uix-audio-th-row"><span>Pan</span><input type="range" min="-1" max="1" step="0.01" value="${t.pan}" data-p><output>${t.pan === 0 ? 'C' : (t.pan < 0 ? 'L' : 'R') + Math.round(Math.abs(t.pan) * 100)}</output></label>`;
        d.addEventListener('pointerdown', e => { if (e.target.closest('button,input')) return; setActive(i); });
        d.querySelector('.uix-audio-th-name').addEventListener('focus', () => setActive(i));
        d.querySelector('.uix-audio-th-name').addEventListener('change', e => { pushHistory(); t.name = e.target.value.trim() || `Track ${i + 1}`; });
        d.querySelector('[data-m]').onclick = () => { pushHistory(); t.mute = !t.mute; renderHeaders(); redraw(); stopPlayback(); };
        d.querySelector('[data-s]').onclick = () => { pushHistory(); t.solo = !t.solo; renderHeaders(); redraw(); stopPlayback(); };
        d.querySelector('[data-x]').onclick = () => { pushHistory(); st.tracks.splice(i, 1); st.active = clamp(st.active, 0, Math.max(0, st.tracks.length - 1)); afterChange(); };
        const vol = d.querySelector('[data-v]'), pan = d.querySelector('[data-p]');
        vol.addEventListener('pointerdown', pushHistory); pan.addEventListener('pointerdown', pushHistory);
        vol.oninput = () => { t.vol = Number(vol.value); vol.nextElementSibling.textContent = `${Math.round(t.vol * 100)}%`; invalidateMix(); };
        pan.oninput = () => { t.pan = Number(pan.value); pan.nextElementSibling.textContent = t.pan === 0 ? 'C' : (t.pan < 0 ? 'L' : 'R') + Math.round(Math.abs(t.pan) * 100); invalidateMix(); };
        vol.addEventListener('change', stopPlayback); pan.addEventListener('change', stopPlayback);
        headersEl.append(d);
      });
      q('[data-au-empty]').hidden = st.tracks.length > 0;
    }
    function renderMarkers() {
      const host = q('[data-au-markers]'); host.innerHTML = '';
      if (!st.markers.length) { host.innerHTML = '<div class="uix-audio-hint">No markers yet.</div>'; return; }
      [...st.markers].sort((a, b) => a.time - b.time).forEach(m => {
        const r = document.createElement('div'); r.className = 'uix-audio-marker';
        r.innerHTML = `<button class="uix-audio-link" title="Jump to marker">${fmtTime(m.time)}</button><input value="${esc(m.name)}" maxlength="30" aria-label="Marker name"><button class="uix-audio-mini" title="Delete marker">×</button>`;
        r.querySelector('button').onclick = () => { st.head = m.time; ensureVisible(m.time); redraw(); };
        r.querySelector('input').addEventListener('change', e => { pushHistory(); m.name = e.target.value.trim() || 'Marker'; redraw(); });
        r.querySelector('.uix-audio-mini').onclick = () => { pushHistory(); st.markers.splice(st.markers.indexOf(m), 1); renderMarkers(); redraw(); };
        host.append(r);
      });
    }
    function updateSide() {
      const sel = st.sel, t = activeTrack();
      q('[data-au-sel]').textContent = sel ? `Selection ${fmtTime(sel.a)} – ${fmtTime(sel.b)}  (${(sel.b - sel.a).toFixed(3)} s)${t ? ` · ${t.name}` : ''}` : (t ? `Active track: ${t.name} · ${(t.L.length / SR).toFixed(2)} s` : 'No tracks');
      const [L] = getMix(); q('[data-au-exinfo]').textContent = `Output length ${(L.length / SR).toFixed(2)} s`;
      q('[data-au-undo]').disabled = !st.history.length; q('[data-au-redo]').disabled = !st.redo.length;
      q('[data-au-fxhint]').textContent = sel ? 'Applies to the selection on the active track.' : 'No selection: applies to the whole active track.';
    }
    function updateHScroll() {
      const total = totalLen(), vis = st.W / st.pps; hbar.max = String(Math.max(0, Math.round((total - vis) * 100))); hbar.value = String(Math.round(st.view * 100)); hbar.disabled = total <= vis;
    }
    function afterChange() { sizeCanvases(); renderHeaders(); renderMarkers(); updateSide(); updateHScroll(); redraw(); }
    function setActive(i) { if (i === st.active || !st.tracks[i]) return; st.active = i; qa('.uix-audio-th').forEach((e, k) => e.classList.toggle('active', k === i)); updateSide(); redraw(); }
    function ensureVisible(t) { const vis = st.W / st.pps; if (t < st.view || t > st.view + vis) st.view = Math.max(0, t - vis * 0.2); updateHScroll(); }

    /* ----- editing ----- */
    const rangeOf = (t, whole = true) => {
      if (!st.sel) return whole ? [0, t.L.length] : null;
      const a = clamp(Math.round((st.sel.a - t.offset) * SR), 0, t.L.length), b = clamp(Math.round((st.sel.b - t.offset) * SR), 0, t.L.length);
      return b > a ? [a, b] : null;
    };
    function needTrack() { const t = activeTrack(); if (!t) status('Add or record a track first'); return t; }
    function splice(t, a, b, repL, repR) {
      const join = (arr, rep) => { const o = new Float32Array(a + rep.length + (arr.length - b)); o.set(arr.subarray(0, a), 0); o.set(rep, a); o.set(arr.subarray(b), a + rep.length); return o; };
      t.L = join(t.L, repL); t.R = join(t.R, repR);
    }
    function applyFx(key, params) {
      const t = needTrack(); if (!t) return; const r = rangeOf(t, true); if (!r) return status('The selection is outside the active track');
      const [a, b] = r; if (b <= a) return status('Nothing to process');
      pushHistory(); const out = FX[key].run([t.L.slice(a, b), t.R.slice(a, b)], SR, params);
      splice(t, a, b, out[0], out[1]);
      if (st.sel && out[0].length !== b - a) st.sel = { a: st.sel.a, b: st.sel.a + out[0].length / SR };
      afterChange(); stopPlayback(); status(`${FX[key].label} applied`);
    }
    const copySel = () => { const t = activeTrack(); if (!t) return false; const r = rangeOf(t, false); if (!r) { status('Select a range first'); return false; } st.clip = { L: t.L.slice(r[0], r[1]), R: t.R.slice(r[0], r[1]) }; status('Copied'); return true; };
    function deleteSel(isCut) {
      const t = needTrack(); if (!t) return; const r = rangeOf(t, false); if (!r) return status('Select a range first');
      if (isCut) st.clip = { L: t.L.slice(r[0], r[1]), R: t.R.slice(r[0], r[1]) };
      pushHistory(); splice(t, r[0], r[1], new Float32Array(0), new Float32Array(0)); st.head = st.sel.a; st.sel = null; afterChange(); stopPlayback();
    }
    function pasteClip() {
      if (!st.clip) return status('Nothing to paste');
      let t = activeTrack(); pushHistory();
      if (!t) { st.tracks.push(newTrack('Track 1', { L: new Float32Array(0), R: new Float32Array(0) }, st.head, 0)); st.active = 0; t = st.tracks[0]; }
      const at = clamp(Math.round(((st.sel ? st.sel.a : st.head) - t.offset) * SR), 0, t.L.length);
      splice(t, at, at, st.clip.L, st.clip.R); st.sel = { a: t.offset + at / SR, b: t.offset + (at + st.clip.L.length) / SR }; afterChange(); stopPlayback();
    }
    function trimSel() {
      const t = needTrack(); if (!t) return; const r = rangeOf(t, false); if (!r) return status('Select a range first');
      pushHistory(); t.L = t.L.slice(r[0], r[1]); t.R = t.R === t.L ? t.L : t.R.slice(r[0], r[1]); t.offset += r[0] / SR; afterChange(); stopPlayback();
    }
    function silenceSel() {
      const t = needTrack(); if (!t) return; const r = rangeOf(t, false); if (!r) return status('Select a range first');
      pushHistory(); const z = new Float32Array(r[1] - r[0]); splice(t, r[0], r[1], z, z); afterChange(); stopPlayback();
    }
    function splitAtHead() {
      const t = needTrack(); if (!t) return; const at = Math.round((st.head - t.offset) * SR);
      if (at <= 0 || at >= t.L.length) return status('Place the playhead inside the active track to split it');
      pushHistory(); const tail = cloneTrack(t); tail.name = `${t.name} (2)`; tail.L = t.L.slice(at); tail.R = t.R.slice(at); tail.offset = t.offset + at / SR; t.L = t.L.slice(0, at); t.R = t.R.slice(0, at);
      st.tracks.splice(st.active + 1, 0, tail); afterChange(); stopPlayback();
    }
    function undo() { if (!st.history.length) return; st.redo.push(snapshot()); restore(st.history.pop()); invalidateMix(); afterChange(); stopPlayback(); }
    function redo() { if (!st.redo.length) return; st.history.push(snapshot()); restore(st.redo.pop()); invalidateMix(); afterChange(); stopPlayback(); }
    function addPcmTrack(name, pcm, offset) { pushHistory(); st.tracks.push(newTrack(name, pcm, offset, st.tracks.length)); st.active = st.tracks.length - 1; afterChange(); }

    /* ----- import ----- */
    async function importFiles(files) {
      for (const f of files) {
        if (!(f.type.startsWith('audio/') || /\.(wav|mp3|ogg|oga|m4a|flac|aac|webm)$/i.test(f.name))) { status(`${f.name} is not an audio file`); continue; }
        try { addPcmTrack(stem(f.name), await decodeBytes(await f.arrayBuffer()), st.head); fitView(); status(`Imported ${f.name}`); }
        catch (err) { status(`Could not decode ${f.name}: ${err?.message || err}`); }
      }
    }

    /* ----- playback ----- */
    const currentTime = () => st.ctx && st.playing ? st.playFrom + (st.ctx.currentTime - st.playStart) : st.head;
    function ensureCtx() { if (!st.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) throw new Error('Web Audio is unavailable'); st.ctx = new C(); } if (st.ctx.state === 'suspended') st.ctx.resume(); return st.ctx; }
    function startPlayback() {
      if (!st.tracks.length) return status('Nothing to play');
      if (st.rec) return status('Stop recording first');
      let ctx; try { ctx = ensureCtx(); } catch (e) { return status(e.message); }
      const [L, R] = getMix(); if (!L.length) return;
      const buf = ctx.createBuffer(2, L.length, SR); buf.copyToChannel(L, 0); buf.copyToChannel(R, 1);
      const from = st.sel ? st.sel.a : st.head, to = st.sel ? st.sel.b : L.length / SR;
      if (from >= L.length / SR) st.head = 0;
      const start = from >= L.length / SR ? 0 : from;
      const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
      if (st.loop) { src.loop = true; src.loopStart = st.sel ? st.sel.a : 0; src.loopEnd = st.sel ? st.sel.b : L.length / SR; }
      src.onended = () => { if (st.src === src) { st.playing = false; st.src = null; cancelAnimationFrame(st.raf); updatePlayButton(); redraw(); } };
      src.start(0, start, st.loop ? undefined : Math.max(0.001, to - start));
      st.src = src; st.playFrom = start; st.playTo = to; st.playStart = ctx.currentTime; st.playing = true; updatePlayButton(); tick();
    }
    function stopPlayback(keepHead) {
      if (st.src) { const s = st.src; st.src = null; try { s.onended = null; s.stop(); } catch { /* ignore */ } }
      if (st.playing && !keepHead) st.head = clamp(currentTime(), 0, 1e9);
      st.playing = false; cancelAnimationFrame(st.raf); updatePlayButton();
    }
    function tick() {
      if (!st.playing) return;
      let t = currentTime();
      if (st.loop && st.sel) { const len = st.sel.b - st.sel.a; if (len > 0 && t > st.sel.b) t = st.sel.a + ((t - st.sel.a) % len); }
      st.head = t; const hx = tToX(t); if (hx > st.W - 40 || hx < 0) { st.view = Math.max(0, t - 1); updateHScroll(); }
      redraw(); st.raf = requestAnimationFrame(tick);
    }
    function updatePlayButton() { q('[data-au-play]').textContent = st.playing ? 'Pause' : 'Play'; }
    function togglePlay() { if (st.playing) stopPlayback(); else startPlayback(); }
    function stopAll() { if (st.rec) stopRecording(); const was = st.playing; stopPlayback(); if (!was) st.head = 0; ensureVisible(st.head); redraw(); }

    /* ----- recording ----- */
    async function startRecording() {
      if (st.rec) return stopRecording();
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return status('Recording is not supported in this browser or context (needs HTTPS)');
      stopPlayback();
      let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: st.voice, noiseSuppression: st.voice, autoGainControl: st.voice } }); }
      catch (err) { return status(`Microphone unavailable: ${err?.name === 'NotAllowedError' ? 'permission denied' : err?.message || err}`); }
      const rec = new MediaRecorder(stream), chunks = [], startHead = st.head;
      let meterCtx = null, an = null, buf = null, meterRaf = 0;
      try { const C = window.AudioContext || window.webkitAudioContext; meterCtx = new C(); an = meterCtx.createAnalyser(); an.fftSize = 1024; meterCtx.createMediaStreamSource(stream).connect(an); buf = new Uint8Array(an.fftSize); } catch { /* meter optional */ }
      const meter = q('[data-au-meter]');
      const loop = () => { if (!st.rec) return; if (an) { an.getByteTimeDomainData(buf); let p = 0; for (const v of buf) p = Math.max(p, Math.abs(v - 128) / 128); meter.style.width = `${Math.round(clamp(p, 0, 1) * 100)}%`; } q('[data-au-time]').textContent = fmtTime(startHead + (performance.now() - st.rec.t0 - st.rec.paused) / 1000); meterRaf = requestAnimationFrame(loop); };
      rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = async () => {
        cancelAnimationFrame(meterRaf); stream.getTracks().forEach(t => t.stop()); try { meterCtx?.close(); } catch { /* ignore */ } meter.style.width = '0%';
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }); st.rec = null; updateRecButtons();
        if (!blob.size) return status('Nothing was recorded');
        try { const n = st.tracks.filter(t => /^Recording/.test(t.name)).length + 1; addPcmTrack(`Recording ${n}`, await decodeBytes(await blob.arrayBuffer()), startHead); st.head = startHead; fitView(); status('Recording added as a new track'); }
        catch (err) { status(`Could not decode the recording: ${err?.message || err}`); }
      };
      st.rec = { rec, t0: performance.now(), paused: 0, pausedAt: 0, stream }; rec.start(250); updateRecButtons(); loop();
    }
    function stopRecording() { if (st.rec?.rec && st.rec.rec.state !== 'inactive') st.rec.rec.stop(); }
    function pauseRecording() {
      const r = st.rec; if (!r) return;
      if (r.rec.state === 'recording') { r.rec.pause(); r.pausedAt = performance.now(); } else if (r.rec.state === 'paused') { r.rec.resume(); r.paused += performance.now() - r.pausedAt; }
      updateRecButtons();
    }
    function updateRecButtons() {
      const on = !!st.rec; const b = q('[data-au-rec]'); b.classList.toggle('active', on); b.querySelector('span:last-child').textContent = on ? 'Stop Rec' : 'Record';
      const p = q('[data-au-recpause]'); p.disabled = !on; p.textContent = on && st.rec.rec.state === 'paused' ? 'Resume' : 'Pause';
    }

    /* ----- view ----- */
    function fitView() { const total = Math.max(1, Math.max(0, ...st.tracks.map(t => t.offset + t.L.length / SR))); st.pps = clamp((st.W - 20) / total, 2, 20000); st.view = 0; updateHScroll(); redraw(); }
    function zoom(f, anchorX) { const ax = anchorX ?? st.W / 2, at = xToT(ax); st.pps = clamp(st.pps * f, 2, 20000); st.view = Math.max(0, at - ax / st.pps); updateHScroll(); redraw(); }

    /* ----- pointer interaction ----- */
    let drag = null;
    const laneT = e => { const r = laneC.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    laneC.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return; laneC.setPointerCapture(e.pointerId); const p = laneT(e), t = xToT(p.x), lane = Math.floor(p.y / LANE_H);
      if (st.tracks[lane]) setActive(lane);
      if (st.tool === 'move' && st.tracks[lane]) { pushHistory(); drag = { kind: 'move', id: e.pointerId, t0: t, off0: st.tracks[lane].offset, lane }; return; }
      if (st.playing) stopPlayback(true);
      if (e.shiftKey && st.sel) { drag = { kind: 'sel', id: e.pointerId, anchor: Math.abs(t - st.sel.a) < Math.abs(t - st.sel.b) ? st.sel.b : st.sel.a }; } else drag = { kind: 'sel', id: e.pointerId, anchor: Math.max(0, t), moved: false, startX: p.x };
      if (e.detail === 2 && st.tracks[lane]) { const tr = st.tracks[lane]; st.sel = { a: tr.offset, b: tr.offset + tr.L.length / SR }; drag = null; updateSide(); redraw(); }
    });
    laneC.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return; const p = laneT(e), t = Math.max(0, xToT(p.x));
      if (drag.kind === 'move') { st.tracks[drag.lane].offset = Math.max(0, drag.off0 + t - drag.t0); invalidateMix(); redraw(); return; }
      if (!drag.moved && drag.startX !== undefined && Math.abs(p.x - drag.startX) < 3) return; drag.moved = true;
      const a = Math.min(drag.anchor, t), b = Math.max(drag.anchor, t); st.sel = b - a > 0.0005 ? { a, b } : null; updateSide(); redraw();
    });
    const endDrag = e => {
      if (!drag || e.pointerId !== drag.id) return; const d = drag; drag = null;
      if (d.kind === 'move') { updateHScroll(); updateSide(); return; }
      if (!d.moved && d.startX !== undefined && !e.shiftKey) { st.sel = null; st.head = Math.max(0, d.anchor); }
      updateSide(); redraw();
    };
    laneC.addEventListener('pointerup', endDrag); laneC.addEventListener('pointercancel', endDrag);
    let rdrag = false;
    rulerC.addEventListener('pointerdown', e => { rulerC.setPointerCapture(e.pointerId); rdrag = true; const r = rulerC.getBoundingClientRect(); if (st.playing) stopPlayback(true); st.head = Math.max(0, xToT(e.clientX - r.left)); redraw(); });
    rulerC.addEventListener('pointermove', e => { if (!rdrag) return; const r = rulerC.getBoundingClientRect(); st.head = Math.max(0, xToT(e.clientX - r.left)); redraw(); });
    rulerC.addEventListener('pointerup', () => { rdrag = false; });
    const wheel = e => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); const r = laneC.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left); }
      else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); st.view = Math.max(0, st.view + (e.deltaX || e.deltaY) / st.pps); updateHScroll(); redraw(); }
    };
    laneC.addEventListener('wheel', wheel, { passive: false }); rulerC.addEventListener('wheel', wheel, { passive: false });
    hbar.addEventListener('input', () => { st.view = Number(hbar.value) / 100; redraw(); });

    /* ----- effects panel ----- */
    const fxSel = q('[data-au-fx]'), fxBox = q('[data-au-fxparams]');
    Object.entries(FX).forEach(([k, f]) => fxSel.append(new Option(f.label, k)));
    function renderFxParams() {
      const f = FX[fxSel.value]; fxBox.innerHTML = '';
      f.params.forEach(p => {
        const row = document.createElement('label'); row.className = 'uix-audio-field';
        if (p.options) row.innerHTML = `<span>${esc(p.label)}</span><select data-k="${p.k}">${p.options.map(o => `<option${o === p.v ? ' selected' : ''}>${o}</option>`).join('')}</select>`;
        else { row.innerHTML = `<span>${esc(p.label)}</span><input type="range" data-k="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.v}"><output>${p.v}</output>`; const i = row.querySelector('input'); i.oninput = () => { i.nextElementSibling.textContent = i.value; }; }
        fxBox.append(row);
      });
    }
    fxSel.onchange = renderFxParams; renderFxParams();
    q('[data-au-fxapply]').onclick = () => { const p = {}; fxBox.querySelectorAll('[data-k]').forEach(el => { p[el.dataset.k] = el.tagName === 'SELECT' ? el.value : Number(el.value); }); applyFx(fxSel.value, p); };

    /* ----- save / export ----- */
    function renderMix(rangeSel) {
      const rate = Number(q('[data-au-exrate]').value) || SR, mono = q('[data-au-exch]').value === '1', bits = Number(q('[data-au-exbits]').value) || 16, safe = q('[data-au-exclip]').checked;
      let chs = getMix().map(a => a);
      if (rangeSel) { const a = Math.max(0, Math.round(rangeSel.a * SR)), b = Math.min(chs[0].length, Math.round(rangeSel.b * SR)); chs = chs.map(c => c.slice(a, b)); }
      if (mono) chs = DSP.toMono(chs);
      if (safe) { const pk = DSP.peak(chs); if (pk > 1) chs = chs.map(c => DSP.gain(c, 0.999 / pk)); }
      if (rate !== SR) { chs = DSP.filter(chs, SR, 'lowpass', rate * 0.45, 0.707); chs = chs.map(c => DSP.resample(c, SR / rate)); }
      return { chs, rate, bits };
    }
    function writeAsset(filenameBase, rangeSel, target) {
      const { chs, rate, bits } = renderMix(rangeSel); if (!chs[0].length) { status('Nothing to save — the audio is empty'); return null; }
      const value = DSP.bytesToDataURL(DSP.encodeWAV(chs, rate, bits), 'audio/wav'), list = Assets.Audio || (Assets.Audio = []);
      const filename = uniqueFilename(filenameBase, target || null), name = filename.replace(/\.wav$/i, '');
      const markers = rangeSel ? [] : st.markers.map(m => ({ name: m.name, time: m.time }));
      if (target && list.includes(target)) { Object.assign(target, { name, filename, value, type: 'audio/wav', kind: 'Audio', editable: true, markers }); return target; }
      const a = { id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name, filename, value, type: 'audio/wav', kind: 'Audio', editable: true, markers }; list.push(a); return a;
    }
    q('[data-au-save]').onclick = () => {
      if (st.rec) stopRecording(); stopPlayback();
      const nm = q('[data-au-name]').value.trim() || 'Recording'; if (!st.tracks.length) return status('Add or record some audio first');
      if (writeAsset(nm, null, st.source)) { window.UIXApp?.refreshAssets?.(); status('Audio saved'); st.dirty = false; closeEditor(); }
    };
    q('[data-au-saveas]').onclick = () => {
      if (!st.sel) return status('Select a range first');
      const nm = `${q('[data-au-name]').value.trim() || 'Recording'} clip`; if (writeAsset(nm, st.sel, null)) { window.UIXApp?.refreshAssets?.(); status('Selection saved as a new audio asset'); }
    };
    const cancel = () => { const go = () => closeEditor(); if (st.dirty && window.UIXApp?.askConfirm) window.UIXApp.askConfirm('Discard changes', 'Close the Audio Editor without saving?', go, 'Discard'); else go(); };
    q('[data-au-cancel]').onclick = cancel;

    /* ----- wire buttons ----- */
    q('[data-au-rec]').onclick = startRecording; q('[data-au-recpause]').onclick = pauseRecording; q('[data-au-stop]').onclick = stopAll; q('[data-au-play]').onclick = togglePlay;
    q('[data-au-loop]').onclick = e => { st.loop = !st.loop; e.currentTarget.classList.toggle('active', st.loop); if (st.playing) { stopPlayback(); startPlayback(); } };
    q('[data-au-undo]').onclick = undo; q('[data-au-redo]').onclick = redo; q('[data-au-cut]').onclick = () => deleteSel(true); q('[data-au-copy]').onclick = copySel; q('[data-au-paste]').onclick = pasteClip;
    q('[data-au-delete]').onclick = () => deleteSel(false); q('[data-au-trim]').onclick = trimSel; q('[data-au-silence]').onclick = silenceSel; q('[data-au-split]').onclick = splitAtHead;
    qa('[data-au-tool]').forEach(b => b.onclick = () => { st.tool = b.dataset.auTool; qa('[data-au-tool]').forEach(x => x.classList.toggle('active', x === b)); laneC.style.cursor = st.tool === 'move' ? 'ew-resize' : 'text'; });
    q('[data-au-zoomin]').onclick = () => zoom(1.5); q('[data-au-zoomout]').onclick = () => zoom(1 / 1.5); q('[data-au-fit]').onclick = fitView;
    const fileIn = q('[data-au-file]'); q('[data-au-import]').onclick = () => fileIn.click(); fileIn.onchange = () => { importFiles([...fileIn.files]); fileIn.value = ''; };
    q('[data-au-addtrack]').onclick = () => addPcmTrack(`Track ${st.tracks.length + 1}`, { L: new Float32Array(0), R: new Float32Array(0) }, st.head);
    q('[data-au-addmarker]').onclick = () => { pushHistory(); st.markers.push({ name: `Marker ${st.markers.length + 1}`, time: st.head }); renderMarkers(); redraw(); };
    q('[data-au-recopt]').onclick = e => { st.voice = !st.voice; e.currentTarget.textContent = `Voice cleanup: ${st.voice ? 'On' : 'Off'}`; };
    ['[data-au-exrate]', '[data-au-exch]', '[data-au-exbits]', '[data-au-exclip]'].forEach(s => q(s).addEventListener('change', updateSide));
    q('[data-au-name]').addEventListener('input', () => { st.dirty = true; });
    modal.addEventListener('dragover', e => { e.preventDefault(); });
    modal.addEventListener('drop', e => { e.preventDefault(); const f = [...(e.dataTransfer?.files || [])]; if (f.length) importFiles(f); });

    /* ----- keyboard (captured before the editor's global shortcuts) ----- */
    const onKey = e => {
      if (!modal || !document.body.contains(modal) || modal.hidden) return;
      if (document.querySelector('.modal:not([hidden]):not(.uix-audio-modal)') && !modal.contains(e.target)) return;
      const typing = !!e.target.closest?.('input[type="text"],input:not([type]),textarea,select,[contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(); let handled = true;
      if (typing) { e.stopPropagation(); return; }
      if (e.key === ' ') togglePlay();
      else if (mod && k === 'z' && !e.shiftKey) undo();
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) redo();
      else if (mod && k === 'x') deleteSel(true);
      else if (mod && k === 'c') copySel();
      else if (mod && k === 'v') pasteClip();
      else if (mod && k === 'a') { const t = activeTrack(); if (t) { st.sel = { a: t.offset, b: t.offset + t.L.length / SR }; updateSide(); redraw(); } }
      else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel(false);
      else if (e.key === 'Home') { st.head = 0; ensureVisible(0); redraw(); }
      else if (e.key === '+' || e.key === '=') zoom(1.5);
      else if (e.key === '-') zoom(1 / 1.5);
      else if (e.key === 'Escape') { if (st.sel) { st.sel = null; updateSide(); redraw(); } else cancel(); }
      else if (mod && k === 's') { q('[data-au-save]').click(); }
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    const relayout = () => { const prev = LANE_H; sizeCanvases(); if (prev !== LANE_H) renderHeaders(); updateHScroll(); redraw(); };
    const ro = new ResizeObserver(relayout); ro.observe(q('[data-au-lanewrap]')); window.addEventListener('resize', relayout);
    q('[data-au-sidetoggle]').onclick = e => { const open = q('.uix-audio-main').classList.toggle('side-open'); e.currentTarget.setAttribute('aria-expanded', String(open)); e.currentTarget.classList.toggle('active', open); };
    closeHook = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', relayout); ro.disconnect(); if (st.rec) { st.rec.rec.onstop = null; try { st.rec.rec.stop(); } catch { /* ignore */ } st.rec.stream?.getTracks().forEach(t => t.stop()); st.rec = null; } stopPlayback(true); try { st.ctx?.close(); } catch { /* ignore */ } };
    modal.__audio = { st, applyFx, undo, redo, importFiles, deleteSel, pasteClip, copySel, trimSel, silenceSel, splitAtHead, renderMix, getMix, fitView, zoom };

    sizeCanvases(); renderHeaders(); renderMarkers(); updateSide(); fitView(); updateRecButtons(); updatePlayButton();
    laneC.style.cursor = 'text';
  }

  // Command routing from the global key dispatcher is unnecessary (see onKey), but the hook keeps parity with the other editors.
  window.UIXAudioEditor = { openCreate, openEdit, close: closeEditor, DSP, FX, SR, handleShortcut: () => {}, _modal: () => modal };
})();
