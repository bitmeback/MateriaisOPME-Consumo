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

  // Buscar fornecedores de ortopedia com suas outras especialidades
  const daxOrtopedia = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[CD_FORNEC_CONSIGNADO],
            'OPME'[DS_FORNECEDOR],
            "Qtd_Registros", COUNTROWS(OPME),
            "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
        ),
        CONTAINSSTRING('OPME'[ESPECIALIDADE], "ortopedia")
    )
  `;

  const ortoReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxOrtopedia }] })
    }
  );

  const ortoRows = ortoReq.body.results[0].tables[0].rows;

  // Gerar lista para o João
  console.log("=== LISTA DE 58 FORNECEDORES PARA ORTOPEDIA ===\n");
  console.log("Copie e cole para validar com o time OPME:\n");
  console.log("---");

  ortoRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).forEach((r, i) => {
    const ds = r["OPME[DS_FORNECEDOR]"] || "(vazio)";
    console.log((i+1) + ". " + r["OPME[CD_FORNEC_CONSIGNADO]"] + " | " + ds);
  });

  console.log("---");
  console.log("\nTotal: " + ortoRows.length + " fornecedores");

  // Agora: para cada um, ver se aparece em outras especialidades (para dar contexto ao time)
  const ortoFornCds = ortoRows.map(r => r["OPME[CD_FORNEC_CONSIGNADO]"]);
  const cdList = ortoFornCds.map(c => "'" + c + "'").join(",");

  const daxOutrasEsp = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[CD_FORNEC_CONSIGNADO],
            'OPME'[ESPECIALIDADE],
            "Qtd_Registros", COUNTROWS(OPME)
        ),
        'OPME'[CD_FORNEC_CONSIGNADO] IN (${cdList}),
        NOT(CONTAINSSTRING('OPME'[ESPECIALIDADE], "ortopedia"))
    )
  `;

  const outrasReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxOutrasEsp }] })
    }
  );

  if (outrasReq.body.results && outrasReq.body.results[0]) {
    const outrasRows = outrasReq.body.results[0].tables[0].rows;

    // Agrupar por fornecedor
    const fornOutras = {};
    outrasRows.forEach(r => {
      const cd = r["OPME[CD_FORNEC_CONSIGNADO]"];
      if (!fornOutras[cd]) fornOutras[cd] = [];
      fornOutras[cd].push(r["OPME[ESPECIALIDADE]"] + " (" + r["[Qtd_Registros]"] + ")");
    });

    console.log("\n=== OUTRAS ESPECIALIDADES DESES FORNECEDORES (contexto) ===");
    console.log("(Para ajudar o time a decidir se o fornecedor é 'exclusivo' de ortopedia ou 'misto')\n");

    Object.entries(fornOutras).sort().forEach(([cd, esp]) => {
      console.log(cd + ":");
      esp.slice(0, 5).forEach(e => console.log("  - " + e));
      if (esp.length > 5) console.log("  ... e mais " + (esp.length - 5));
    });
  }

})();
