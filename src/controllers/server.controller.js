const store = require('../services/store.service');
const audit = require('../services/audit.service');
const { refreshHealth } = require('../services/manager.service');
const { parseTarget } = require('../services/health.service');
const v = require('../utils/validation');

const schema = {
  name: v.text(128), host: v.nullable(v.text(253)), url: v.nullable(value => {
    try { parseTarget(value); return true; } catch { return false; }
  }),
  port: v.nullable(value => Number.isInteger(value) && value >= 1 && value <= 65535),
  protocol: v.nullable(v.text(32)), environment: v.nullable(v.text(64)),
  tags: v.array(v.text(64), 50), notes: v.nullable(v.text(4096, 0)), enabled: v.boolean,
  bridgeId: v.id, agentId: v.id
};

const actorAudit = (req, op) => ({ actor: req.user.username, action: 'servers.' + op });
const missing = res => res.status(404).json({ ok: false, error: 'Servidor no encontrado' });

function list(req, res) {
  res.json({ ok: true, data: store.list('servers') });
}

function create(req, res) {
  const item = store.create('servers', {
    ...v.fields(req.body, schema, ['name']), status: 'unknown'
  }, { audit: actorAudit(req, 'create') });
  res.status(201).json({ ok: true, data: item });
}

function update(req, res) {
  const item = store.update('servers', req.params.id, v.fields(req.body, schema), { audit: actorAudit(req, 'update') });
  if (!item) return missing(res);
  res.json({ ok: true, data: item });
}

function remove(req, res) {
  if (!store.remove('servers', req.params.id, { audit: actorAudit(req, 'delete') })) return missing(res);
  res.status(204).end();
}

async function health(req, res) {
  const server = store.list('servers').find(entry => entry.id === req.params.id);
  if (!server) return missing(res);
  const health = await refreshHealth(server);
  audit.record({ ...actorAudit(req, 'health'), target: server.id });
  res.json({ ok: true, data: { serverId: server.id, health } });
}

module.exports = { list, create, update, remove, health };
