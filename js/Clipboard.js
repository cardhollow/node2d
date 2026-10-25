(() => {
  'use strict';

  const APP = 'Node2D';
  const PACKET_VERSION = 1;
  const CUSTOM_MIME = 'application/x-ndc';
  const WEB_CUSTOM_MIME = `web ${CUSTOM_MIME}`;
  const TEXT_PREFIX = 'NODE2D_NDC_CLIPBOARD_V1:';
  const BINARY_REF = '__node2dClipboardBinaryRef__';
  const BINARY_KIND = '__node2dClipboardBinaryKind__';
  let current = null;
  let writePromise = Promise.resolve();

  function clone(value, seen = new WeakMap()) {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (value instanceof Date) return new Date(value.getTime());
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) {
      try { return new value.constructor(value); } catch { return value.slice?.(0) || value; }
    }
    const out = Array.isArray(value) ? [] : {};
    seen.set(value, out);
    for (const key of Object.keys(value)) out[key] = clone(value[key], seen);
    return out;
  }

  function dataUrlInfo(value) {
    const match = String(value || '').match(/^data:([^;,]+)?(?:;charset=[^;,]*)?(;base64)?,([\s\S]*)$/i);
    if (!match) return null;
    return { mime: match[1] || 'application/octet-stream', base64: !!match[2], data: match[3] };
  }

  function packBinaryValues(value, assets, seen = new WeakMap()) {
    if (typeof value === 'string') {
      if (!dataUrlInfo(value)) return value;
      const index = assets.length;
      const info = dataUrlInfo(value);
      const extension = info.mime.includes('png') ? 'png' : info.mime.includes('jpeg') ? 'jpg' : info.mime.includes('webp') ? 'webp' : info.mime.includes('svg') ? 'svg' : info.mime.includes('midi') ? 'mid' : 'bin';
      assets.push({ id: `clipboard-binary-${index}`, name: `Clipboard Binary ${index + 1}`, filename: `clipboard-binary-${index + 1}.${extension}`, type: info.mime, kind: 'ClipboardBinary', editable: false, value });
      return { [BINARY_REF]: index };
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const index = assets.length;
      const kind = value instanceof ArrayBuffer ? 'ArrayBuffer' : value.constructor?.name || 'Uint8Array';
      const dataUrl = `data:application/octet-stream;base64,${toBase64(bytes)}`;
      assets.push({ id: `clipboard-binary-${index}`, name: `Clipboard Binary ${index + 1}`, filename: `clipboard-binary-${index + 1}.bin`, type: 'application/octet-stream', kind: 'ClipboardBinary', editable: false, value: dataUrl });
      return { [BINARY_REF]: index, [BINARY_KIND]: kind };
    }
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    const out = Array.isArray(value) ? [] : {};
    seen.set(value, out);
    for (const key of Object.keys(value)) out[key] = packBinaryValues(value[key], assets, seen);
    return out;
  }

  function restoreBinaryValues(value, assets, seen = new WeakMap()) {
    if (!value || typeof value !== 'object') return value;
    const keys = Object.keys(value);
    if (Number.isInteger(value[BINARY_REF]) && keys.every(key => key === BINARY_REF || key === BINARY_KIND)) {
      const stored = assets[value[BINARY_REF]]?.value ?? '';
      if (!value[BINARY_KIND]) return stored;
      const info = dataUrlInfo(stored);
      let bytes = new Uint8Array();
      if (info) {
        if (info.base64) bytes = fromBase64(info.data);
        else bytes = new TextEncoder().encode(decodeURIComponent(info.data));
      }
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      if (value[BINARY_KIND] === 'ArrayBuffer') return buffer;
      if (value[BINARY_KIND] === 'DataView') return new DataView(buffer);
      const Constructor = globalThis[value[BINARY_KIND]];
      if (typeof Constructor === 'function') {
        try { return new Constructor(buffer); } catch { /* Fall back to raw bytes for unsupported typed-array kinds. */ }
      }
      return bytes;
    }
    if (seen.has(value)) return seen.get(value);
    const out = Array.isArray(value) ? [] : {};
    seen.set(value, out);
    for (const key of Object.keys(value)) out[key] = restoreBinaryValues(value[key], assets, seen);
    return out;
  }

  function toBase64(bytes) {
    let raw = '';
    for (let i = 0; i < bytes.length; i += 0x8000) raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(raw);
  }

  function fromBase64(value) {
    const raw = atob(String(value || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function makeEncodedPayload(type, payload) {
    const codec = globalThis.UIXNDCCodec;
    if (!codec?.encode) return null;
    const binaryAssets = [];
    const packedPayload = packBinaryValues(clone(payload), binaryAssets);
    const project = {
      name: `${APP} Clipboard`,
      clipboardPacket: { app: APP, version: PACKET_VERSION, type: String(type), payload: packedPayload },
      assets: { ClipboardBinary: binaryAssets }
    };
    return codec.encode(project);
  }

  function decodeNdcBytes(bytes) {
    const codec = globalThis.UIXNDCCodec;
    if (!codec?.decode) return null;
    const decoded = codec.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const packet = decoded?.clipboardPacket;
    if (packet?.app === APP && Number(packet.version) === PACKET_VERSION && typeof packet.type === 'string') {
      return {
        type: packet.type,
        payload: restoreBinaryValues(packet.payload, decoded.assets?.ClipboardBinary || []),
        source: 'system'
      };
    }
    // A clipboard may contain a complete .ndc project rather than a Node2D
    // clipboard packet. Preserve that as a project payload for future paste targets.
    if (decoded && typeof decoded === 'object' && (Array.isArray(decoded.scenes) || decoded.project || decoded.assets)) {
      return { type: 'project', payload: decoded, source: 'system' };
    }
    return null;
  }

  function blobFromRepresentation(value, mime) {
    if (value instanceof Blob) return value;
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return new Blob([value], { type: mime });
    const info = dataUrlInfo(value);
    if (info) {
      let bytes;
      if (info.base64) bytes = fromBase64(info.data);
      else bytes = new TextEncoder().encode(decodeURIComponent(info.data));
      return new Blob([bytes], { type: info.mime || mime });
    }
    return new Blob([String(value ?? '')], { type: mime });
  }

  async function writeSystemClipboard(bytes, representations = {}) {
    if (!bytes) return false;
    const nav = globalThis.navigator;
    if (!nav?.clipboard) return false;
    const encodedText = `${TEXT_PREFIX}${toBase64(bytes)}`;
    const standard = {};
    for (const [mime, value] of Object.entries(representations || {})) {
      if (!mime || mime === 'text/plain') continue;
      standard[mime] = blobFromRepresentation(value, mime);
    }
    if (typeof nav.clipboard.write === 'function' && typeof globalThis.ClipboardItem === 'function') {
      const attempts = [WEB_CUSTOM_MIME, CUSTOM_MIME, null];
      for (const customType of attempts) {
        try {
          const entries = { ...standard, 'text/plain': new Blob([encodedText], { type: 'text/plain' }) };
          if (customType) entries[customType] = new Blob([bytes], { type: CUSTOM_MIME });
          await nav.clipboard.write([new ClipboardItem(entries)]);
          return true;
        } catch { /* Try the next clipboard representation. */ }
      }
    }
    if (typeof nav.clipboard.writeText === 'function') {
      try { await nav.clipboard.writeText(encodedText); return true; } catch { /* Clipboard access is optional. */ }
    }
    return false;
  }

  function set(type, payload, options = {}) {
    const record = { type: String(type || 'data'), payload: clone(payload), source: 'internal', writtenAt: Date.now() };
    current = record;
    let bytes = null;
    try { bytes = makeEncodedPayload(record.type, record.payload); } catch (error) {
      console.warn('[Node2D Clipboard] Could not encode NDC clipboard data:', error);
    }
    if (bytes) {
      // Start writing while still inside the triggering click/keyboard gesture.
      writePromise = writeSystemClipboard(bytes, options.representations || {}).catch(() => false);
    }
    return clone(record.payload);
  }

  function writeSystemClipboardDeferred(bytesPromise) {
    const nav = globalThis.navigator;
    if (!nav?.clipboard) return Promise.resolve(false);
    const resolvedBytes = Promise.resolve(bytesPromise).then(value => value instanceof Uint8Array ? value : new Uint8Array(value || 0));
    if (typeof nav.clipboard.write === 'function' && typeof globalThis.ClipboardItem === 'function') {
      const encodedText = resolvedBytes.then(bytes => new Blob([`${TEXT_PREFIX}${toBase64(bytes)}`], { type: 'text/plain' }));
      const rawBlob = resolvedBytes.then(bytes => new Blob([bytes], { type: CUSTOM_MIME }));
      const attempt = customType => {
        const entries = { 'text/plain': encodedText };
        if (customType) entries[customType] = rawBlob;
        try {
          const item = new ClipboardItem(entries);
          return Promise.resolve(nav.clipboard.write([item])).then(() => true, () => false);
        } catch {
          return Promise.resolve(false);
        }
      };
      return attempt(WEB_CUSTOM_MIME).then(ok => ok ? true : attempt(CUSTOM_MIME)).then(ok => ok ? true : attempt(null)).then(async ok => {
        if (ok) return true;
        if (typeof nav.clipboard.writeText === 'function') {
          try { await nav.clipboard.writeText(`${TEXT_PREFIX}${toBase64(await resolvedBytes)}`); return true; } catch { /* Clipboard access is optional. */ }
        }
        return false;
      });
    }
    return resolvedBytes.then(bytes => writeSystemClipboard(bytes)).catch(() => false);
  }

  function setProjectNdc(payload, bytes) {
    current = { type: 'project', payload: clone(payload), source: 'internal', writtenAt: Date.now() };
    writePromise = bytes && typeof bytes.then === 'function'
      ? writeSystemClipboardDeferred(bytes).catch(() => false)
      : writeSystemClipboard(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0)).catch(() => false);
    return clone(current.payload);
  }

  function get(type) {
    if (!current || (type && current.type !== type)) return null;
    return clone(current.payload);
  }

  function getRecord() { return current ? clone(current) : null; }
  function currentType() { return current?.type || null; }
  function has(type) { return !!current && (!type || current.type === type); }

  async function readTextBlob(blob) {
    try { return await blob.text(); } catch { return ''; }
  }

  async function blobToDataUrl(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return `data:${blob.type || 'application/octet-stream'};base64,${toBase64(bytes)}`;
  }

  async function readEncodedText(value) {
    const text = String(value || '').trim();
    if (!text.startsWith(TEXT_PREFIX)) return null;
    try { return decodeNdcBytes(fromBase64(text.slice(TEXT_PREFIX.length))); }
    catch { return null; }
  }

  function acceptExternal(record) {
    if (!record) return null;
    current = { ...record, source: 'system', writtenAt: Date.now() };
    return clone(current);
  }

  async function readExternal() {
    const nav = globalThis.navigator;
    if (!nav?.clipboard) return null;
    if (typeof nav.clipboard.read === 'function') {
      try {
        const items = await nav.clipboard.read();
        // Prefer the NDC payload so the app gets its original rich data even when
        // a standard representation (such as image/png) is available as well.
        for (const item of items || []) {
          const custom = (item.types || []).find(type => [WEB_CUSTOM_MIME, CUSTOM_MIME, 'application/x-node2d-clipboard'].includes(type));
          if (custom) {
            const blob = await item.getType(custom);
            const decoded = decodeNdcBytes(new Uint8Array(await blob.arrayBuffer()));
            if (decoded) return acceptExternal(decoded);
          }
        }
        for (const item of items || []) {
          if (!(item.types || []).includes('text/plain')) continue;
          const decoded = await readEncodedText(await readTextBlob(await item.getType('text/plain')));
          if (decoded) return acceptExternal(decoded);
        }
        for (const item of items || []) {
          if (!(item.types || []).includes('image/png')) continue;
          const blob = await item.getType('image/png');
          return acceptExternal({ type: 'image', payload: { dataUrl: await blobToDataUrl(blob), mime: blob.type || 'image/png' } });
        }
        for (const item of items || []) {
          const imageType = (item.types || []).find(type => type.startsWith('image/'));
          if (!imageType) continue;
          const blob = await item.getType(imageType);
          return acceptExternal({ type: 'image', payload: { dataUrl: await blobToDataUrl(blob), mime: blob.type || imageType } });
        }
        for (const item of items || []) {
          const fileType = (item.types || []).find(type => type && !['text/plain','text/html','text/uri-list'].includes(type) && !type.startsWith('web application/') && !type.startsWith('image/'));
          if (!fileType) continue;
          const blob = await item.getType(fileType);
          return acceptExternal({ type: 'file', payload: { dataUrl: await blobToDataUrl(blob), mime: blob.type || fileType, filename: '' } });
        }
        for (const item of items || []) {
          if (!(item.types || []).includes('text/plain')) continue;
          return acceptExternal({ type: 'text', payload: { text: await readTextBlob(await item.getType('text/plain')) } });
        }
      } catch { /* Permission or browser support can vary; keep internal fallback. */ }
    }
    if (typeof nav.clipboard.readText === 'function') {
      try {
        const text = await nav.clipboard.readText();
        const decoded = await readEncodedText(text);
        if (decoded) return acceptExternal(decoded);
        if (text) return acceptExternal({ type: 'text', payload: { text } });
      } catch { /* Reading the operating-system clipboard is not always permitted. */ }
    }
    return null;
  }

  async function read(type) {
    const external = await readExternal();
    if (external && (!type || external.type === type)) return clone(external.payload);
    if (current && (!type || current.type === type)) return clone(current.payload);
    return null;
  }

  function clear() { current = null; }

  globalThis.UIXClipboard = {
    set, setProjectNdc, get, getRecord, currentType, has, readExternal, read, clear,
    encode: makeEncodedPayload, decode: decodeNdcBytes,
    get lastWrite() { return writePromise; },
    mimeType: CUSTOM_MIME
  };
})();
