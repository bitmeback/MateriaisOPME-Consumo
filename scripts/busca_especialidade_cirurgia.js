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

  // Buscar colunas possíveis de especialidade na tabela OPME
  const possiveisCampos = [
    'DS_ESPECIALIDADE',
    'DS_ESPECIALIDADE_CIRURGIA',
    'DS_ESP',
    'ESPECIALIDADE',
    'DS_TIPO_CIRURGIA',
    'DS_TIPO',
    'DS_CATEGORIA_CIRURGIA',
    'DS_PROCEDIMENTO',
    'DS_CIRURGIA',
    'DS_GRUPO_CIRURGIA',
    'DS_GRUPO',
    'DS_SUB_GRUPO',
    'DS_FAMILIA_CIRURGIA',
    'CD_ESPECIALIDADE',
    'CD_CIRURGIA',
    'CD_TIPO_CIRURGIA',
    'CD_GRUPO_CIRURGIA',
    'CD_PROCEDIMENTO',
    'CD_CATEGORIA',
    'NR_CIRURGIA',
    'DS_PACIENTE',
    'DS_CONVENIO_CIRURGIA',
    'DS_SEGUIMENTO',
    'DS_POS_CIRURGIA',
    'DS_CUIDADO',
    'DS_ALTA',
    'TIPO_ATENDIMENTO',
    'DS_TIPO_ATENDIMENTO',
    'CD_TIPO_ATENDIMENTO',
    'DS_NATUREZA',
    'CD_NATUREZA',
    'DS_ORIGEM',
    'CD_ORIGEM'
  ];

  console.log("=== Buscando campos de especialidade/tipo na tabela OPME ===");
  for (const campo of possiveisCampos) {
    const dax = `EVALUATE SELECTCOLUMNS(OPME, "${campo}", OPME[${campo}])`;
    const r = await req(
      'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query: dax }] })
      }
    );
    if (r.body.results && r.body.results[0] && r.body.results[0].tables[0].rows.length > 0) {
      const rows = r.body.results[0].tables[0].rows;
      console.log("  ✅ OPME[" + campo + "] - existe! (" + rows.length + " valores distintos)");
      if (rows.length <= 30) {
        rows.forEach(r2 => {
          console.log("     " + r2["OPME[" + campo + "]"]);
        });
      } else {
        console.log("     (mais de 30 valores - mostrando 10):");
        rows.slice(0, 10).forEach(r2 => {
          console.log("     " + r2["OPME[" + campo + "]"]);
        });
      }
    }
  }

})();
