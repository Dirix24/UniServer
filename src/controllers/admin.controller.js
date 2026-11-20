const v = require('../utils/validation');
const smallObject = value => v.object(value) && Buffer.byteLength(JSON.stringify(value)) <= 8192;
const schemas = {
  bridges: { name: v.text(128), description: v.text(2048, 0), url: v.text(2048),
    type: v.text(64), enabled: v.boolean, config: smallObject },
  events: { type: v.text(64), severity: v.text(32), message: v.text(2048),
    serverId: v.id, metadata: smallObject }
};
const store=require('../services/store.service'); const manager=require('../services/manager.service'); const audit=require('../services/audit.service');
function crud(type){return {
  list:(req,res)=>res.json({ok:true,data:store.list(type)}),
  create:(req,res)=>{const item=store.create(type,v.fields(req.body,schemas[type],type==='bridges'?['name']:['message'])); audit.record({actor:req.user.username, action:type+'.manage', target:item.id, meta:{op:'create'}}); res.status(201).json({ok:true,data:item});},
  update:(req,res)=>{const x=store.update(type,req.params.id,v.fields(req.body,schemas[type])); if(!x)return res.status(404).json({ok:false,error:'No encontrado'}); audit.record({actor:req.user.username, action:type+'.manage', target:x.id, meta:{op:'update'}}); res.json({ok:true,data:x});},
  remove:(req,res)=>{if(!store.remove(type,req.params.id))return res.status(404).json({ok:false,error:'No encontrado'}); audit.record({actor:req.user.username, action:type+'.manage', target:req.params.id, meta:{op:'delete'}}); res.status(204).end();}
}}
const bridges=crud('bridges'); const events=crud('events');
async function overview(req,res){res.json({ok:true,data:manager.summary()});}
async function scan(req,res){const result=await manager.checkAll(); audit.record({actor:req.user.username, action:'servers.manage', meta:{op:'scan', count:result.length}}); res.json({ok:true,data:result});}
module.exports={bridges,events,overview,scan};
