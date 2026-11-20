const state={token:'',apiKey:'',user:null,servers:[],lastHealth:null};
const $=id=>document.getElementById(id);
const esc=v=>String(v??'-').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function authHeaders(){const h={'content-type':'application/json'};if(state.apiKey)h['x-api-key']=state.apiKey;if(state.token)h.authorization='Bearer '+state.token;return h}
async function req(path,opt={}){const r=await fetch(path,{...opt,headers:{...authHeaders(),...(opt.headers||{})}});let d;try{d=await r.json()}catch{d={ok:r.ok}}if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);return d}
function toast(msg){$('toast').textContent=msg;$('toast').classList.remove('hidden');clearTimeout(window.toastT);window.toastT=setTimeout(()=>$('toast').classList.add('hidden'),3200)}
async function login(){
  $('loginError').textContent='';
  try{
    const key=$('apiKey').value.trim(), username=$('username').value.trim(), password=$('password').value;
    if(key){state.apiKey=key;state.token=''}
    else{
      if(!username||!password)throw new Error('Introduce usuario y contraseña, o una API key.');
      const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password})});
      const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'No se pudo iniciar sesión');
      state.token=d.data.token;state.apiKey='';
    }
    await boot();
  }catch(e){$('loginError').textContent=e.message}
}
async function boot(){
  const me = await req('/api/auth/me');
  state.user = me.data;
  if(!state.user)throw new Error('Sesión no válida');
  $('loginView').classList.add('hidden');$('app').classList.remove('hidden');
  $('userName').textContent=state.user.username||'Usuario';$('userRole').textContent=state.user.role||'—';
  $('authMode').textContent=state.apiKey?'API key · SUPER_ADMIN':'Sesión de usuario · RBAC';
  document.querySelectorAll('[data-action="scan"]').forEach(button => { button.classList.toggle('hidden', !canCheck()); });
  await refresh();
}
async function logout(){
  try {
    if (state.token) await req('/api/auth/logout', { method: 'POST' });
    location.reload();
  } catch (error) {
    toast(error.message);
  }
}
function canCheck(){ return ['SUPER_ADMIN', 'ADMIN', 'OPERATOR'].includes(state.user?.role); }
async function refresh(){
  try{
    const [o,s,h,agents]=await Promise.all([req('/api/admin/overview'),req('/api/servers'),req('/api/health'),req('/api/admin/agents')]);
    state.servers=s.data||[];state.lastHealth=h;
    const d=o.data||{};$('total').textContent=d.total??state.servers.length;$('online').textContent=d.online??state.servers.filter(x=>x.status==='online').length;$('offline').textContent=d.offline??state.servers.filter(x=>x.status==='offline').length;$('bridges').textContent=d.bridges??0;
    const total=Number($('total').textContent)||0, online=Number($('online').textContent)||0;$('onlinePct').textContent=total?`${Math.round(online/total*100)}% del inventario saludable`:'Sin servidores';
    $('serverCount').textContent=`${state.servers.length} registrados`;$('serverCount2').textContent=`${state.servers.length} registrados`;$('monitorTotal').textContent=state.servers.length;
    const up=Math.round(h.uptimeSec||0);$('runtime').textContent=`Uptime ${formatUptime(up)}`;$('runtime2').textContent=formatUptime(up);$('healthTime').textContent=new Date().toLocaleTimeString();
    $('lastSync').textContent=`Sincronizado ${new Date().toLocaleTimeString()}`;
    renderServers();
    renderEntries('activity', d.events || [], 'Sin eventos', item => [item.message, item.createdAt]);
    renderEntries('agentsList', agents.data || [], 'Sin agentes registrados',
      item => [item.name, item.status]);
  }catch(e){toast('Error de conexión: '+e.message)}
}
function formatUptime(s){if(s<60)return `${s}s`;if(s<3600)return `${Math.floor(s/60)}m`;if(s<86400)return `${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`;return `${Math.floor(s/86400)}d ${Math.floor(s%86400/3600)}h`}
function statusBadge(s){const c=s==='online'?'online':s==='offline'?'offline':'unknown';return `<span class="badge ${c}">${esc(s||'unknown')}</span>`}
function row(x,full=false){
 const host=x.url||`${x.host||'-'}${x.port?':'+x.port:''}`,lat=x.health?.latencyMs;
 return `<tr><td><span class="server-name">${esc(x.name)}</span><span class="server-meta">${esc(x.id)}</span></td>${full?`<td>${esc(host)}</td>`:''}<td>${esc(x.environment||'-')}</td><td>${statusBadge(x.status)}</td><td>${lat==null?'-':esc(lat)+' ms'}</td><td class="actions">${canCheck() ? `<button class="btn mini" data-server-id="${esc(x.id)}">Comprobar</button>` : ''}</td></tr>`
}
function renderServers(){
 const empty='<tr><td colspan="6" class="empty">No hay servidores registrados.</td></tr>';
 $('rows').innerHTML=state.servers.length?state.servers.map(x=>row(x,false)).join(''):empty;
 $('rows2').innerHTML=state.servers.length?state.servers.map(x=>row(x,true)).join(''):empty;
}
async function checkHealth(id){try{toast('Comprobando salud…');await req('/api/servers/'+encodeURIComponent(id)+'/health',{method:'POST'});await refresh();toast('Comprobación completada')}catch(e){toast('Health check: '+e.message)}}
async function scan(){try{toast('Escaneando servidores…');await req('/api/admin/scan',{method:'POST'});await refresh();toast('Escaneo completado')}catch(e){toast('Escaneo: '+e.message)}}
function renderEntries(id, items, empty, describe){
  $(id).innerHTML = items.length ? items.map(item => {
    const [title, description] = describe(item);
    return `<div class="activity-item"><strong>${esc(title)}</strong><small>${esc(description)}</small></div>`;
  }).join('') : `<div class="empty">${esc(empty)}</div>`;
}
function setView(view){
 ['overview','servers','monitoring','events','agents','settings'].forEach(v=>$(`${v}View`).classList.toggle('hidden',v!==view));
 document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
 const names={overview:'Overview / Estado general',servers:'Servidores / Inventario',monitoring:'Monitoring / Observability',events:'Eventos / Actividad',agents:'Agentes / Edge',settings:'Configuración / Plataforma'};$('crumb').textContent=names[view];
}
$('password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});
$('apiKey').addEventListener('keydown',e=>{if(e.key==='Enter')login()});

const actions = { login, logout, refresh, scan };
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  const { action, view, serverId } = button.dataset;
  if (action) actions[action]();
  else if (view) setView(view);
  else if (serverId) checkHealth(serverId);
});
$('apiOrigin').textContent = location.origin;
sessionStorage.removeItem('uniserver_token');
sessionStorage.removeItem('uniserver_key');
