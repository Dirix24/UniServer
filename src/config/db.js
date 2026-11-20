const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const file = path.resolve(process.env.DATA_FILE || './data/uniserver.json');
const collections = ['servers', 'bridges', 'events', 'jobs', 'users', 'sessions', 'agents', 'audit'];

function empty() {
  return Object.fromEntries(collections.map(name => [name, []]));
}

function decode(raw) {
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (data.schemaVersion !== undefined && data.schemaVersion !== 1)) {
    throw new Error('Versión o estructura de almacenamiento inválida');
  }
  for (const name of collections) {
    if (data[name] === undefined && data.schemaVersion === undefined) continue;
    const ids = new Set();
    if (!Array.isArray(data[name]) || data[name].some(item => {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) return true;
      ids.add(item.id);
      return false;
    })) throw new Error('Colección inválida: ' + name);
  }
  return { ...empty(), ...data, schemaVersion: 1 };
}

function snapshot() {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return { raw, data: decode(raw) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (fs.existsSync(file + '.bak')) throw new Error('Falta el almacén principal. Requiere restauración.');
    return { data: { ...empty(), schemaVersion: 1 } };
  }
}

function atomicWrite(target, content) {
  const temporary = target + '.' + randomUUID() + '.tmp';
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    try {
      fs.writeFileSync(descriptor, content);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, target);
    if (process.platform !== 'win32') {
      const directory = fs.openSync(path.dirname(target), 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function transaction(change) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const lock = file + '.lock';
  try {
    fs.mkdirSync(lock, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw Object.assign(new Error('Almacenamiento ocupado'), { statusCode: 503 });
    throw error;
  }
  try {
    const { data, raw } = snapshot();
    const result = change(data);
    if (result === null || result === false) return result;
    const content = JSON.stringify(data, null, 2);
    decode(content);
    if (raw !== undefined) atomicWrite(file + '.bak', raw);
    atomicWrite(file, content);
    return result;
  } finally {
    fs.rmdirSync(lock);
  }
}

function restoreFromBackup(source, destination) {
  const content = fs.readFileSync(source, 'utf8');
  decode(content);
  const target = path.resolve(destination);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  // Publish a fully synced copy without overwriting a file created by another process.
  const staged = target + '.' + randomUUID() + '.restore';
  atomicWrite(staged, content);
  try { fs.linkSync(staged, target); }
  finally { fs.unlinkSync(staged); }
}

module.exports = { read: () => snapshot().data, transaction, restoreFromBackup };
