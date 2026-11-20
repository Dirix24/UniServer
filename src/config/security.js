const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

function validateSecrets() {
  if (process.env.NODE_ENV !== 'production') return;
  const { ADMIN_API_KEY, ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (ADMIN_API_KEY && ADMIN_API_KEY.length < 32) throw new Error('ADMIN_API_KEY requiere al menos 32 caracteres');
  if ((ADMIN_USERNAME || ADMIN_PASSWORD) &&
      (!ADMIN_USERNAME || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 16 ||
       ADMIN_PASSWORD === 'cambia-esta-password')) {
    throw new Error('Credenciales de bootstrap inválidas');
  }
}

const origins = new Set((process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));

function setupSecurity(app) {
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
    strictTransportSecurity: process.env.NODE_ENV === 'production'
  }));
  app.use(cors({ origin: (origin, done) => done(null, origins.has(origin)) }));
  app.use(rateLimit({ windowMs: 60000, limit: 300, standardHeaders: true, legacyHeaders: false }));
}

const loginLimit = rateLimit({
  windowMs: 60000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos de inicio de sesión' }
});

module.exports = { setupSecurity, validateSecrets, loginLimit };
