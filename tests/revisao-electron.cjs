'use strict';
const {_electron}=require('playwright'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),home=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-native-qa-')),out=process.env.COCKPIT_QA_OUT;let app;
(async()=>{const env={...process.env,COCKPIT_QA_HOME:home,COCKPIT_QA_SOURCE:process.env.COCKPIT_QA_OLD||root,COCKPIT_QA_NEW_SOURCE:root};delete env.ELECTRON_RUN_AS_NODE;
app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,process.env.COCKPIT_QA_OLD?'fixtures/electron-revisao-hot.cjs':'fixtures/electron-auditoria-main.cjs')],env});const page=await app.firstWindow(),erros=[];
await page.locator('#naOk').waitFor({state:'visible'});
if(process.env.COCKPIT_QA_OLD) console.log(await page.evaluate(fs.readFileSync(path.join(out,'Ativar revisão na tela.js'),'utf8')));
page.on('pageerror',e=>erros.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
await page.locator('.na-motor[data-motor=codex]').click();await page.locator('#naOk').click();
for(const [file,tipo] of [['Página para revisar.html','html'],['Documento para revisar.docx','docx'],['Documento antigo para revisar.doc','doc'],['PDF para revisar.pdf','pdf']]){
 const abs=path.join(out,'Arquivos de teste',file);await page.evaluate(f=>textFinal(focusPane,'arquivo'+Math.random(),`[Documento](<${f}>)`),abs);await page.locator('.entrega-doc').last().click();await page.waitForFunction(()=>!!focusPane.revisorArquivo);await page.evaluate(()=>focusPane.revisorArquivo.ready);
 await page.evaluate(tipo=>{const d=tipo==='pdf'?document:document.querySelector('.rev-frame').contentDocument,n=[...d.querySelectorAll(tipo==='pdf'?'.textLayer span':'p')].find(n=>n.textContent.includes('Organizamos'));const r=d.createRange();r.selectNodeContents(n);const s=d.defaultView.getSelection();s.removeAllRanges();s.addRange(r);d.dispatchEvent(new Event('selectionchange'));},tipo);
 await page.locator('.rev-ajustar').click();await page.locator('.rev-pedido').fill('Deixar a explicação mais simples.');await page.locator('.rev-salvar').click();await page.locator('.rev-pino').first().click();assert.equal(await page.locator('.rev-balao-texto').textContent(),'Deixar a explicação mais simples.');await page.locator('.rev-balao-fechar').click();await page.screenshot({path:path.join(out,'Prévia no aplicativo '+tipo+'.png')});
 await page.locator('.p-input').first().evaluate(n=>{n.value='Rascunho preservado';});await page.locator('.rev-enviar').click();await page.getByText('Resposta nativa de teste:',{exact:false}).last().waitFor();assert.equal(await page.locator('.p-input').first().inputValue(),'Rascunho preservado');await page.waitForFunction(()=>!focusPane.busy);
}
assert.deepEqual(erros,[]);fs.writeFileSync(path.join(out,process.env.COCKPIT_QA_OLD?'Teste nativo sem reiniciar.json':'Teste nativo.json'),JSON.stringify({ipcReal:true,formatos:['html','docx','doc','pdf'],envioAoMotorSimulado:true,rascunhoPreservado:true,erros},null,2));console.log('PDF, Word, HTML e envio nativo conferidos.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await app?.close();fs.rmSync(home,{recursive:true,force:true});});
