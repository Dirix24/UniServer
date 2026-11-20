const { read, transaction } = require('../config/db');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');

const bus = new EventEmitter();
const limits = { events: 10000, audit: 10000 };
const unexpired = session => Date.parse(session.expiresAt) > Date.now();

function list(type) {
  return read()[type] || [];
}

function appendAudit(data, audit, id) {
  if (!audit) return;
  const item = { ...audit, target: id, result: 'SUCCESS', meta: {},
    id: randomUUID(), createdAt: new Date().toISOString() };
  data.audit.push(item);
  data.audit = data.audit.slice(-limits.audit);
  return item;
}

function create(type, value, { guard, audit } = {}) {
  const item = { ...value, id: randomUUID(), createdAt: new Date().toISOString() };
  const entry = transaction(data => {
    guard?.(data);
    if (type === 'sessions') {
      data.sessions = data.sessions.filter(unexpired);
      if (data.sessions.length >= 10000) {
        throw Object.assign(new Error('Límite de sesiones alcanzado'), { statusCode: 503 });
      }
    }
    data[type].push(item);
    if (limits[type]) data[type] = data[type].slice(-limits[type]);
    return appendAudit(data, audit, item.id);
  });
  bus.emit('change', { type, action: 'create', item });
  if (entry) bus.emit('change', { type: 'audit', action: 'create', item: entry });
  return item;
}

function update(type, id, patch, options = {}) {
  const result = transaction(data => {
    const index = data[type].findIndex(entry => entry.id === id);
    if (index < 0) return null;
    const previous = data[type][index];
    if (options.expected && !options.expected(previous)) return null;
    const updated = { ...previous, ...patch, id, createdAt: previous.createdAt, updatedAt: new Date().toISOString() };
    data[type][index] = updated;
    if (options.revokeSessions) data.sessions = data.sessions.filter(session => session.userId !== id);
    return { item: updated, entry: appendAudit(data, options.audit, id) };
  });
  if (!result) return null;
  bus.emit('change', { type, action: 'update', item: result.item });
  if (result.entry) bus.emit('change', { type: 'audit', action: 'create', item: result.entry });
  return result.item;
}

function remove(type, id, options = {}) {
  const result = transaction(data => {
    const index = data[type].findIndex(entry => entry.id === id);
    if (index < 0) return false;
    data[type].splice(index, 1);
    return { entry: appendAudit(data, options.audit, id) };
  });
  if (!result) return false;
  bus.emit('change', { type, action: 'remove', id });
  if (result.entry) bus.emit('change', { type: 'audit', action: 'create', item: result.entry });
  return true;
}

module.exports = { list, create, update, remove, addEvent: event => create('events', event), bus };
