const fs = require('node:fs');
const http = require('node:http');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const request = require('supertest');
const WebSocket = require('ws');

process.env.ADMIN_API_KEY = 'test-key';
process.env.CORS_ORIGINS = 'https://dashboard.example';
const file = require('./data-fixture')();
const app = require('../index');
const db = require('../config/db');
const store = require('../services/store.service');
const { attach } = require('../realtime/ws.server');
const { probe } = require('../services/health.service');
const api = request(app);
const admin = req => req.set('x-api-key', 'test-key');
const credentials = { username: 'operative', password: 'complex-password-123' };

async function login() {
  const result = await api.post('/api/auth/login').send(credentials);
  expect(result.status).toBe(200);
  return 'Bearer ' + result.body.data.token;
}

test('valida estructura, conserva IDs y detecta bloqueo, errores de disco y corrupción', async () => {
  const legacy = { servers: [{ id: 'legacy-id', name: 'persistente' }] };
  fs.writeFileSync(file, JSON.stringify(legacy));
  const changed = store.update('servers', 'legacy-id', { id: 'replaced', name: 'nuevo' });
  expect(changed.id).toBe('legacy-id');
  expect(JSON.parse(fs.readFileSync(file + '.bak', 'utf8'))).toEqual(legacy);
  const restarted = spawnSync(process.execPath, ['-e', "console.log(require('./src/config/db').read().servers[0].name)"], { encoding: 'utf8', env: { ...process.env, DATA_FILE: file } });
  expect(restarted.status).toBe(0);
  expect(restarted.stdout.trim()).toBe('nuevo');

  fs.mkdirSync(file + '.lock');
  expect(() => store.create('servers', { name: 'locked' })).toThrow('Almacenamiento ocupado');
  fs.rmdirSync(file + '.lock');

  const rename = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk I/O'); });
  try { expect(() => store.create('servers', { name: 'not-written' })).toThrow('disk I/O'); }
  finally { rename.mockRestore(); }
  expect(db.read().servers).toHaveLength(1);
  const restored = file + '.restored';
  db.restoreFromBackup(file + '.bak', restored);
  expect(JSON.parse(fs.readFileSync(restored)).servers[0].id).toBe('legacy-id');
  expect(() => db.restoreFromBackup(file + '.bak', restored)).toThrow(/EEXIST/);

  const previous = fs.readFileSync(file);
  fs.writeFileSync(file, '{corrupto');
  try {
    expect((await api.get('/api/ready')).status).toBe(503);
    expect(() => store.create('servers', { name: 'unsafe' })).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe('{corrupto');
  } finally { fs.writeFileSync(file, previous); }
});

test('valida mutaciones, autoriza CORS por origen y audita el CRUD', async () => {
  expect((await api.get('/api/status').set('Origin', 'https://dashboard.example')).headers['access-control-allow-origin'])
    .toBe('https://dashboard.example');
  expect((await api.get('/api/status').set('Origin', 'https://other.example')).headers['access-control-allow-origin']).toBeUndefined();
  expect((await admin(api.post('/api/servers')).send({ name: 'no', status: 'online' })).status).toBe(400);
  expect((await admin(api.post('/api/admin/bridges')).send({ name: 'no', id: 'chosen' })).status).toBe(400);
  const created = await admin(api.post('/api/servers')).send({ name: 'nuevo' });
  expect(created.status).toBe(201);
  const { id } = created.body.data;
  expect((await admin(api.patch('/api/servers/' + id)).send({ name: 'editado' })).status).toBe(200);
  expect((await admin(api.delete('/api/servers/' + id))).status).toBe(204);
  expect(store.list('audit').filter(item => item.target === id).map(item => item.action))
    .toEqual(['servers.create', 'servers.update', 'servers.delete']);
});

test('revoca sesiones por cambio de rol, desactivación y expiración', async () => {
  const created = await admin(api.post('/api/admin/users')).send({ ...credentials, role: 'ADMIN' });
  expect(created.status).toBe(201);
  const url = '/api/admin/users/' + created.body.data.id;
  const first = await login();
  expect((await admin(api.patch(url + '/role')).send({ role: 'VIEWER' })).status).toBe(200);
  expect((await api.get('/api/auth/me').set('Authorization', first)).status).toBe(401);
  const second = await login();
  expect((await api.post('/api/servers/legacy-id/health').set('Authorization', second)).status).toBe(403);
  expect((await admin(api.patch(url + '/active')).send({ active: 'false' })).status).toBe(400);
  expect((await admin(api.patch(url + '/active')).send({ active: false })).status).toBe(200);
  expect((await api.get('/api/auth/me').set('Authorization', second)).status).toBe(401);
  await admin(api.patch(url + '/active')).send({ active: true });
  const third = await login();
  const session = store.list('sessions').at(-1);
  store.update('sessions', session.id, { expiresAt: new Date(0).toISOString() });
  expect((await api.get('/api/auth/me').set('Authorization', third)).status).toBe(401);
});

