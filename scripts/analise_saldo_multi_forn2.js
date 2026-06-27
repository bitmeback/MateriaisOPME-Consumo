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

  // Query simples: trazer todas as linhas do SALDO_ESTOQUE (material + fornecedor + saldo)
  const daxAll = `
    EVALUATE
    SELECTCOLUMNS(
        SALDO_ESTOQUE,
        "CD_MATERIAL", SALDO_ESTOQUE[CD_MATERIAL],
        "CD_FORNEC", SALDO_ESTOQUE[CD_FORNEC_CONSIGNADO],
        "SALDO", SALDO_ESTOQUE[SALDO]
    )
  `;

  const allReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxAll }] })
    }
  );

  const rows = allReq.body.results[0].tables[0].rows;
  console.log("Total de linhas no SALDO_ESTOQUE: " + rows.length);

  // Agregar por material
  const materiais = {};
  rows.forEach(r => {
    const cd = r["CD_MATERIAL"];
    const forn = r["CD_FORNEC"];
    const sld = parseFloat(r["SALDO"]) || 0;

    if (!materiais[cd]) materiais[cd] = { fornecedores: [], saldoTotal: 0 };
    materiais[cd].fornecedores.push({ cnpj: forn, saldo: sld });
    materiais[cd].saldoTotal += sld;
  });

  console.log("Total de materiais únicos: " + Object.keys(materiais).length);

  // Classificar
  let todosComSaldo = 0;
  let algunsComSaldo = 0;  // o caso que você descreveu
  let todosZerados = 0;
  let umFornComSaldo = 0;
  let umFornZerado = 0;

  const exemplosAlguns = [];

  Object.entries(materiais).forEach(([cd, info]) => {
    const qtdForn = info.fornecedores.length;
    const comSaldo = info.fornecedores.filter(f => f.saldo > 0).length;
    const zerados = info.fornecedores.filter(f => f.saldo === 0).length;

    if (qtdForn === 1 && comSaldo === 1) umFornComSaldo++;
    else if (qtdForn === 1 && zerados === 1) umFornZerado++;
    else if (qtdForn > 1 && comSaldo === qtdForn) todosComSaldo++;
    else if (qtdForn > 1 && comSaldo > 0 && zerados > 0) {
      algunsComSaldo++;
      if (exemplosAlguns.length < 15) {
        exemplosAlguns.push({ cd, ...info });
      }
    }
    else if (qtdForn > 1 && comSaldo === 0) todosZerados++;
  });

  console.log("\n=== CLASSIFICAÇÃO ===");
  console.log("1 fornecedor com saldo > 0: " + umFornComSaldo);
  console.log("1 fornecedor saldo = 0: " + umFornZerado);
  console.log("Multi fornecedores, TODOS com saldo > 0: " + todosComSaldo);
  console.log("Multi fornecedores, ALGUNS com saldo + zerados: " + algunsComSaldo);
  console.log("Multi fornecedores, TODOS zerados: " + todosZerados);

  console.log("\n=== EXEMPLOS: Multi-fornecedor com mix (alguns saldo, alguns zerado) ===");
  exemplosAlguns.forEach(e => {
    console.log("\n  CD=" + e.cd + " | Total=" + e.saldoTotal);
    e.fornecedores.forEach(f => {
      console.log("    Forn: " + f.cnpj + " | Saldo: " + f.saldo);
    });
  });

  // Estatísticas gerais
  const totalFns = Object.values(materiais).reduce((acc, m) => acc + m.fornecedores.length, 0);
  const avgFns = (totalFns / Object.keys(materiais).length).toFixed(2);
  const maxFns = Math.max(...Object.values(materiais).map(m => m.fornecedores.length));
  const distFns = {};
  Object.values(materiais).forEach(m => {
    const q = m.fornecedores.length;
    distFns[q] = (distFns[q] || 0) + 1;
  });

  console.log("\n=== ESTATÍSTICAS ===");
  console.log("Média de fornecedores por material: " + avgFns);
  console.log("Máximo de fornecedores para 1 material: " + maxFns);
  console.log("Distribuição de qtd fornecedores por material:");
  Object.entries(distFns).sort((a,b) => parseInt(a[0]) - parseInt(b[0])).forEach(([q, count]) => {
    console.log("  " + q + " fornecedor(es): " + count + " materiais");
  });

})();
