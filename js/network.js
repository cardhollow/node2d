(() => {
  'use strict';

  const PEERJS_VERSION = '1.5.5';
  const PEERJS_SRC = `https://unpkg.com/peerjs@${PEERJS_VERSION}/dist/peerjs.min.js`;
  let peerLoader = null;
  let serverBroadcastTimer = 0;
  let sessionCounter = 0;
  let state = {
    role: '',
    room: '',
    clientId: '',
    peer: null,
    hostConnection: null,
    connections: new Map(),
    clients: [],
    serverValues: Object.create(null),
    initialized: false,
    serverReady: false,
    joining: null,
    session: ++sessionCounter
  };
  let hooks = {};

  function cloneValue(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(cloneValue);
    const out = {};
    Object.keys(value).forEach(k => { out[k] = cloneValue(value[k]); });
    return out;
  }

  function normalizeId(value) {
    return String(value ?? '').trim();
  }

  function loadPeerJS() {
    if (window.Peer) return Promise.resolve(window.Peer);
    if (peerLoader) return peerLoader;
    peerLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PEERJS_SRC;
      script.async = true;
      script.onload = () => window.Peer ? resolve(window.Peer) : reject(new Error('PeerJS loaded without the Peer constructor.'));
      script.onerror = () => reject(new Error(`Could not load PeerJS from ${PEERJS_SRC}`));
      document.head.appendChild(script);
    }).catch(error => {
      peerLoader = null;
      throw error;
    });
    return peerLoader;
  }

  function variableDefinitions() {
    const list = hooks.getServerVariableDefinitions?.();
    return Array.isArray(list) ? list : [];
  }

  function coerceServerValue(name, value) {
    const variable = variableDefinitions().find(v => String(v?.name) === String(name));
    if (!variable) return { ok: false, value: undefined };
    if (variable.dataType === 'Bool') return { ok: true, value: !!value };
    if (variable.dataType === 'Int') {
      const number = Number(value);
      return { ok: true, value: Number.isFinite(number) ? number : 0 };
    }
    return { ok: true, value: String(value) };
  }

  function serverSnapshot() {
    const out = {};
    variableDefinitions().forEach(v => {
      const name = String(v?.name || '');
      if (!name) return;
      const current = Object.prototype.hasOwnProperty.call(state.serverValues, name)
        ? state.serverValues[name]
        : v.value;
      const coerced = coerceServerValue(name, current);
      if (coerced.ok) out[name] = cloneValue(coerced.value);
    });
    return out;
  }

  function syncDefinitions({ preserveValues = true } = {}) {
    const next = Object.create(null);
    variableDefinitions().forEach(v => {
      const name = String(v?.name || '');
      if (!name) return;
      const hasOld = preserveValues && Object.prototype.hasOwnProperty.call(state.serverValues, name);
      const source = hasOld ? state.serverValues[name] : v.value;
      const coerced = coerceServerValue(name, source);
      if (coerced.ok) next[name] = cloneValue(coerced.value);
    });
    state.serverValues = next;
  }

  function applyServerSnapshot(values) {
    const source = values && typeof values === 'object' ? values : {};
    const next = Object.create(null);
    variableDefinitions().forEach(v => {
      const name = String(v?.name || '');
      if (!name) return;
      const raw = Object.prototype.hasOwnProperty.call(source, name) ? source[name] : v.value;
      const coerced = coerceServerValue(name, raw);
      if (coerced.ok) next[name] = cloneValue(coerced.value);
    });
    state.serverValues = next;
    Object.keys(next).forEach(name => hooks.onServerVariableChange?.(name, cloneValue(next[name])));
    state.serverReady = true;
    return true;
  }

  function updateRuntimeServerValue(name, value) {
    const coerced = coerceServerValue(name, value);
    if (!coerced.ok) return false;
    state.serverValues[String(name)] = cloneValue(coerced.value);
    hooks.onServerVariableChange?.(String(name), cloneValue(coerced.value));
    return true;
  }

  function notifyError(error) {
    const message = String(error?.message || error || 'Network error');
    hooks.onError?.(message, error);
    return message;
  }

  function send(connection, packet) {
    if (!connection || connection.open === false) return false;
    try { connection.send(packet); return true; } catch (error) { notifyError(error); return false; }
  }

  function broadcast(packet, exceptPeerId = '') {
    state.connections.forEach((connection, peerId) => {
      if (peerId === exceptPeerId) return;
      send(connection, packet);
    });
  }

  function setClients(next, fireEvents = true) {
    const unique = [...new Set((Array.isArray(next) ? next : []).map(normalizeId).filter(Boolean))];
    const previous = state.clients.slice();
    state.clients = unique;
    if (fireEvents && state.initialized) {
      const oldSet = new Set(previous), newSet = new Set(unique);
      unique.filter(id => !oldSet.has(id)).forEach(id => hooks.onClientJoined?.(id));
      previous.filter(id => !newSet.has(id)).forEach(id => hooks.onClientLeft?.(id));
    }
    hooks.onClientsChanged?.(state.clients.slice());
  }

  function broadcastClients() {
    if (state.role !== 'host') return;
    const packet = { type: 'uix-clients', clients: state.clients.slice() };
    broadcast(packet);
  }

  function scheduleServerBroadcast() {
    if (state.role !== 'host') return;
    if (serverBroadcastTimer) return;
    serverBroadcastTimer = setTimeout(() => {
      serverBroadcastTimer = 0;
      broadcast({ type: 'uix-server', values: serverSnapshot() });
    }, 16);
  }

  function resetState() {
    if (serverBroadcastTimer) { clearTimeout(serverBroadcastTimer); serverBroadcastTimer = 0; }
    state = {
      role: '', room: '', clientId: '', peer: null, hostConnection: null,
      connections: new Map(), clients: [], serverValues: Object.create(null), initialized: false, serverReady: false, joining: null, session: ++sessionCounter
    };
    hooks.onClientsChanged?.([]);
  }

  function closeConnections() {
    state.connections.forEach(connection => { try { connection.close(); } catch {} });
    state.connections.clear();
    try { state.hostConnection?.close(); } catch {}
    state.hostConnection = null;
  }

  function detachPeer() {
    try { state.peer?.disconnect?.(); } catch {}
    try { state.peer?.destroy?.(); } catch {}
    state.peer = null;
  }

  function leave() {
    closeConnections();
    detachPeer();
    resetState();
    return true;
  }

  function handleHostConnection(connection) {
    if (!connection || !connection.peer) return;
    const session = state.session;
    const peerId = normalizeId(connection.peer);
    state.connections.set(peerId, connection);
    const open = () => {
      if (state.session !== session) return;
      state.connections.set(peerId, connection);
      if (!state.clients.includes(peerId)) state.clients.push(peerId);
      hooks.onClientJoined?.(peerId);
      hooks.onClientsChanged?.(state.clients.slice());
      send(connection, { type: 'uix-state', clients: state.clients.slice(), server: serverSnapshot() });
      broadcastClients();
    };
    connection.on('open', open);
    connection.on('data', packet => {
      if (state.session !== session || !packet || typeof packet !== 'object') return;
      if (packet.type === 'uix-server-set-request') {
        const key = normalizeId(packet.name);
        if (!key || state.role !== 'host') return;
        const coerced = coerceServerValue(key, packet.value);
        if (!coerced.ok) return;
        if (!updateRuntimeServerValue(key, coerced.value)) return;
        scheduleServerBroadcast();
      }
    });
    connection.on('close', () => {
      if (state.session !== session) return;
      state.connections.delete(peerId);
      const index = state.clients.indexOf(peerId);
      if (index >= 0) state.clients.splice(index, 1);
      if (state.initialized) hooks.onClientLeft?.(peerId);
      hooks.onClientsChanged?.(state.clients.slice());
      broadcastClients();
    });
    connection.on('error', error => { if (state.session === session) notifyError(error); });
  }

  function handleClientData(packet) {
    if (!packet || typeof packet !== 'object') return;
    if (packet.type === 'uix-state') {
      const server = packet.server && typeof packet.server === 'object' ? packet.server : {};
      applyServerSnapshot(server);
      const previousInitialized = state.initialized;
      const old = state.clients.slice();
      setClients(packet.clients, false);
      state.initialized = true;
      if (!previousInitialized) {
        state.clients.filter(id => id === state.clientId).forEach(id => hooks.onClientJoined?.(id));
      } else {
        const oldSet = new Set(old), now = new Set(state.clients);
        state.clients.filter(id => !oldSet.has(id)).forEach(id => hooks.onClientJoined?.(id));
        old.filter(id => !now.has(id)).forEach(id => hooks.onClientLeft?.(id));
      }
      hooks.onClientsChanged?.(state.clients.slice());
      if (state.joining) { const done = state.joining; state.joining = null; done.resolve(true); }
      return;
    }
    if (packet.type === 'uix-clients') {
      setClients(packet.clients, true);
      return;
    }
    if (packet.type === 'uix-server' && packet.values && typeof packet.values === 'object') {
      applyServerSnapshot(packet.values);
    }
  }

  function setupPeer(peer, role, room, clientId) {
    const session = state.session;
    state.peer = peer;
    state.role = role;
    state.room = room;
    state.clientId = clientId;
    state.serverReady = role === 'host';
    peer.on('error', error => {
      if (state.session !== session) return;
      const message = notifyError(error);
      if (state.joining) {
        const fail = state.joining;
        state.joining = null;
        fail.reject(new Error(message));
      }
    });
    peer.on('disconnected', () => { if (state.session === session) hooks.onConnectionState?.('Offline'); });
    peer.on('close', () => { if (state.session === session) hooks.onConnectionState?.('Closed'); });
    if (role === 'host') peer.on('connection', handleHostConnection);
  }

  function createRoom(roomClientId) {
    const id = normalizeId(roomClientId);
    if (!id) return Promise.reject(new Error('Room/clientID is required.'));
    return loadPeerJS().then(Peer => {
      leave();
      syncDefinitions({ preserveValues: false });
      return new Promise((resolve, reject) => {
        let opened = false;
        const peer = new Peer(id);
        setupPeer(peer, 'host', id, id);
        const session = state.session;
        peer.on('open', openedId => {
          if (state.session !== session) return;
          opened = true;
          state.clientId = normalizeId(openedId) || id;
          state.clients = [state.clientId];
          state.initialized = true;
          hooks.onClientsChanged?.(state.clients.slice());
          hooks.onConnectionState?.('Online');
          resolve(true);
        });
        peer.on('error', error => { if (state.session === session && !opened) reject(error); });
      });
    });
  }

  function joinRoom(room, clientId) {
    const roomId = normalizeId(room), id = normalizeId(clientId);
    if (!roomId) return Promise.reject(new Error('Room is required.'));
    if (!id) return Promise.reject(new Error('Client ID is required.'));
    return loadPeerJS().then(Peer => {
      leave();
      syncDefinitions({ preserveValues: false });
      return new Promise((resolve, reject) => {
        state.joining = { resolve, reject };
        const session = state.session;
        const peer = new Peer(id);
        setupPeer(peer, 'client', roomId, id);
        peer.on('open', () => {
          if (state.session !== session) return;
          hooks.onConnectionState?.('Online');
          const connection = peer.connect(roomId, { reliable: true, serialization: 'json' });
          state.hostConnection = connection;
          connection.on('open', () => {
            state.connections.set(roomId, connection);
          });
          connection.on('data', packet => { if (state.session === session) handleClientData(packet); });
          connection.on('close', () => {
            if (state.session !== session) return;
            if (state.initialized) hooks.onClientLeft?.(roomId);
            hooks.onConnectionState?.('Offline');
          });
          connection.on('error', error => {
            if (state.session !== session) return;
            notifyError(error);
            if (state.joining) {
              const fail = state.joining;
              state.joining = null;
              reject(new Error(String(error?.message || error || 'Could not join room.')));
            }
          });
        });
        peer.on('error', error => {
          if (state.session !== session) return;
          if (state.joining) {
            const fail = state.joining;
            state.joining = null;
            reject(error);
          }
        });
        setTimeout(() => {
          if (!state.joining) return;
          const fail = state.joining;
          state.joining = null;
          fail.reject(new Error('Timed out while joining the room.'));
        }, 15000);
      });
    });
  }

  function setServerVariable(name, value) {
    const key = normalizeId(name);
    if (!key) return false;
    if (state.role === 'client') {
      if (!state.hostConnection || state.hostConnection.open === false) return false;
      try {
        state.hostConnection.send({
          type: 'uix-server-set-request',
          name: key,
          value: cloneValue(value)
        });
        return true;
      } catch (error) {
        notifyError(error);
        return false;
      }
    }
    if (state.role === 'host') {
      if (!updateRuntimeServerValue(key, value)) return false;
      scheduleServerBroadcast();
      return true;
    }
    return updateRuntimeServerValue(key, value);
  }

  function configure(nextHooks = {}) {
    hooks = { ...hooks, ...nextHooks };
    syncDefinitions({ preserveValues: true });
  }

  window.UIXNetwork = {
    peerjsVersion: PEERJS_VERSION,
    configure,
    createRoom,
    joinRoom,
    leave,
    setServerVariable,
    getClients: () => state.clients.slice(),
    getClientId: () => state.clientId,
    getRoom: () => state.room,
    getRole: () => state.role,
    getServerValues: () => cloneValue(serverSnapshot()),
    isServerReady: () => !!state.serverReady,
    getServerValue: name => {
      const key = normalizeId(name);
      if (!key) return undefined;
      return Object.prototype.hasOwnProperty.call(state.serverValues, key) ? cloneValue(state.serverValues[key]) : undefined;
    },
    reportError: error => notifyError(error)
  };
})();
