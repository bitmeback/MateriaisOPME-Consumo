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

  // Buscar CD_FORNEC_CONSIGNADO e DS_FORNECEDOR da tabela OPME
  const daxFornecedores = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[CD_FORNEC_CONSIGNADO],
        'OPME'[DS_FORNECEDOR],
        "Qtd_Registros", COUNTROWS(OPME),
        "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
    )
  `;

  const fornReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxFornecedores }] })
    }
  );

  const fornRows = fornReq.body.results[0].tables[0].rows;
  console.log("=== FORNECEDORES NA OPME (CD_FORNEC_CONSIGNADO | DS_FORNECEDOR) ===");
  console.log("Total: " + fornRows.length);
  console.log("\nCD_FORNEC_CONSIGNADO | DS_FORNECEDOR | Qtd_Registros | Qtd_Cirurgias");
  console.log("---|---|---|---");
  fornRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).forEach(r => {
    const cd = r["OPME[CD_FORNEC_CONSIGNADO]"];
    const ds = r["OPME[DS_FORNECEDOR]"];
    const reg = r["[Qtd_Registros]"];
    const cir = r["[Qtd_Cirurgias]"];
    console.log(cd + " | " + ds + " | " + reg + " | " + cir);
  });

})();
