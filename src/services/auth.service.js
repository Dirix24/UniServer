const store = require('./store.service');
const { newToken, hashToken, equalSecret } = require('./crypto.util');
const users = require('./user.service');
const { VALID_ROLES } = require('../config/roles');

const ttl = Number(process.env.SESSION_TTL_MS ?? 43200000);
if (!Number.isSafeInteger(ttl) || ttl < 1 || ttl > 90 * 86400000) throw new Error('SESSION_TTL_MS inválido');

function login(username, password) {
  const user = users.verify(username, password);
  if (!user) return null;
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  store.create('sessions', { tokenHash: hashToken(token), userId: user.id, role: user.role, expiresAt }, { guard: data => {
    if (!data.users.some(current => current.id === user.id && current.active !== false &&
        current.role === user.role && current.updatedAt === user.updatedAt)) {
      throw Object.assign(new Error('La cuenta cambió durante el inicio de sesión'), { statusCode: 409 });
    }
  } });
  return { token, expiresAt, user: users.sanitize(user) };
}

function sessionFor(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const digest = hashToken(token);
  return store.list('sessions').find(session => equalSecret(session.tokenHash, digest));
}

function resolveToken(token) {
  const session = sessionFor(token);
  if (!session || !(Date.parse(session.expiresAt) > Date.now())) return null;
  const user = store.list('users').find(entry => entry.id === session.userId);
  if (!user || user.active === false || user.role !== session.role || !VALID_ROLES.includes(user.role)) return null;
  return { ...session, username: user.username };
}

function logout(token) {
  const session = sessionFor(token);
  return session ? store.remove('sessions', session.id) : false;
}

module.exports = { login, resolveToken, logout };