test('rota las credenciales del agente y rechaza el token anterior', async () => {
  const registered = await admin(api.post('/api/admin/agents')).send({ name: 'rotación' });
  expect(registered.status).toBe(201);
  const { agent, token } = registered.body.data;
  const rotated = await admin(api.post('/api/admin/agents/' + agent.id + '/rotate-token'));
  expect(rotated.status).toBe(200);
  const heartbeat = () => api.post('/api/agents/' + agent.id + '/heartbeat');
  expect((await heartbeat().set('x-agent-token', token)).status).toBe(401);
  expect((await heartbeat().set('x-agent-token', rotated.body.data.token).send({ metrics: { cpu: 10 } })).status).toBe(200);
});

test('limita los intentos de login por cliente', async () => {
  // Los flujos anteriores usan tres inicios de sesión desde la misma interfaz.
  for (let index = 0; index < 7; index++) {
    expect((await api.post('/api/auth/login').send({ username: 'missing', password: 'wrong' })).status).toBe(401);
  }
  expect((await api.post('/api/auth/login').send(credentials)).status).toBe(429);
});

test('bloquea destinos restringidos y comprueba un destino explícito sin seguir redirecciones', async () => {
  const dns = require('node:dns');
  const target = http.createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://169.254.169.254/' }).end();
    } else {
      res.writeHead(req.method === 'HEAD' ? 204 : 405).end();
    }
  });
  await new Promise((resolve, reject) => target.once('error', reject).listen(0, '127.0.0.1', resolve));
  const origin = 'http://localhost:' + target.address().port;
  process.env.HEALTH_PRIVATE_TARGETS = origin;
  const lookup = jest.spyOn(dns, 'lookup').mockImplementationOnce((_host, _options, done) => {
    done(null, [{ address: '127.0.0.1', family: 4 }]);
  });
  try {
    expect(await probe({ url: origin + '/' })).toMatchObject({ ok: true, status: 204 });
    lookup.mockImplementationOnce((_host, _options, done) => {
      done(null, [{ address: '127.0.0.1', family: 4 }]);
    });
    expect(await probe({ url: origin + '/redirect' })).toMatchObject({ ok: false, status: 302 });
    expect((await probe({ url: 'http://169.254.169.254/' })).ok).toBe(false);
    expect((await probe({ url: 'file:///tmp/test' })).ok).toBe(false);
    lookup.mockImplementationOnce((_host, _options, done) => {
      done(null, [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]);
    });
    expect((await probe({ url: 'http://health.example/' })).error).toMatch(/no autorizado/);
  } finally {
    lookup.mockRestore();
    delete process.env.HEALTH_PRIVATE_TARGETS;
    await new Promise(resolve => target.close(resolve));
  }
});

test('WebSocket rechaza el upgrade anónimo, filtra por permisos y se cierra al revocar', async () => {
  // Emite una sesión por el mismo servicio que utiliza el endpoint de login.
  const token = require('../services/auth.service').login(credentials.username, credentials.password).token;
  const server = http.createServer(app);
  const rt = attach(server);
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const url = 'ws://127.0.0.1:' + server.address().port + '/ws';
  async function rejection(url, headers) {
    const client = new WebSocket(url, { headers });
    client.on('error', () => {});
    const [req, res] = await once(client, 'unexpected-response');
    res.resume();
    client.terminate();
    return res.statusCode;
  }
  try {
    expect(await rejection(url)).toBe(401);
    expect(await rejection(url + '?token=blocked')).toBe(404);
    const ws = new WebSocket(url, { headers: { Authorization: 'Bearer ' + token } });
    async function message() { const [raw] = await once(ws, 'message'); return JSON.parse(raw); }
    expect((await message()).type).toBe('welcome');
    ws.send(JSON.stringify({ type: 'subscribe', collections: ['audit'] }));
    expect((await message()).type).toBe('error');
    ws.send(JSON.stringify({ type: 'subscribe', collections: ['servers'] }));
    expect((await message()).type).toBe('subscribed');
    const update = message();
    store.create('audit', { action: 'private' });
    const item = store.create('servers', { name: 'ws-server' });
    expect(await update).toMatchObject({ type: 'store.change', payload: { id: item.id, type: 'servers' } });
    const closed = once(ws, 'close');
    expect((await api.post('/api/auth/logout').set('Authorization', 'Bearer ' + token)).status).toBe(200);
    expect((await closed)[0]).toBe(4401);
  } finally {
    rt.close();
    await new Promise(resolve => server.close(resolve));
  }
});
