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

  // Buscar na tabela OPME colunas que podem ter NR_CIRURGIA
  const daxCirurgia = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[NR_CIRURGIA],
        "Qtd_Registros", COUNTROWS(OPME),
        "Qtd_Materiais", DISTINCTCOUNT('OPME'[CD_MATERIAL])
    )
  `;

  const cirReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxCirurgia }] })
    }
  );

  const cirRows = cirReq.body.results[0].tables[0].rows;
  console.log("=== NR_CIRURGIA na tabela OPME ===");
  console.log("Total de NR_CIRURGIA distintos: " + cirRows.length);
  console.log("\nTop 20 por quantidade de registros:");
  cirRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).slice(0, 20).forEach(r => {
    console.log("  NR=" + r["OPME[NR_CIRURGIA]"] + " | Registros=" + r["[Qtd_Registros]"] + " | Materiais=" + r["[Qtd_Materiais]"]);
  });

  // Verificar se existe uma tabela separada de "Pedidos Mat. Cirurgias"
  // ou se há outra tabela com NR_CIRURGIA como dimensão
  // Vamos listar todas as tabelas do dataset
  const daxTabelas = `
    EVALUATE
    VAR Tabelas = INFO.STORAGETABLES()
    RETURN
    SELECTCOLUMNS(
        Tabelas,
        "Table", [Table],
        "Rows", [Rows],
        "Partitions", [Partitions]
    )
  `;

  const tabReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxTabelas }] })
    }
  );

  console.log("\n=== TABELAS NO DATASET ===");
  if (tabReq.body.results && tabReq.body.results[0]) {
    const tabRows = tabReq.body.results[0].tables[0].rows;
    tabRows.forEach(r => {
      console.log("  " + r["Table"] + " | Rows=" + r["Rows"] + " | Partitions=" + r["Partitions"]);
    });
  } else {
    console.log("Não foi possível listar as tabelas. Resposta: " + JSON.stringify(tabReq.body).substring(0, 500));
  }

  // Tentar buscar NR_CIRURGIA em outras tabelas conhecidas
  const tabelasPossiveis = ['OPME', 'SALDO_ESTOQUE', 'PEDIDOS', 'CIRURGIAS', 'PEDIDOS_MAT_CIRURGIAS', 'CONSUMO'];
  console.log("\n=== Buscando NR_CIRURGIA em outras tabelas ===");
  for (const tab of tabelasPossiveis) {
    const dax = `
      EVALUATE
      SELECTCOLUMNS(
          ${tab},
          "NR_CIRURGIA", ${tab}[NR_CIRURGIA]
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
    if (r.body.results && r.body.results[0] && r.body.results[0].tables[0].rows.length > 0) {
      console.log("  ✅ " + tab + " - tem NR_CIRURGIA (" + r.body.results[0].tables[0].rows.length + " linhas)");
    } else {
      console.log("  ❌ " + tab + " - NÃO tem NR_CIRURGIA ou não existe");
    }
  }

})();
