const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const { BlockList, isIP } = require('node:net');

function isPrivateTarget(origin) {
  return (process.env.HEALTH_PRIVATE_TARGETS || '').split(',').some(value => value.trim() === origin);
}
const restricted = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]
]) restricted.addSubnet(address, prefix, 'ipv4');

const neverV4 = new BlockList();
neverV4.addSubnet('0.0.0.0', 8);
neverV4.addSubnet('169.254.0.0', 16);
neverV4.addSubnet('224.0.0.0', 3);
neverV4.addAddress('100.100.100.200');
neverV4.addAddress('168.63.129.16');
const neverV6 = new BlockList();
for (const [address, prefix] of [
  ['::', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48],
  ['fe80::', 10], ['ff00::', 8], ['fd00:ec2::254', 128],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16]
]) neverV6.addSubnet(address, prefix, 'ipv6');

const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const privateV6 = new BlockList();
privateV6.addSubnet('fc00::', 7, 'ipv6');
privateV6.addAddress('::1', 'ipv6');

function parseTarget(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value) ||
      /[\x00-\x20\x7f\\]/.test(value)) throw new Error('URL HTTP/HTTPS inválida');
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.origin === 'null' || url.port === '0') {
    throw new Error('URL HTTP/HTTPS inválida');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(host) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(host)) {
    throw new Error('Nombre de destino inválido');
  }
  return { url, host };
}

function authorized(address, allowPrivate) {
  const family = isIP(address);
  if (!family) return false;
  const kind = family === 6 ? 'ipv6' : 'ipv4';
  if ((family === 6 ? neverV6 : neverV4).check(address, kind)) return false;
  if (family === 4) return allowPrivate || !restricted.check(address, kind);
  return globalV6.check(address, kind) || (allowPrivate && privateV6.check(address, kind));
}

let inFlight = 0;
async function probe(server, timeout = 5000) {
  if (inFlight >= 8) return { ok: false, error: 'Capacidad de comprobación alcanzada', deferred: true };
  let target;
  try { target = parseTarget(server.url); } catch { return { ok: false, error: 'URL HTTP/HTTPS inválida' }; }
  const { url, host } = target;
  const allowPrivate = isPrivateTarget(url.origin);
  if (!allowPrivate && (url.port || (!isIP(host) && !host.includes('.')))) {
    return { ok: false, error: 'Destino no autorizado' };
  }

  inFlight++;
  let lookupPending = false;
  let finished = false;
  try {
    return await new Promise(resolve => {
      const started = Date.now();
      let request;
      const deadline = setTimeout(() => {
        finish({ ok: false, error: 'Tiempo de espera agotado' });
        request?.destroy();
      }, timeout);
      function finish(result) {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        resolve({ ...result, latencyMs: Date.now() - started });
      }
      function connect(error, addresses) {
        if (lookupPending) {
          lookupPending = false;
          if (finished) inFlight--;
        }
        if (finished) return;
        if (Date.now() - started >= timeout) return finish({ ok: false, error: 'Tiempo de espera agotado' });
        if (error || !addresses?.length || addresses.some(entry => !authorized(entry.address, allowPrivate))) {
          return finish({ ok: false, error: 'Resolución fallida o destino no autorizado' });
        }
        const endpoint = addresses[0];
        const transport = url.protocol === 'https:' ? https : http;
        try {
          request = transport.request(url, {
            method: 'HEAD',
            agent: false,
            maxHeaderSize: 8192,
            autoSelectFamily: false,
            lookup: (_name, _options, done) => done(null, endpoint.address, endpoint.family)
          }, response => {
            const status = response.statusCode;
            finish({ ok: status >= 200 && status < 300, status });
            response.destroy();
          });
          request.on('error', () => finish({ ok: false, error: 'Error de conexión HTTP/HTTPS' }));
          request.end();
        } catch {
          finish({ ok: false, error: 'Error de conexión HTTP/HTTPS' });
        }
      }
      if (isIP(host)) connect(null, [{ address: host, family: isIP(host) }]);
      else {
        lookupPending = true;
        try { dns.lookup(host, { all: true }, connect); }
        catch (error) { connect(error); }
      }
    });
  } finally {
    if (!lookupPending) inFlight--;
  }
}

async function checkServer(server) {
  return { ...await probe(server), checkedAt: new Date().toISOString() };
}

module.exports = { probe, checkServer, parseTarget };
