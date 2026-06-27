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

  const daxAll = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'SALDO_ESTOQUE'[CD_MATERIAL],
        'SALDO_ESTOQUE'[CD_FORNEC_CONSIGNADO],
        "Saldo", SUM('SALDO_ESTOQUE'[SALDO]),
        "Qtd", COUNTROWS(SALDO_ESTOQUE)
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

  // Agregar por material
  const materiais = {};
  rows.forEach(r => {
    const cd = r["SALDO_ESTOQUE[CD_MATERIAL]"];
    const forn = r["SALDO_ESTOQUE[CD_FORNEC_CONSIGNADO]"];
    const sld = parseFloat(r["[Saldo]"]) || 0;

    if (!materiais[cd]) materiais[cd] = { fornecedores: [], saldoTotal: 0 };
    materiais[cd].fornecedores.push({ cnpj: forn, saldo: sld });
    materiais[cd].saldoTotal += sld;
  });

  console.log("=== VISÃO GERAL ===");
  console.log("Total de combinações (Material x Fornecedor): " + rows.length);
  console.log("Total de materiais únicos: " + Object.keys(materiais).length);

  // Classificar
  let todosComSaldo = 0;
  let algunsComSaldo = 0;
  let todosZerados = 0;
  let umFornComSaldo = 0;
  let umFornZerado = 0;

  const exemplosAlguns = [];
  const exemplosTodosComSaldo = [];

  Object.entries(materiais).forEach(([cd, info]) => {
    const qtdForn = info.fornecedores.length;
    const comSaldo = info.fornecedores.filter(f => f.saldo > 0).length;
    const zerados = info.fornecedores.filter(f => f.saldo === 0).length;

    if (qtdForn === 1 && comSaldo === 1) umFornComSaldo++;
    else if (qtdForn === 1 && zerados === 1) umFornZerado++;
    else if (qtdForn > 1 && comSaldo === qtdForn) {
      todosComSaldo++;
      if (exemplosTodosComSaldo.length < 5) {
        exemplosTodosComSaldo.push({ cd, ...info });
      }
    }
    else if (qtdForn > 1 && comSaldo > 0 && zerados > 0) {
      algunsComSaldo++;
      if (exemplosAlguns.length < 15) {
        exemplosAlguns.push({ cd, ...info });
      }
    }
    else if (qtdForn > 1 && comSaldo === 0) todosZerados++;
  });

  console.log("\n=== CLASSIFICAÇÃO DOS MATERIAIS ===");
  console.log("1 fornecedor com saldo > 0: " + umFornComSaldo);
  console.log("1 fornecedor saldo = 0: " + umFornZerado);
  console.log("Multi fornecedores, TODOS com saldo > 0: " + todosComSaldo);
  console.log("Multi fornecedores, ALGUNS com saldo + alguns zerados: " + algunsComSaldo + "  <-- SEU CASO");
  console.log("Multi fornecedores, TODOS zerados: " + todosZerados);

  // Estatísticas
  const totalFns = Object.values(materiais).reduce((acc, m) => acc + m.fornecedores.length, 0);
  const avgFns = (totalFns / Object.keys(materiais).length).toFixed(2);
  const maxFns = Math.max(...Object.values(materiais).map(m => m.fornecedores.length));
  const distFns = {};
  Object.values(materiais).forEach(m => {
    const q = m.fornecedores.length;
    distFns[q] = (distFns[q] || 0) + 1;
  });

  console.log("\n=== DISTRIBUIÇÃO DE FORNECEDORES POR MATERIAL ===");
  console.log("Média de fornecedores por material: " + avgFns);
  console.log("Máximo de fornecedores para 1 material: " + maxFns);
  Object.entries(distFns).sort((a,b) => parseInt(a[0]) - parseInt(b[0])).forEach(([q, count]) => {
    const pct = ((count / Object.keys(materiais).length) * 100).toFixed(1);
    console.log("  " + q + " fornecedor(es): " + count + " materiais (" + pct + "%)");
  });

  console.log("\n=== EXEMPLOS: Multi-fornecedor com mix (alguns saldo, alguns zerado) ===");
  exemplosAlguns.forEach(e => {
    console.log("\n  CD=" + e.cd + " | Total=" + e.saldoTotal);
    e.fornecedores.forEach(f => {
      console.log("    Forn: " + f.cnpj + " | Saldo: " + f.saldo);
    });
  });

  console.log("\n=== EXEMPLOS: Multi-fornecedor, TODOS com saldo ===");
  exemplosTodosComSaldo.forEach(e => {
    console.log("\n  CD=" + e.cd + " | Total=" + e.saldoTotal);
    e.fornecedores.forEach(f => {
      console.log("    Forn: " + f.cnpj + " | Saldo: " + f.saldo);
    });
  });

  // Análise do padrão: nos casos "alguns com saldo + zerados", quantos fornecedores com saldo?
  console.log("\n=== ANÁLISE DO PADRÃO 'ALGUNS COM SALDO' ===");
  const distComSaldo = {};
  exemplosAlguns.forEach(e => {
    const comSaldo = e.fornecedores.filter(f => f.saldo > 0).length;
    distComSaldo[comSaldo] = (distComSaldo[comSaldo] || 0) + 1;
  });
  console.log("Nos exemplos, quantos fornecedores têm saldo > 0 por material:");
  Object.entries(distComSaldo).sort((a,b) => parseInt(a[0]) - parseInt(b[0])).forEach(([q, count]) => {
    console.log("  " + q + " fornecedor(es) com saldo: " + count + " materiais");
  });

})();
