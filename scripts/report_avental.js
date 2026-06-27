#!/usr/bin/env node
const https = require('https');
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = ''; res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject); if (options.body) req.write(options.body); req.end();
  });
}
(async () => {
  const baseUrl = 'https://donahelena.reportload.com';
  const workspaceId = '0a4c534a-f8ef-4b3f-a842-4982c842b41c';
  const datasetId = '70a003f4-30ff-49a2-8991-deba110f7455';
  const loginRes = await makeRequest(baseUrl + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'compras4@donahelena.com.br', password: '@D3z3mbr0%', language: 'pt-BR' })
  });
  const reportViewRes = await makeRequest(baseUrl + '/api/auth/report_view/report-view?id=c498464e-67a3-43f0-8c22-2dbb5efe1048', {
    method: 'GET', headers: { 'Authorization': 'Bearer ' + loginRes.body.token, 'Content-Type': 'application/json' }
  });
  const embeddedToken = reportViewRes.body?.token?.token;

  const daxQuery = `
    EVALUATE
    CALCULATETABLE(
      ADDCOLUMNS(
        SUMMARIZECOLUMNS(
          'OPME'[CD_MATERIAL],
          'OPME'[DS_MATERIAL],
          "TotalConsumo", SUM('OPME'[QT_MATERIAL]),
          "QtdCirurgias", COUNTROWS(OPME)
        ),
        "SaldoAtual", CALCULATE(SUM('SALDO_ESTOQUE'[SALDO]))
      ),
      CONTAINSSTRING('OPME'[DS_MATERIAL], "AVENTAL")
    )
  `;
  const queryRes = await makeRequest('https://api.powerbi.com/v1.0/myorg/groups/' + workspaceId + '/datasets/' + datasetId + '/executeQueries', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + embeddedToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: [{ query: daxQuery }] })
  });

  if (queryRes.status === 200 && queryRes.body.results) {
    const rows = queryRes.body.results[0].tables[0].rows;
    rows.sort((a,b) => b['[TotalConsumo]'] - a['[TotalConsumo]']);

    let totalConsumo = 0, totalSaldo = 0;
    rows.forEach(r => { totalConsumo += r['[TotalConsumo]']||0; totalSaldo += r['[SaldoAtual]']||0; });

    console.log('RELATORIO: MATERIAIS COM AVENTAL (Cubo DAX x MariaDB)');
    console.log('Total de materiais unicos: ' + rows.length);
    console.log('Consumo total (historico): ' + totalConsumo);
    console.log('Saldo total (atual): ' + totalSaldo);
    console.log('');
    console.log('CD_MATERIAL | DESCRICAO                                  | CONSUMO | SALDO');
    console.log('------------|---------------------------------------------|---------|-------');
    rows.forEach(r => {
      const cd = String(r['OPME[CD_MATERIAL]']).padEnd(11);
      const ds = String(r['OPME[DS_MATERIAL']]||'').substring(0, 45).padEnd(45);
      const cons = String(r['[TotalConsumo]']).padEnd(7);
      const sld = String(r['[SaldoAtual]']||0).padEnd(5);
      console.log(cd + ' | ' + ds + ' | ' + cons + ' | ' + sld);
    });

    const alvo = rows.find(function(r){
      var d = r['OPME[DS_MATERIAL]'] || '';
      return d.indexOf('LGG')>-1 && d.indexOf('Pion G')>-1 && d.indexOf('Descart')>-1;
    });
    if (alvo) {
      console.log('');
      console.log('>>> MATERIAL ESPECIFICO SOLICITADO:');
      console.log('    ' + alvo['OPME[DS_MATERIAL]']);
      console.log('    CD: ' + alvo['OPME[CD_MATERIAL]']);
      console.log('    Consumo: ' + alvo['[TotalConsumo]']);
      console.log('    Saldo Atual: ' + alvo['[SaldoAtual]']);
    } else {
      console.log('');
      console.log('>>> Material especifico nao encontrado exatamente.');
      var simil = rows.filter(function(r){
        var d = r['OPME[DS_MATERIAL]'] || '';
        return d.indexOf('LGG')>-1;
      });
      console.log('    Materiais LGG encontrados:');
      simil.forEach(function(r){
        console.log('    - CD ' + r['OPME[CD_MATERIAL]'] + ' | ' + r['OPME[DS_MATERIAL]'] + ' | Saldo: ' + (r['[SaldoAtual]']||0));
      });
    }
  } else {
    console.log('Erro:', JSON.stringify(queryRes.body).substring(0, 500));
  }
})();
