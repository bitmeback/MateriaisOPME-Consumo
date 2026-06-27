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

  // Query: contar por material, quantos fornecedores tem no saldo, e quantos tem saldo > 0
  const daxAnalise = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'SALDO_ESTOQUE'[CD_MATERIAL],
        "Qtd_Fornecedores", DISTINCTCOUNT('SALDO_ESTOQUE'[CD_FORNEC_CONSIGNADO]),
        "Fornc_Com_Saldo", CALCULATE(DISTINCTCOUNT('SALDO_ESTOQUE'[CD_FORNEC_CONSIGNADO]), 'SALDO_ESTOQUE'[SALDO] > 0),
        "Fornc_Saldo_Zerado", CALCULATE(DISTINCTCOUNT('SALDO_ESTOQUE'[CD_FORNEC_CONSIGNADO]), 'SALDO_ESTOQUE'[SALDO] = 0),
        "Saldo_Total", SUM('SALDO_ESTOQUE'[SALDO]),
        "Max_Saldo", MAX('SALDO_ESTOQUE'[SALDO]),
        "Min_Saldo", MIN('SALDO_ESTOQUE'[SALDO])
    )
  `;

  const analiseReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxAnalise }] })
    }
  );

  const rows = analiseReq.body.results[0].tables[0].rows;
  console.log("Total de materiais no SALDO_ESTOQUE: " + rows.length);

  // Classificar os materiais
  let multiFornComSaldo = 0;      // 2+ fornecedores, pelo menos 1 com saldo
  let multiFornSaldoZerado = 0;   // 2+ fornecedores, todos com saldo 0
  let singleFornComSaldo = 0;     // 1 fornecedor com saldo > 0
  let singleFornSaldoZerado = 0;  // 1 fornecedor com saldo 0
  let multiFornTodosComSaldo = 0; // 2+ fornecedores, todos com saldo > 0

  const exemplos = [];

  rows.forEach((r, i) => {
    const qtdForn = r["Qtd_Fornecedores"] || 0;
    const forncComSaldo = r["Fornc_Com_Saldo"] || 0;
    const forncZerado = r["Fornc_Saldo_Zerado"] || 0;
    const saldoTotal = r["Saldo_Total"] || 0;

    if (qtdForn === 1 && forncComSaldo === 1) singleFornComSaldo++;
    else if (qtdForn === 1 && forncZerado === 1) singleFornSaldoZerado++;
    else if (qtdForn > 1 && forncComSaldo === qtdForn) multiFornTodosComSaldo++;
    else if (qtdForn > 1 && forncComSaldo >= 1 && forncZerado >= 1) {
      multiFornComSaldo++;
      if (exemplos.length < 10) {
        exemplos.push({
          cd: r["SALDO_ESTOQUE[CD_MATERIAL]"],
          qtdForn,
          forncComSaldo,
          forncZerado,
          saldoTotal
        });
      }
    }
    else if (qtdForn > 1 && forncComSaldo === 0) multiFornSaldoZerado++;
  });

  console.log("\n=== CLASSIFICAÇÃO DOS MATERIAIS ===");
  console.log("1 fornecedor COM saldo > 0: " + singleFornComSaldo);
  console.log("1 fornecedor saldo = 0: " + singleFornSaldoZerado);
  console.log("Multi fornecedores, TODOS com saldo: " + multiFornTodosComSaldo);
  console.log("Multi fornecedores, ALGUNS com saldo + zerados: " + multiFornComSaldo);
  console.log("Multi fornecedores, TODOS zerados: " + multiFornSaldoZerado);

  console.log("\n=== EXEMPLOS: Multi-fornecedor com mix de saldo ===");
  exemplos.forEach(e => {
    console.log("  CD=" + e.cd + " | Forn=" + e.qtdForn + " | ComSaldo=" + e.forncComSaldo + " | Zerado=" + e.forncZerado | " | Total=" + e.saldoTotal);
  });

  // Agora pegar os detalhes dos exemplos para ver os fornecedores
  if (exemplos.length > 0) {
    const cdList = exemplos.map(e => e.cd).join(",");
    const daxDetail = `
      EVALUATE
      CALCULATETABLE(
          SUMMARIZECOLUMNS(
              'SALDO_ESTOQUE'[CD_MATERIAL],
              'SALDO_ESTOQUE'[CD_FORNEC_CONSIGNADO],
              "Saldo", SUM('SALDO_ESTOQUE'[SALDO])
          ),
          'SALDO_ESTOQUE'[CD_MATERIAL] IN (${cdList})
      )
    `;

    const detailReq = await req(
      'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query: daxDetail }] })
      }
    );

    const detailRows = detailReq.body.results[0].tables[0].rows;
    console.log("\n=== DETALHAMENTO DOS EXEMPLOS ===");

    let currentCd = null;
    detailRows.forEach(r => {
      const cd = r["SALDO_ESTOQUE[CD_MATERIAL]"];
      const forn = r["SALDO_ESTOQUE[CD_FORNEC_CONSIGNADO]"];
      const sld = r["[Saldo]"] || 0;

      if (cd !== currentCd) {
        console.log("\n  Material " + cd + ":");
        currentCd = cd;
      }
      console.log("    Forn: " + forn + " | Saldo: " + sld);
    });
  }

})();
