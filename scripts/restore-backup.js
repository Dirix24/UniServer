const { restoreFromBackup } = require('../src/config/db');

const [source, destination] = process.argv.slice(2);
if (!source || !destination || process.argv.length !== 4) {
  console.error('Uso: node scripts/restore-backup.js <archivo.bak> <archivo-nuevo.json>');
  process.exitCode = 2;
} else {
  try {
    restoreFromBackup(source, destination);
    console.log('Copia validada y restaurada.');
  } catch (error) {
    console.error('Error de restauración:', error.code || 'estructura inválida');
    process.exitCode = 1;
  }
}
