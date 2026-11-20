const { log } = require('../utils/logger');

module.exports = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.statusCode || error.status || 500;
  if (status >= 500) log('error', 'Error procesando solicitud', { status, code: error.code });
  const message = status >= 500 ? 'Error interno' :
    error.type === 'entity.parse.failed' ? 'JSON inválido' : error.message;
  return res.status(status).json({ ok: false, error: message });
};
