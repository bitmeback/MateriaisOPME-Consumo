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

  // 1. SALDO DO MATERIAL 92323
  const daxSaldo = "EVALUATE CALCULATETABLE(SUMMARIZECOLUMNS('SALDO_ESTOQUE'[CD_MATERIAL], 'SALDO_ESTOQUE'[CD_FORNEC_CONSIGNADO], 'SALDO_ESTOQUE'[CHAVE_SALDO], \"Saldo\", SUM('SALDO_ESTOQUE'[SALDO])), 'SALDO_ESTOQUE'[CD_MATERIAL]=92323)";

  const saldoReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxSaldo }] })
    }
  );

  console.log("=== DADOS MATERIAL 92323 NO CUBO DAX ===");

  const saldos = saldoReq.body.results[0].tables[0].rows;
  if (saldos.length === 0) {
    console.log("Nenhum saldo encontrado");
  } else {
    let totalSaldo = 0;
    saldos.forEach((row, i) => {
      const forn = row["SALDO_ESTOQUE[CD_FORNEC_CONSIGNADO]"];
      const sld = row["[Saldo]"] ? parseFloat(row["[Saldo]"]) : 0;
      totalSaldo += sld;
      console.log("  " + (i+1) + ". Forn: " + forn + " | Saldo: " + sld);
    });
    console.log("\nTOTAL SALDO CUBO: " + totalSaldo);
  }

  // 2. DADOS OPME (FATO) DO MATERIAL 92323
  const daxFato = "EVALUATE CALCULATETABLE(TOPN(5, 'OPME'), 'OPME'[CD_MATERIAL]=92323)";

  const fatoReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxFato }] })
    }
  );

  const fatos = fatoReq.body.results[0].tables[0].rows;
  console.log("\n--- Fato OPME (5 registros mais recentes) ---");
  fatos.forEach((row, i) => {
    console.log("  " + (i+1) + ". " + row["OPME[DS_MATERIAL]"] + " | Forn: " + row["OPME[DS_FORNECEDOR]"] + " | Qt: " + row["OPME[QT_MATERIAL]"] + " | Sit: " + row["OPME[SITUACAO]"]);
  });

  // 3. BANCO LOCAL
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    socketPath: '/var/run/mysqld/mysqld.sock',
    user: 'root',
    password: 'QbbRkK7bKiGFMRCWggiLgaiu',
    database: 'materiais_opme'
  });

  const [saldoDb] = await conn.execute('SELECT * FROM saldo_estoque_atual WHERE cd_material = 92323');
  console.log("\n--- Banco local: saldo_estoque_atual WHERE cd_material=92323 ---");
  console.log("Registros: " + saldoDb.length);
  saldoDb.forEach(function(r) {
    console.log("  Forn: " + r.cd_fornec_consignado + " | Saldo: " + r.saldo + " | Extracao: " + r.data_extracao);
  });

  const [consumoDb] = await conn.execute('SELECT * FROM consumo_materiais WHERE codigo = 92323 ORDER BY ano DESC, mes DESC LIMIT 5');
  console.log("\n--- Banco local: consumo_materiais WHERE codigo=92323 TOP 5 ---");
  console.log("Registros: " + consumoDb.length);
  consumoDb.forEach(function(r) {
    console.log("  " + r.ano + "/" + r.mes + " | " + r.descricao.substring(0, 35) + " | Consumo: " + r.consumo + " | Saldo: " + r.saldo);
  });

  await conn.end();

  // 4. RESUMO
  let totCubo = 0;
  saldos.forEach(function(r) { totCaldo += parseFloat(r["[Saldo]"]) || 0; });
  let totDb = 0;
  saldoDb.forEach(function(r) { totDb += parseFloat(r.saldo) || 0; });
  console.log("\n========= RESUMO =========");
  console.log("Material: Avental Cirurgico Esteril Descartavel Tam. LGG - Pion G");
  console.log("CD_MATERIAL: 92323");
  console.log("Fornecedores no cubo DAX: " + saldos.length);
  console.log("Saldo total CUBO DAX: " + totCaldo);
  console.log("Saldo total BANCO LOCAL: " + totDb);
  console.log("Registros consumo no banco: " + consumoDb.length);
})();
