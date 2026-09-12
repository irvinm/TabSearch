const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function getFuse() {
  const fusePath = path.resolve(__dirname, '../../src/fuse.basic.min.js');
  const code = fs.readFileSync(fusePath, 'utf8');
  const context = {};
  vm.createContext(context);
  vm.runInContext(code, context);
  return context.Fuse;
}

module.exports = { getFuse };
