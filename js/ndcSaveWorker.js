importScripts('./ndcCodec.js');

const pendingSaveProjects = new Map();

self.onmessage = async e => {
  const msg = e.data || {};
  const id = msg.id;
  try {
    if (msg.type === 'start') {
      pendingSaveProjects.set(id, {
        project: { name: msg.name || 'Untitled Node2D', created: true },
        assets: {}
      });
      return;
    }

    const req = pendingSaveProjects.get(id);
    if (!req) throw Error('Unknown save request');

    if (msg.type === 'part') {
      req.project[msg.key] = msg.value;
      return;
    }

    if (msg.type === 'assetPart') {
      req.assets[msg.key] = msg.value;
      return;
    }

    if (msg.type === 'finish') {
      req.project.assets = req.assets;
      const bytes = self.UIXNDCCodec.encode(req.project);
      pendingSaveProjects.delete(id);
      self.postMessage({ id, bytes }, [bytes.buffer]);
      return;
    }
  } catch (err) {
    pendingSaveProjects.delete(id);
    self.postMessage({ id, error: String(err?.message || err || 'Could not encode project') });
  }
};
