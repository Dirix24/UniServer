require('dotenv').config();
const express=require('express'); const path=require('path'); const http=require('http');
const {setupSecurity,validateSecrets}=require('./config/security');
const serverRoutes=require('./routes/server.routes');
const adminRoutes=require('./routes/admin.routes');
const authRoutes=require('./routes/auth.routes');
const userRoutes=require('./routes/user.routes');
const agentRoutes=require('./routes/agent.routes');
const auditRoutes=require('./routes/audit.routes');
const systemRoutes=require('./routes/system.routes');
const errorHandler=require('./middlewares/error.middleware');
const {log}=require('./utils/logger');
const users=require('./services/user.service');
const agents=require('./services/agent.service');
const {attach}=require('./realtime/ws.server');

validateSecrets();
users.ensureBootstrapAdmin();

const app=express();
setupSecurity(app);
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));

app.get('/',(req,res)=>res.json({service:'UniServer',description:'Gestor universal de servidores',docs:'/dashboard'}));
app.use('/api',serverRoutes);
app.use('/api/admin',adminRoutes);
app.use('/api/auth',authRoutes);
app.use('/api/admin/users',userRoutes);
app.use('/api/admin/agents',agentRoutes.admin);
app.use('/api/agents',agentRoutes.pub);
app.use('/api/admin/audit',auditRoutes);
app.use('/api',systemRoutes);
app.use('/dashboard',express.static(path.join(__dirname,'../public')));
app.use(errorHandler);

if(require.main===module){
  const port=Number(process.env.PORT||3000); const host=process.env.HOST||'0.0.0.0';
  const httpServer=http.createServer(app);
  const rt=attach(httpServer);
  const sweep = setInterval(() => {
    try { agents.sweepOffline(); }
    catch (error) { log('error', 'Error revisando agentes', { code: error.code }); }
  }, 30000);
  sweep.unref();
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      clearInterval(sweep);
      rt.close();
      httpServer.close();
      setTimeout(() => httpServer.closeAllConnections(), 10000).unref();
    });
  }
  httpServer.listen(port,host,()=>log('info','UniServer iniciado',{port:httpServer.address().port,host}));
}
module.exports=app;
