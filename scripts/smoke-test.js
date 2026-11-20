const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WS = require('ws');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uniserver-smoke-'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const data = path.join(directory, 'state.json');
const adminPassword = 'smoke-test-password-789';
const browserBin = process.env.BROWSER_BIN || 'chromium';
const browserFlags = process.env.BROWSER_NO_SANDBOX === '1' ? ['--no-sandbox'] : [];

async function waitFor(work) {
  for (let i = 0; i < 80; i++) {
    const value = await work();
    if (value) return value;
    await delay(75);
  }
  throw new Error('Tiempo de espera agotado');
}

async function start() {
  const proc = spawn(process.execPath, ['src/index.js'], { env: {
    ...process.env, NODE_ENV: 'production', DATA_FILE: data, ADMIN_API_KEY: '',
    HOST: '127.0.0.1', PORT: '0', ADMIN_USERNAME: 'smoke', ADMIN_PASSWORD: adminPassword
  } });
  return { proc, port: await new Promise((resolve, reject) => {
    proc.once('exit', code => reject(new Error('UniServer terminó: ' + code)));
    proc.stderr.on('data', chunk => process.stderr.write(chunk));
    proc.stdout.on('data', chunk => {
      for (const line of String(chunk).trim().split('\n')) {
        try {
          const entry = JSON.parse(line);
          if (entry.message === 'UniServer iniciado') resolve(entry.port);
        } catch {}
      }
    });
  }) };
}

async function stop(proc) {
  const closed = once(proc, 'exit');
  proc.kill('SIGTERM');
  await closed;
}

async function browserCheck(base) {
  const profile = path.join(directory, 'profile');
  const browser = spawn(browserBin, ['--headless', '--disable-gpu',
    ...browserFlags, '--no-first-run', '--disable-background-networking',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let client;
  let launchError;
  browser.on('error', error => { launchError = error; });
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    const port = await waitFor(() => {
      if (launchError) throw launchError;
      if (browser.exitCode !== null) throw new Error('El navegador terminó antes de estar disponible');
      return fs.existsSync(portFile) && fs.readFileSync(portFile, 'utf8').split('\n')[0];
    });
    const tabs = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    client = new WS(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await once(client, 'open');
    let id = 0;
    const pending = new Map();
    client.on('message', raw => {
      const event = JSON.parse(raw);
      pending.get(event.id)?.(event.result);
      pending.delete(event.id);
    });
    const cmd = (method, params) => new Promise(resolve => {
      pending.set(++id, resolve);
      client.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => (await cmd('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    await cmd('Page.navigate', { url: base + '/dashboard/' });
    await waitFor(() => evaluate("Boolean(document.querySelector('[data-action=login]') && typeof login === 'function')"));
    await evaluate(`document.querySelector('#username').value = 'smoke';
      document.querySelector('#password').value = '${adminPassword}';
      document.querySelector('[data-action=login]').click();`);
    await waitFor(() => evaluate("document.querySelector('#rows').textContent.includes('Servidor de prueba')"));
    assert.equal(await evaluate("document.querySelector('#userRole').textContent"), 'SUPER_ADMIN');
    await evaluate("document.querySelector('[data-view=agents]').click()");
    await waitFor(() => evaluate("document.querySelector('#agentsList').textContent.includes('Agente de prueba')"));
    await evaluate("document.querySelector('[data-action=logout]').click()");
    await waitFor(() => evaluate("document.querySelector('#app').classList.contains('hidden')"));
    console.log('Dashboard real: login, inventario, agentes, navegación y logout verificados');
  } finally {
    client?.terminate();
    if (browser.pid && browser.exitCode === null) await stop(browser);
  }
}

async function main() {
  let running;
  try {
    running = await start();
    let base = 'http://127.0.0.1:' + running.port;
    const status = await (await fetch(base + '/api/status')).json();
    const version = await (await fetch(base + '/api/version')).json();
    assert.equal(status.version, version.version);
    assert.equal((await fetch(base + '/api/ready')).status, 200);
    assert.equal((await fetch(base + '/api/servers')).status, 401);
    const json = (method, payload, token) => ({ method, body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } });
    const auth = await (await fetch(base + '/api/auth/login', json('POST',
      { username: 'smoke', password: adminPassword }))).json();
    const token = auth.data.token;
    assert.equal((await fetch(base + '/api/servers', json('POST', { name: 'Servidor de prueba' }, token))).status, 201);
    assert.equal((await fetch(base + '/api/admin/agents', json('POST', { name: 'Agente de prueba' }, token))).status, 201);
    await browserCheck(base);
    await stop(running.proc);
    running = await start();
    base = 'http://127.0.0.1:' + running.port;
    const after = await (await fetch(base + '/api/servers', { headers: { authorization: 'Bearer ' + token } })).json();
    assert.equal(after.data[0].name, 'Servidor de prueba');
    console.log('Proceso real: endpoints, RBAC y persistencia tras reinicio verificados');
  } finally {
    if (running?.proc.exitCode === null) await stop(running.proc);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
