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

  // Listar tabelas usando INFO.VISUALCOLUMNS ou abordagem alternativa
  // Tentar SELECTCOLUMNS com uma tabela que pode existir
  const tabelasTeste = [
    'OPME',
    'SALDO_ESTOQUE',
    'PEDIDOS_MAT_CIRURGIA',
    'PEDIDOS_MATERIAIS',
    'PEDIDOS_CIRURGIA',
    'CIRURGIA',
    'CIRURGIAS',
    'PEDIDOS',
    'CONSUMO',
    'MATERIAIS',
    'FORNECEDORES',
    'SETORES',
    'CONVENIOS',
    'TABELA_PRECO',
    'TABELA_PRECOS',
    'PACIENTES',
    'PROFISSIONAIS',
    'ESPECIALIDADES',
    'TIPOS_CIRURGIA',
    'GRUPO_CIRURGIA',
    'SUBGRUPO_CIRURGIA',
    'NR_CIRURGIA',
    'PEDIDO',
    'ITEM_PEDIDO',
    'ITENS_PEDIDO',
    'ITENS_CIRURGIA',
    'CONTA',
    'CONTAS',
    'FATURAMENTO',
    'OC',
    'ORDEN_COMPRA',
    'NOTA_FISCAL',
    'NF'
  ];

  console.log("=== Testando existência de tabelas ===");
  for (const tab of tabelasTeste) {
    const dax = `EVALUATE SELECTCOLUMNS(${tab}, "Test", 1)`;
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
      console.log("  ✅ " + tab + " (" + rows.length + " linhas)");
    } else {
      // Verificar se o erro é "table not found"
      const err = r.body.error || {};
      if (err.code) {
        // console.log("  ❌ " + tab + " - não existe");
      }
    }
  }

})();
