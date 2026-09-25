const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
// pega só o bloco novo (da const COMO_ATUALIZA_MOTOR até o fim de atualizarMotoresSozinho)
const ini = src.indexOf('const COMO_ATUALIZA_MOTOR');
const fim = src.indexOf("  } finally { atualizandoMotores = false; }\n}", ini) + "  } finally { atualizandoMotores = false; }\n}".length;
const bloco = src.slice(ini, fim);
assert.ok(ini > 0 && fim > ini, 'bloco novo encontrado');

function montar(cenario) {
  const log = [];
  const ctx = {
    EH_WIN: false, HOME: '/casa', fs: { existsSync: (p) => p === '/casa/.local/bin/claude' }, path,
    NPM_DOS_MOTORES: { claude: '@anthropic-ai/claude-code', codex: '@openai/codex' },
    CLAUDE_BIN: '/casa/.cockpit/bin/claude',
    loadConfig: () => cenario.config || {},
    anota: (...a) => log.push(a.join(' ')),
    // R2-031: a chamada de dentro de atualizarMotoresSozinho passou a ser a versão async
    usarClaudeDeCaminhoFixoAsync: async () => log.push('RECOPIEI'),
    versoesDosMotores: async () => cenario.versoes,
    rodar: async (bin, args) => {
      log.push('RODOU ' + bin + ' ' + args.join(' '));
      if (args[0] === '--version') return { out: cenario.depois + ' (Claude Code)', errout: '' };
      return cenario.falha ? { err: new Error('deu ruim'), errout: 'sem rede' } : { err: null, out: '', errout: '' };
    },
    win: { isDestroyed: () => false, webContents: { send: (canal, p) => log.push('AVISOU ' + canal + ' ' + JSON.stringify(p)) } },
  };
  const nomes = Object.keys(ctx);
  const f = new Function(...nomes, bloco + '\n; return atualizarMotoresSozinho;');
  return { rodar: f(...nomes.map(n => ctx[n])), log };
}

(async () => {
  // 1) versão atrasada: atualiza, recopia e avisa a tela
  let t = montar({ versoes: { claude: { instalada: '2.1.273', ultima: '2.1.277' } }, depois: '2.1.277' });
  await t.rodar('teste');
  assert.ok(t.log.some(l => l.includes('RODOU /casa/.local/bin/claude update')), 'chamou claude update');
  assert.ok(t.log.includes('RECOPIEI'), 'refez a cópia congelada');
  assert.ok(t.log.some(l => l.includes('AVISOU motores:atualizado') && l.includes('2.1.277')), 'avisou a tela');

  // 2) já na última: não faz nada
  t = montar({ versoes: { claude: { instalada: '2.1.277', ultima: '2.1.277' } }, depois: '2.1.277' });
  await t.rodar('teste');
  assert.deepStrictEqual(t.log, [], 'em dia não mexe em nada');

  // 3) instalada é MAIOR que a do npm (beta na máquina): não rebaixa
  t = montar({ versoes: { claude: { instalada: '2.2.0', ultima: '2.1.277' } }, depois: '2.2.0' });
  await t.rodar('teste');
  assert.deepStrictEqual(t.log, [], 'não rebaixa versão à frente');

  // 4) comando falhou: não avisa que atualizou
  t = montar({ versoes: { codex: { instalada: '0.154.0', ultima: '0.155.1' } }, depois: '0.154.0', falha: true });
  await t.rodar('teste');
  assert.ok(t.log.some(l => l.includes('falhou ao atualizar codex')), 'registrou a falha');
  assert.ok(!t.log.some(l => l.includes('AVISOU')), 'não mentiu dizendo que atualizou');

  // 5) saiu com código 0 mas a versão não mudou: também não avisa
  t = montar({ versoes: { codex: { instalada: '0.154.0', ultima: '0.155.1' } }, depois: '0.154.0' });
  await t.rodar('teste');
  assert.ok(t.log.some(l => l.includes('a versao nao mudou')), 'detectou update fantasma');
  assert.ok(!t.log.some(l => l.includes('AVISOU')), 'não avisou à toa');

  // 6) codex usa npm -g, não "claude update"
  t = montar({ versoes: { codex: { instalada: '0.154.0', ultima: '0.155.1' } }, depois: '0.155.1' });
  await t.rodar('teste');
  assert.ok(t.log.some(l => l.includes('RODOU npm i -g @openai/codex')), 'comando certo do codex');
  assert.ok(!t.log.includes('RECOPIEI'), 'codex não mexe na cópia do Claude');

  // 7) desligado no config: não roda nada
  t = montar({ versoes: { claude: { instalada: '2.1.273', ultima: '2.1.277' } }, depois: '2.1.277', config: { autoAtualizarMotores: false } });
  await t.rodar('teste');
  assert.deepStrictEqual(t.log, [], 'respeita o desligamento');

  console.log('7 testes passaram');
})();
