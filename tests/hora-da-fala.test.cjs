/* 26/09 (pedido dele): conversa em que ele não mexeu hoje aparecia em "Hoje" — a lista usava a hora
   em que o ARQUIVO foi gravado (a mudança de pastas regravou vários). Agora vale a da última fala. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { horaDaUltimaFala, horaNoTexto } = require('../hora-da-fala');

test('os 4 formatos: Claude/Codex (timestamp), Grok (t), Gemini do Cockpit (criado)', () => {
  const claude = '{"type":"user","timestamp":"2026-09-11T03:28:19.796Z"}\n{"type":"assistant","timestamp":"2026-09-11T03:30:00.000Z"}';
  assert.equal(horaNoTexto(claude), Date.parse('2026-09-11T03:30:00.000Z'));
  assert.equal(horaNoTexto('{"t":1789825331615,"cabecalho":1}\n{"t":1789832896083,"role":"bot"}'), 1789832896083);
  assert.equal(horaNoTexto('{"cockpit":1,"id":"x","criado":1789833160147}\n{"role":"user","text":"oi"}'), 1789833160147);
  assert.equal(horaNoTexto('{"role":"user","text":"oi"}'), 0);
});

test('arquivo regravado hoje sem fala nova continua com a data da fala; sem hora dentro, fica a gravação', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hora-fala-'));
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, '{"t":1789825331615,"cabecalho":1}\n{"t":1789832896083,"role":"bot","text":"x"}\n');
  const hoje = Date.parse('2026-09-26T15:54:46Z');
  assert.equal(horaDaUltimaFala(f, hoje), 1789832896083);
  fs.writeFileSync(f, '{"role":"user","text":"sem hora"}\n');
  assert.equal(horaDaUltimaFala(f, hoje), hoje);
  // nunca passa da hora da gravação
  fs.writeFileSync(f, '{"t":9999999999999}\n');
  assert.equal(horaDaUltimaFala(f, hoje), hoje);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a lista das 4 IAs usa a hora da última fala', () => {
  const raiz = path.join(__dirname, '..');
  const main = fs.readFileSync(path.join(raiz, 'main.js'), 'utf8');
  assert.match(main, /engine: 'claude', id: it\.id, title, cwd: fi\.cwd \|\| HOME, when: fi\.ultima \|\| it\.mtime/);
  assert.match(main, /engine: 'codex', id, title: title\.slice\(0, 120\), cwd: fi\.cwd \|\| HOME, when: fi\.ultima \|\| it\.mtime/);
  const cli = fs.readFileSync(path.join(raiz, 'cli-motors.js'), 'utf8');
  assert.match(cli, /quando = horaDaUltimaFala\(p, quando\);/);
  assert.match(cli, /when: horaDaUltimaFala\(file, fs\.statSync\(file\)\.mtimeMs\)/);
  assert.match(cli, /msg\.t === undefined \? \{ \.\.\.msg, t: Date\.now\(\) \}/, 'linha nova do Gemini leva a hora');
  assert.match(fs.readFileSync(path.join(raiz, 'acp.js'), 'utf8'), /when = horaDaUltimaFala\(f, gravado\);/);
  assert.match(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'), /"hora-da-fala\.js"/);
});
