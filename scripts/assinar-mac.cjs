/* Depois do build no Mac: amarra a assinatura ao NOME do app (com.adsure.cockpit),
   não ao hash do arquivo. Sem isso o macOS esquece o Acesso Total ao Disco a cada
   versão nova, porque acha que é outro app. No Windows não faz nada. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  const req = path.join(os.tmpdir(), 'cockpit-req.txt');
  fs.writeFileSync(req, 'designated => identifier "com.adsure.cockpit"\n');
  execFileSync('codesign', ['--force', '--sign', '-', '-r', req, app], { stdio: 'inherit' });
  const saida = execFileSync('codesign', ['-d', '-r-', app], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!/identifier "com\.adsure\.cockpit"/.test(saida)) throw new Error('assinatura por nome não pegou');
};
