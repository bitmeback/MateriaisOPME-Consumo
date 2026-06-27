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

  // Tentar várias colunas que podem ter especialidade
  const possiveisCampos = [
    'DS_CONVENIO',
    'DS_SETOR',
    'DS_CIRURGIA',
    'DS_ESPECIALIDADE',
    'DS_TIPO_CIRURGIA',
    'DS_PROCEDIMENTO',
    'DS_GRUPO',
    'DS_SUB_GRUPO',
    'NR_CIRURGIA',
    'NR_ATENDIMENTO',
    'DS_TIPO',
    'DS_CATEGORIA',
    'DS_FAMILIA',
    'DS_GRUPO_MATERIAL',
    'DS_SUBGRUPO',
    'CD_GRUPO',
    'CD_SUB_GRUPO',
    'CD_FAMILIA',
    'CD_CATEGORIA',
    'CD_TIPO',
    'CD_PROCEDIMENTO',
    'CD_ESPECIALIDADE',
    'CD_CIRURGIA'
  ];

  // Testar DS_CIRURGIA com erro específico
  const daxTest = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[DS_CONVENIO],
        'OPME'[DS_SETOR],
        "Qtd", COUNTROWS(OPME)
    )
  `;

  const testReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxTest }] })
    }
  );

  const testRows = testReq.body.results[0].tables[0].rows;
  console.log("=== DS_CONVENIO x DS_SETOR (para ver relação com especialidade) ===");
  console.log("Total combinações: " + testRows.length);
  testRows.forEach(r => {
    console.log("  " + r["OPME[DS_CONVENIO]"].substring(0, 25) + " | " + r["OPME[DS_SETOR]"].substring(0, 30) + " | " + r["[Qtd]"]);
  });

  // Verificar se DS_CONVENIO contém especialidades (ex: "Ortopedia")
  console.log("\n=== Buscando 'orto' nos convênios ===");
  const daxOrto = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[DS_CONVENIO],
            "Qtd", COUNTROWS(OPME)
        ),
        CONTAINSSTRING('OPME'[DS_CONVENIO], "orto")
    )
  `;

  const ortoReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxOrto }] })
    }
  );

  if (ortoReq.body.results && ortoReq.body.results[0]) {
    const ortoRows = ortoReq.body.results[0].tables[0].rows;
    console.log("Total: " + ortoRows.length);
    ortoRows.forEach(r => {
      console.log("  " + r["OPME[DS_CONVENIO]"] + " | " + r["[Qtd]"]);
    });
  } else {
    console.log("Nenhum resultado para 'orto' nos convênios");
  }

  // Buscar ortopedia nos setores
  console.log("\n=== Buscando 'orto' nos setores ===");
  const daxOrtoSetor = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[DS_SETOR],
            "Qtd", COUNTROWS(OPME)
        ),
        CONTAINSSTRING('OPME'[DS_SETOR], "orto")
    )
  `;

  const ortoSetReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxOrtoSetor }] })
    }
  );

  if (ortoSetReq.body.results && ortoSetReq.body.results[0]) {
    const ortoSetRows = ortoSetReq.body.results[0].tables[0].rows;
    console.log("Total: " + ortoSetRows.length);
    ortoSetRows.forEach(r => {
      console.log("  " + r["OPME[DS_SETOR]"] + " | " + r["[Qtd]"]);
    });
  } else {
    console.log("Nenhum resultado para 'orto' nos setores");
  }

})();
