const store = require('./store.service');
const { hashPassword, verifyPassword } = require('./crypto.util');
const { username: validUsername, password: validPassword, invalid } = require('../utils/validation');
const { VALID_ROLES } = require('../config/roles');

function sanitize(u){ if(!u) return u; const {passwordHash, passwordSalt, ...rest} = u; return rest; }
function list(){ return store.list('users').map(sanitize); }
function findByUsername(username){ return store.list('users').find(u=>u.username===username); }

function create({username, password, role}){
  if (!validUsername(username) || !validPassword(password) || password.length < 12) {
    invalid('Usuario inválido o contraseña de menos de 12 caracteres');
  }
  if (!VALID_ROLES.includes(role)) invalid('role inválido');
  const { salt, hash } = hashPassword(password);
  const user = store.create('users', { username, role, passwordSalt: salt, passwordHash: hash, active: true }, { guard: data => {
    if (data.users.some(entry => entry.username === username)) {
      throw Object.assign(new Error('El usuario ya existe'), { statusCode: 409 });
    }
  } });
  return sanitize(user);
}

function verify(username, password){
  const user = findByUsername(username);
  if(!user || user.active===false) return null;
  if(!verifyPassword(password, user.passwordSalt, user.passwordHash)) return null;
  return user;
}

function setRole(id, role){
  if(!VALID_ROLES.includes(role)) throw Object.assign(new Error('role inválido'), {statusCode:400});
  const user = store.update('users', id, {role}, {revokeSessions: true});
  return sanitize(user);
}

function setActive(id, active){
  if (typeof active !== 'boolean') invalid('active debe ser booleano');
  const user = store.update('users', id, {active}, {revokeSessions: true});
  return sanitize(user);
}

function ensureBootstrapAdmin(){
  if(store.list('users').length>0) return;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if(username && password) create({username, password, role:'SUPER_ADMIN'});
}

module.exports = { list, create, verify, setRole, setActive, findByUsername, sanitize, ensureBootstrapAdmin };
