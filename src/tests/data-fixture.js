const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = function isolateData() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'uniserver-test-'));
  process.env.DATA_FILE = path.join(directory, 'state.json');
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
  afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
  return process.env.DATA_FILE;
};
