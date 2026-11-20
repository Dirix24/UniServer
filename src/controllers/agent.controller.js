const v = require('../utils/validation');
const agents = require('../services/agent.service');
const audit = require('../services/audit.service');

async function list(req,res){ res.json({ok:true, data: agents.list()}); }
async function register(req,res){
  const result = agents.register(req.body||{});
  audit.record({actor:req.user.username, action:'agents.register', target:result.agent.name});
  res.set('Cache-Control', 'no-store').status(201).json({ok:true, data: result});
}
async function heartbeat(req,res){
  const result = agents.heartbeat(req.params.id, req.get('x-agent-token'), v.fields(req.body || {}, { metrics: v.object }).metrics);
  if(result===null) return res.status(404).json({ok:false,error:'Agente no encontrado'});
  if(result==='unauthorized') return res.status(401).json({ok:false,error:'Token de agente inválido'});
  res.json({ok:true, data: result});
}
async function remove(req,res){
  if(!agents.remove(req.params.id)) return res.status(404).json({ok:false,error:'Agente no encontrado'});
  audit.record({actor:req.user.username, action:'agents.remove', target:req.params.id});
  res.status(204).end();
}
function rotate(req, res) {
  const result = agents.rotate(req.params.id);
  if (!result) return res.status(404).json({ ok: false, error: 'Agente no encontrado' });
  audit.record({ actor: req.user.username, action: 'agents.rotate', target: req.params.id });
  res.set('Cache-Control', 'no-store').json({ ok: true, data: result });
}

module.exports = { list, register, heartbeat, remove, rotate };
