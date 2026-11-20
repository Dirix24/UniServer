const { WebSocketServer, WebSocket } = require('ws');
const auth = require('../services/auth.service');
const { equalSecret } = require('../services/crypto.util');
const { can } = require('../config/roles');
const store = require('../services/store.service');

const permissions = {
  servers: 'servers.read', agents: 'agents.read', bridges: 'bridges.read',
  events: 'events.read', users: 'users.read', audit: 'audit.read'
};

function authenticate(headers) {
  const token = /^Bearer (\S+)$/i.exec(headers.authorization || '')?.[1];
  const key = process.env.ADMIN_API_KEY;
  if (equalSecret(headers['x-api-key'], key) || equalSecret(token, key)) {
    return { role: 'SUPER_ADMIN' };
  }
  return auth.resolveToken(token);
}

function reject(socket, status) {
  socket.on('error', () => {});
  socket.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  const origins = new Set((process.env.WS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));

  function upgrade(req, socket, head) {
    if (req.url !== '/ws') return reject(socket, '404 Not Found');
    if (req.headers.origin && !origins.has(req.headers.origin)) return reject(socket, '403 Forbidden');
    if (wss.clients.size >= 64) return reject(socket, '503 Service Unavailable');
    try {
      if (!authenticate(req.headers)) return reject(socket, '401 Unauthorized');
    } catch {
      return reject(socket, '503 Service Unavailable');
    }
    const credentials = { authorization: req.headers.authorization, 'x-api-key': req.headers['x-api-key'] };
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, credentials));
  }

  function identity(client) {
    try {
      const actor = authenticate(client.credentials);
      if (actor) return actor;
    } catch {
      client.terminate();
      return null;
    }
    client.close(4401, 'Sesión revocada');
    return null;
  }

  wss.on('connection', (ws, credentials) => {
    ws.credentials = credentials;
    ws.alive = true;
    ws.subscriptions = new Set();
    let messages = [];
    ws.on('error', () => ws.terminate());
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', (raw, binary) => {
      const now = Date.now();
      messages = messages.filter(time => now - time < 1000);
      if (binary || messages.length >= 8) return ws.close(1008, 'Límite de mensajes');
      messages.push(now);
      let request;
      try { request = JSON.parse(raw.toString()); } catch { return ws.close(1008, 'JSON inválido'); }
      const actor = identity(ws);
      if (!actor) return;
      if (request?.type !== 'subscribe' || !Array.isArray(request.collections) ||
          request.collections.length > Object.keys(permissions).length ||
          request.collections.some(name => typeof name !== 'string' ||
            !Object.hasOwn(permissions, name) || !can(actor.role, permissions[name]))) {
        ws.send(JSON.stringify({ type: 'error', error: 'Suscripción denegada' }));
        return;
      }
      ws.subscriptions = new Set(request.collections);
      ws.send(JSON.stringify({ type: 'subscribed', collections: [...ws.subscriptions] }));
    });
    ws.send(JSON.stringify({ type: 'welcome', time: new Date().toISOString() }));
  });

  function broadcast(type, event) {
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (type !== 'store.change') continue;
      const subscribed = client.subscriptions.has(event.type);
      // Revalidate revocations even when the client has no subscriptions.
      if (!subscribed && event.type !== 'users' && event.type !== 'sessions') continue;
      const actor = identity(client);
      if (!actor || !subscribed || !can(actor.role, permissions[event.type])) continue;
      if (client.bufferedAmount > 65536) {
        client.terminate();
        continue;
      }
      const payload = { type: event.type, action: event.action, id: event.id || event.item?.id };
      client.send(JSON.stringify({ type, payload, time: new Date().toISOString() }));
    }
  }

  const onChange = event => broadcast('store.change', event);
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!client.alive || client.readyState !== WebSocket.OPEN) client.terminate();
      else if (identity(client)) {
        client.alive = false;
        client.ping();
      }
    }
  }, 15000);
  heartbeat.unref();
  server.on('upgrade', upgrade);
  store.bus.on('change', onChange);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    server.off('upgrade', upgrade);
    store.bus.off('change', onChange);
    for (const client of wss.clients) client.terminate();
    wss.close();
  }
  server.once('close', close);
  return { wss, close, broadcast };
}

module.exports = { attach };
