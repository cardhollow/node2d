importScripts('./ndcCodec.js');
self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== 'decode') return;
  const id = msg.id;
  try {
    self.postMessage({ id, progress: 15, text: 'Decoding NDC…' });
    const bytes = msg.bytes instanceof Uint8Array ? msg.bytes : new Uint8Array(msg.bytes);
    self.postMessage({ id, progress: 45, text: 'Decompressing project…' });
    const data = self.UIXNDCCodec.decode(bytes);
    self.postMessage({ id, progress: 88, text: 'Project data decoded.' });
    self.postMessage({ id, done: true, progress: 92, text: 'Applying project…', data });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err || 'Could not decode NDC') });
  }
};
