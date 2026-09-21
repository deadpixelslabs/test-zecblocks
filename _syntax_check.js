const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let count = 0;
for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
  new vm.Script(match[1], { filename: 'index.html:inline-' + (++count) });
}
if (!count) throw new Error('No inline scripts found');
console.log('Parsed ' + count + ' inline scripts.');
