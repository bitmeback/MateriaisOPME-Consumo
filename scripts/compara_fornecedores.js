const https = require('https');
function req(url, opt = {}) {
  return new Promise((resolve, reject) => {
    const httpReq = https.request(url, opt, (resp) => {
      let data = '';
      resp.on('data', chunk => data += chunk);
      resp.on('end', () => {
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

  try {
    // 1. Login no ReportLoad
    const loginReq = await req(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'compras4@donahelena.com.br',
        password: '@D3z3mbr0%',
        language: 'pt-BR'
      })
    });

    // 2. Obter Token Embedded
    const rvReq = await req(BASE + '/api/auth/report_view/report-view?id=c498464e-67a3-43f0-8c22-2dbb5efe1048', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + loginReq.body.token, 'Content-Type': 'application/json' }
    });

    const myToken = rvReq.body.token.token;

    // 3. Consultar tudos os fornecedores únicos do Cubo DAX
    const daxTodosForn = `
      EVALUATE
      SUMMARIZECOLUMNS(
          'OPME'[CD_FORNEC_CONSIGNADO],
          'OPME'[DS_FORNECEDOR]
      )
    `;

    const daxReq = await req(
      'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query: daxTodosForn }] })
      }
    );

    const daxRows = daxReq.body.results[0].tables[0].rows;
    
    // Mapear CNPJs do DAX (limpando qualquer caractere não numérico, mantendo string de 14 dígitos)
    const daxFornMap = {};
    daxRows.forEach(r => {
      const cnpjRaw = r["OPME[CD_FORNEC_CONSIGNADO]"];
      if (cnpjRaw) {
        const cnpj = cnpjRaw.toString().replace(/[^0-9]/g, '').padStart(14, '0');
        const nome = r["OPME[DS_FORNECEDOR]"] ? r["OPME[DS_FORNECEDOR]"].trim() : '(Sem Nome)';
        if (cnpj && cnpj.length === 14 && cnpj !== '00000000000000') {
          daxFornMap[cnpj] = nome;
        }
      }
    });

    // 4. Conectar no banco local para ver nossos fornecedores cadastrados
    const mysql = require('mysql2/promise');
    const conn = await mysql.createConnection({
      socketPath: '/var/run/mysqld/mysqld.sock',
      user: 'root',
      password: 'QbbRkK7bKiGFMRCWggiLgaiu',
      database: 'materiais_opme'
    });

    const [localRows] = await conn.execute('SELECT cnpj, name FROM fornecedores');
    const localCnpjs = new Set();
    localRows.forEach(r => {
      if (r.cnpj) localCnpjs.add(r.cnpj.replace(/[^0-9]/g, ''));
    });

    await conn.end();

    // 5. Comparar listas
    const daxCnpjs = Object.keys(daxFornMap);
    const faltantes = [];

    daxCnpjs.forEach(cnpj => {
      if (!localCnpjs.has(cnpj)) {
        faltantes.push({
          cnpj: cnpj,
          nome: daxFornMap[cnpj]
        });
      }
    });

    console.log("=== COMPARAÇÃO DE FORNECEDORES (DAX vs BANCO LOCAL) ===");
    console.log("Fornecedores únicos válidos no Cubo DAX: " + daxCnpjs.length);
    console.log("Fornecedores cadastrados no Banco Local: " + localCnpjs.size);
    console.log("\nFaltam entrar na base local: " + faltantes.length + " fornecedores");
    console.log("\n--- LISTA DOS FORNECEDORES FALTANTES (DAX que não estão no local) ---");
    
    faltantes.sort((a,b) => a.nome.localeCompare(b.nome)).forEach((f, idx) => {
      console.log((idx+1) + ". " + f.cnpj + " | " + f.nome);
    });

  } catch (err) {
    console.error("Erro na análise: " + err.message);
  }
})();
