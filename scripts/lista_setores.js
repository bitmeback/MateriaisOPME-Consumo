const https = require('https');
function req(url, opt = {}) {
  return new Promise((resolve, reject) => {
    const httpReq = https.request(url, opt, (resp) => {
      let data = '';
      resp.on('data', function(chunk) { data += chunk; });
      resp.on('end', function() {
        try {
          resolve({ status: resp.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: resp.statusCode, body: data });
        }
      });
    });
    httpReq.on('error', reject);
    if (opt.body) httpReq.write(opt.body);
    httpReq.end();
  });
}

(async () => {
  const BASE = 'https://donahelena.reportload.com';
  const WS = '0a4c534a-f8ef-4b3f-a842-4982c842b41c';
  const DATASET = '70a003f4-30ff-49a2-8991-deba110f7455';

  const loginReq = await req(BASE + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'compras4@donahelena.com.br',
      password: '@D3z3mbr0%',
      language: 'pt-BR'
    })
  });

  const rvReq = await req(BASE + '/api/auth/report_view/report-view?id=c498464e-67a3-43f0-8c22-2dbb5efe1048', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + loginReq.body.token, 'Content-Type': 'application/json' }
  });

  const myToken = rvReq.body.token.token;

  // Buscar setores distintos da tabela OPME (fato)
  const daxSetores = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[CD_SETOR],
        'OPME'[DS_SETOR],
        "Qtd_Registros", COUNTROWS(OPME)
    )
  `;

  const setoresReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxSetores }] })
    }
  );

  const rows = setoresReq.body.results[0].tables[0].rows;
  console.log("Total de setores: " + rows.length);
  console.log("\n=== COD_SETOR | DS_SETOR | Qtd_Registros ===");
  rows.forEach(r => {
    const cod = r["OPME[CD_SETOR]"];
    const ds = r["OPME[DS_SETOR]"];
    const qtd = r["[Qtd_Registros]"];
    console.log(cod + " | " + ds + " | " + qtd);
  });

})();
