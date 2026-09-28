'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('terminal Python sem canal extra continua lendo o que foi digitado', { skip: process.platform === 'win32' }, async () => {
  const child = spawn('/usr/bin/python3', [path.join(__dirname, '../ptybridge.py'), '80', '24',
    '/usr/bin/python3', '-u', '-c', 'print("PRONTO"); print("RECEBIDO:" + input())']);
  let out = '', enviou = false;
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('terminal deixou de ler a entrada; saída: ' + out)); }, 15000);
    child.stdout.on('data', data => {
      out += data.toString();
      if (!enviou && out.includes('PRONTO')) { enviou = true; child.stdin.write('resposta\n'); }
    });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', n => { clearTimeout(timer); resolve(n); });
  });
  assert.match(out, /RECEBIDO:resposta/);
  assert.equal(code, 0);
});
