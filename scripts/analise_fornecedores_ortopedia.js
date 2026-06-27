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

  // 1. Buscar fornecedores que aparecem em cirurgias de "Ortopedia e traumatologia"
  const daxFornOrtopedia = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[CD_FORNEC_CONSIGNADO],
            'OPME'[DS_FORNECEDOR],
            "Qtd_Registros", COUNTROWS(OPME),
            "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
        ),
        'OPME'[ESPECIALIDADE] = "Ortopedia e traumatologia"
    )
  `;

  const ortoReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxFornOrtopedia }] })
    }
  );

  const ortoRows = ortoReq.body.results[0].tables[0].rows;
  console.log("=== FORNECEDORES EM ORTOPEDIA E TRAUMATOLOGIA ===");
  console.log("Total: " + ortoRows.length);
  console.log("\nCD_FORNEC | DS_FORNECEDOR | Qtd_Registros | Qtd_Cirurgias");
  ortoRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).forEach(r => {
    console.log(r["OPME[CD_FORNEC_CONSIGNADO]"] + " | " + r["OPME[DS_FORNECEDOR]"].substring(0, 40) + " | " + r["[Qtd_Registros]"] + " | " + r["[Qtd_Cirurgias]"]);
  });

  // 2. Buscar fornecedores que aparecem em cirurgias de "Cirurgia da mão, Ortopedia e traumatologia"
  const daxFornMao = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[CD_FORNEC_CONSIGNADO],
            'OPME'[DS_FORNECEDOR],
            "Qtd_Registros", COUNTROWS(OPME),
            "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
        ),
        'OPME'[ESPECIALIDADE] = "Cirurgia da mão, Ortopedia e traumatologia"
    )
  `;

  const maoReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxFornMao }] })
    }
  );

  const maoRows = maoReq.body.results[0].tables[0].rows;
  console.log("\n=== FORNECEDORES EM CIRURGIA DA MÃO, ORTOPEDIA E TRAUMATOLOGIA ===");
  console.log("Total: " + maoRows.length);
  maoRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).forEach(r => {
    console.log(r["OPME[CD_FORNEC_CONSIGNADO]"] + " | " + r["OPME[DS_FORNECEDOR]"].substring(0, 40) + " | " + r["[Qtd_Registros]"] + " | " + r["[Qtd_Cirurgias]"]);
  });

  // 3. Buscar fornecedores que aparecem APENAS em especialidades cirúrgicas (não ortopedia)
  const daxFornCirurgica = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[CD_FORNEC_CONSIGNADO],
            'OPME'[DS_FORNECEDOR],
            "Qtd_Registros", COUNTROWS(OPME),
            "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
        ),
        'OPME'[ESPECIALIDADE] = "Cirurgia geral"
    )
  `;

  const cirReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxFornCirurgica }] })
    }
  );

  const cirRows = cirReq.body.results[0].tables[0].rows;
  console.log("\n=== FORNECEDORES EM CIRURGIA GERAL ===");
  console.log("Total: " + cirRows.length);
  cirRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).slice(0, 15).forEach(r => {
    console.log(r["OPME[CD_FORNEC_CONSIGNADO]"] + " | " + r["OPME[DS_FORNECEDOR]"].substring(0, 40) + " | " + r["[Qtd_Registros]"] + " | " + r["[Qtd_Cirurgias]"]);
  });

  // 4. Buscar fornecedores que NÃO aparecem em ortopedia
  const daxFornNaoOrtopedia = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[CD_FORNEC_CONSIGNADO],
            'OPME'[DS_FORNECEDOR],
            "Qtd_Registros", COUNTROWS(OPME),
            "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
        ),
        NOT('OPME'[ESPECIALIDADE] IN {"Ortopedia e traumatologia", "Cirurgia da mão, Ortopedia e traumatologia"})
    )
  `;

  const naoOrtoReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxFornNaoOrtopedia }] })
    }
  );

  const naoOrtoRows = naoOrtoReq.body.results[0].tables[0].rows;
  console.log("\n=== FORNECEDORES QUE NÃO APARECEM EM ORTOPEDIA ===");
  console.log("Total: " + naoOrtoRows.length);
  naoOrtoRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).slice(0, 15).forEach(r => {
    console.log(r["OPME[CD_FORNEC_CONSIGNADO]"] + " | " + r["OPME[DS_FORNECEDOR]"].substring(0, 40) + " | " + r["[Qtd_Registros]"] + " | " + r["[Qtd_Cirurgias]"]);
  });

  // 5. Verificar se os fornecedores de ortopedia também aparecem em outras especialidades
  // (para entender se um fornecedor pode ser "misto" — ortopedia + cardiovascular, etc.)
  const ortoFornCds = new Set(ortoRows.map(r => r["OPME[CD_FORNEC_CONSIGNADO]"]));
  const maoFornCds = new Set(maoRows.map(r => r["OPME[CD_FORNEC_CONSIGNADO]"]));
  const todosOrtoForn = new Set([...ortoFornCds, ...maoFornCds]);

  console.log("\n=== RESUMO ===");
  console.log("Fornecedores em Ortopedia: " + ortoFornCds.size);
  console.log("Fornecedores em Cirurgia da Mão/Ortopedia: " + maoFornCds.size);
  console.log("Fornecedores únicos em qualquer uma das duas: " + todosOrtoForn.size);

})();
