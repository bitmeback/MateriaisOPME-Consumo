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

  // Usar SUMMARIZECOLUMNS para trazer ESPECIALIDADE como dimensão
  const dax = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[ESPECIALIDADE],
        "Qtd_Registros", COUNTROWS(OPME),
        "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
    )
  `;

  const r = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: dax }] })
    }
  );

  if (r.body.results && r.body.results[0]) {
    const rows = r.body.results[0].tables[0].rows;
    console.log("=== OPME[ESPECIALIDADE] ===");
    console.log("Total de valores distintos: " + rows.length);
    console.log("\nEspecialidade | Qtd_Registros | Qtd_Cirurgias");
    console.log("---|---|---");
    rows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).forEach(r2 => {
      const esp = r2["OPME[ESPECIALIDADE]"] || "(vazio)";
      console.log(esp + " | " + r2["[Qtd_Registros]"] + " | " + r2["[Qtd_Cirurgias]"]);
    });
  } else {
    console.log("Erro: " + JSON.stringify(r.body).substring(0, 500));
  }

})();
