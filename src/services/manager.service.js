const store = require('./store.service');
const { checkServer } = require('./health.service');

async function refreshHealth(server) {
  if (server.enabled === false) return { ok: false, deferred: true, error: 'Comprobación desactivada' };
  const health = await checkServer(server);
  if (health.deferred) return health;
  const updated = store.update('servers', server.id, {
    health, lastCheckAt: health.checkedAt, status: health.ok ? 'online' : 'offline'
  }, { expected: current => current.url === server.url && current.enabled === server.enabled &&
      current.lastCheckAt === server.lastCheckAt });
  if (updated && !health.ok && server.status !== 'offline') {
    store.addEvent({ type: 'health', severity: 'warning', serverId: server.id,
      message: 'Servidor no saludable: ' + (health.error || health.status) });
  }
  return health;
}

let activeScan;
function checkAll() {
  if (activeScan) return activeScan;
  activeScan = (async () => {
    const servers = store.list('servers');
    const result = new Array(servers.length);
    let next = 0;
    async function worker() {
      while (next < servers.length) {
        const index = next++;
        const server = servers[index];
        result[index] = { ...server, health: await refreshHealth(server) };
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, servers.length) }, worker));
    return result;
  })().finally(() => { activeScan = undefined; });
  return activeScan;
}

function summary() {
  const servers = store.list('servers');
  const count = status => servers.filter(server => server.status === status).length;
  const online = count('online');
  const offline = count('offline');
  return { total: servers.length, online, offline, unknown: servers.length - online - offline,
    bridges: store.list('bridges').length, events: store.list('events').slice(-20).reverse() };
}

module.exports = { checkAll, refreshHealth, summary };
