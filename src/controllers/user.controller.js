const v = require('../utils/validation');
const { VALID_ROLES } = require('../config/roles');
const role = value => VALID_ROLES.includes(value);
const users = require('../services/user.service');
const audit = require('../services/audit.service');

async function list(req,res){ res.json({ok:true, data: users.list()}); }
async function create(req,res){
  const user = users.create(v.fields(req.body, { username: v.username, password: v.password, role }, ['username', 'password', 'role']));
  audit.record({actor:req.user.username, action:'users.create', target:user.username});
  res.status(201).json({ok:true, data:user});
}
async function setRole(req,res){
  const user = users.setRole(req.params.id, v.fields(req.body, { role }, ['role']).role);
  if(!user) return res.status(404).json({ok:false,error:'Usuario no encontrado'});
  audit.record({actor:req.user.username, action:'users.setRole', target:user.username, meta:{role:user.role}});
  res.json({ok:true, data:user});
}
async function setActive(req,res){
  const user = users.setActive(req.params.id, v.fields(req.body, { active: v.boolean }, ['active']).active);
  if(!user) return res.status(404).json({ok:false,error:'Usuario no encontrado'});
  audit.record({actor:req.user.username, action:'users.setActive', target:user.username, meta:{active:user.active}});
  res.json({ok:true, data:user});
}
module.exports = { list, create, setRole, setActive };
