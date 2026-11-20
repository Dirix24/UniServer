const v = require('../utils/validation');
const store = require('./store.service');
const { newToken, hashToken, equalSecret } = require('./crypto.util');

const HEARTBEAT_TIMEOUT_MS = Number(process.env.AGENT_OFFLINE_MS || 90000);

function sanitize(a){ if(!a) return a; const {tokenHash, ...rest}=a; return rest; }

function register(body) {
  const {name, hostname, os, bridgeId, capabilities} = v.fields(body, {
    name: v.text(128), hostname: v.nullable(v.text(253)), os: v.nullable(v.text(64)),
    bridgeId: v.id, capabilities: v.array(v.text(128), 100)
  }, ['name']);
  const token = newToken();
  const agent = store.create('agents', {
    name, hostname: hostname||null, os: os||null, bridgeId: bridgeId||null,
    capabilities: Array.isArray(capabilities)?capabilities:[],
    tokenHash: hashToken(token), status:'offline', lastHeartbeatAt:null, metrics:null
  });
  return { agent: sanitize(agent), token };
}

function list(){ return store.list('agents').map(sanitize); }

function heartbeat(id, token, metrics){
  const agent = store.list('agents').find(a=>a.id===id);
  if(!agent) return null;
  if(!token || !equalSecret(hashToken(token), agent.tokenHash)) return 'unauthorized';
  if (metrics !== undefined && (!v.object(metrics) || Buffer.byteLength(JSON.stringify(metrics)) > 16384)) {
    v.invalid('metrics inválido');
  }
  const updated = store.update('agents', id, {
    status: 'online', lastHeartbeatAt: new Date().toISOString(), ...(metrics === undefined ? {} : { metrics })
  }, { expected: current => current.tokenHash === agent.tokenHash });
  return updated ? sanitize(updated) : 'unauthorized';
}

function sweepOffline(){
  const now = Date.now();
  for(const a of store.list('agents')){
    if(a.status==='online' && a.lastHeartbeatAt && (now - new Date(a.lastHeartbeatAt).getTime()) > HEARTBEAT_TIMEOUT_MS){
      store.update('agents', a.id, {status:'offline'}, { expected: current => current.lastHeartbeatAt === a.lastHeartbeatAt });
    }
  }
}

function rotate(id) {
  const token = newToken();
  const updated = store.update('agents', id, { tokenHash: hashToken(token), status: 'offline' });
  return updated ? { agent: sanitize(updated), token } : null;
}

function remove(id){ return store.remove('agents', id); }

module.exports = { register, list, heartbeat, sweepOffline, remove, sanitize, rotate };
