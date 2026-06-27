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

  // 1. Primeiro: listar todas as colunas da tabela OPME disponíveis
  const daxColumns = `
    EVALUATE
    SELECTCOLUMNS(
        INFO.STORAGECOLUMNS(),
        "Table", [Table],
        "Column", [Column],
        "DataType", [DataType],
        "IsKey", [IsKey]
    )
  `;

  // Vou tentar outra abordagem - buscar no modelo DAX as colunas disponíveis
  // Usando SELECTCOLUMNS com FILTER no nome da tabela
  const daxCols2 = `
    EVALUATE
    VAR TabelaOPME = SELECTCOLUMNS(OPME, "Dummy", 1)
    RETURN
    SUMMARIZECOLUMNS(
        'OPME'[DS_CONVENIO],
        "Qtd", COUNTROWS(OPME)
    )
  `;

  // Buscar convênios (geralmente ligados a especialidades)
  const daxConvenios = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[DS_CONVENIO],
        "Qtd_Registros", COUNTROWS(OPME)
    )
  `;

  const convReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxConvenios }] })
    }
  );

  const convRows = convReq.body.results[0].tables[0].rows;
  console.log("=== DS_CONVENIO (pode ter especialidade) ===");
  console.log("Total: " + convRows.length);
  convRows.forEach(r => {
    console.log("  " + r["OPME[DS_CONVENIO]"] + " | " + r["[Qtd_Registros]"]);
  });

  // Agora buscar DS_SETOR mais a fundo - ver se tem alguma outra coluna relacionada
  // Vamos olhar a tabela OPME inteira com colunas de dimensão
  const daxSituacao = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[SITUACAO],
        "Qtd", COUNTROWS(OPME)
    )
  `;

  const sitReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxSituacao }] })
    }
  );

  const sitRows = sitReq.body.results[0].tables[0].rows;
  console.log("\n=== SITUACAO ===");
  sitRows.forEach(r => {
    console.log("  " + r["OPME[SITUACAO]"] + " | " + r["[Qtd]"]);
  });

  // Verificar se existe algo relacionado a DS_CIRURGIA ou tipo de cirurgia
  const daxCirurgia = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[DS_CIRURGIA],
        "Qtd", COUNTROWS(OPME)
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
  console.log("\n=== DS_CIRURGIA ===");
  console.log("Total: " + cirRows.length);
  cirRows.slice(0, 20).forEach(r => {
    console.log("  " + r["OPME[DS_CIRURGIA]"] + " | " + r["[Qtd]"]);
  });

})();
