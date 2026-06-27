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

  // Usar CONTAINSSTRING para filtrar ortopedia
  const daxOrtopedia = `
    EVALUATE
    CALCULATETABLE(
        SUMMARIZECOLUMNS(
            'OPME'[CD_FORNEC_CONSIGNADO],
            'OPME'[DS_FORNECEDOR],
            "Qtd_Registros", COUNTROWS(OPME),
            "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
        ),
        CONTAINSSTRING('OPME'[ESPECIALIDADE], "ortopedia")
    )
  `;

  const ortoReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxOrtopedia }] })
    }
  );

  const ortoRows = ortoReq.body.results[0].tables[0].rows;
  console.log("=== FORNECEDORES EM ORTOPEDIA (CONTAINSSTRING) ===");
  console.log("Total: " + ortoRows.length);
  console.log("\nCD_FORNEC | DS_FORNECEDOR | Qtd_Registros | Qtd_Cirurgias");
  ortoRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).forEach(r => {
    const ds = r["OPME[DS_FORNECEDOR]"] || "(vazio)";
    console.log(r["OPME[CD_FORNEC_CONSIGNADO]"] + " | " + ds.substring(0, 45) + " | " + r["[Qtd_Registros]"] + " | " + r["[Qtd_Cirurgias]"]);
  });

  // Agora: para cada fornecedor de ortopedia, ver em quais outras especialidades ele aparece
  if (ortoRows.length > 0) {
    const ortoFornCds = ortoRows.map(r => r["OPME[CD_FORNEC_CONSIGNADO]"]);
    const cdList = ortoFornCds.map(c => "'" + c + "'").join(",");

    const daxOutrasEsp = `
      EVALUATE
      CALCULATETABLE(
          SUMMARIZECOLUMNS(
              'OPME'[CD_FORNEC_CONSIGNADO],
              'OPME'[ESPECIALIDADE],
              "Qtd_Registros", COUNTROWS(OPME)
          ),
          'OPME'[CD_FORNEC_CONSIGNADO] IN (${cdList}),
          NOT(CONTAINSSTRING('OPME'[ESPECIALIDADE], "ortopedia"))
      )
    `;

    const outrasReq = await req(
      'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: [{ query: daxOutrasEsp }] })
      }
    );

    const outrasRows = outrasReq.body.results[0].tables[0].rows;
    console.log("\n=== OUTRAS ESPECIALIDADES DOS FORNECEDORES DE ORTOPEDIA ===");
    console.log("Total de combinações (fornecedor × outra especialidade): " + outrasRows.length);
    outrasRows.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).slice(0, 20).forEach(r => {
      const ds = r["OPME[DS_FORNECEDOR]"] || "(vazio)";
      console.log("  " + r["OPME[CD_FORNEC_CONSIGNADO]"] + " | " + r["OPME[ESPECIALIDADE]"].substring(0, 40) + " | " + r["[Qtd_Registros]"]);
    });
  }

  // Também: fornecedores com nome sugestivo de ortopedia mas que NÃO aparecem no filtro
  console.log("\n=== FORNECEDORES COM NOME SUGESTIVO DE ORTOPEDIA (busca manual) ===");
  const daxTodosForn = `
    EVALUATE
    SUMMARIZECOLUMNS(
        'OPME'[CD_FORNEC_CONSIGNADO],
        'OPME'[DS_FORNECEDOR],
        "Qtd_Registros", COUNTROWS(OPME),
        "Qtd_Cirurgias", DISTINCTCOUNT('OPME'[NR_CIRURGIA])
    )
  `;

  const todosReq = await req(
    'https://api.powerbi.com/v1.0/myorg/groups/' + WS + '/datasets/' + DATASET + '/executeQueries',
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + myToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxTodosForn }] })
    }
  );

  const todosRows = todosReq.body.results[0].tables[0].rows;
  const palavrasOrtopedia = ['orto', 'ortopedia', 'traumat', 'ortho', 'implante', 'prótese', 'protese', 'spine', 'coluna', 'osso', 'joint', 'implantcast', 'traumafix', 'ortoforte', 'ortoface', 'orthoprime', 'ortholine', 'ortomedic', 'ortoquality', 'ortospine', 'osteos'];
  
  const fornSugeridos = todosRows.filter(r => {
    const ds = (r["OPME[DS_FORNECEDOR]"] || "").toLowerCase();
    return palavrasOrtopedia.some(p => ds.includes(p));
  });

  console.log("Total: " + fornSugeridos.length);
  fornSugeridos.sort((a,b) => b["[Qtd_Registros]"] - a["[Qtd_Registros]"]).forEach(r => {
    const ds = r["OPME[DS_FORNECEDOR]"] || "(vazio)";
    console.log("  " + r["OPME[CD_FORNEC_CONSIGNADO]"] + " | " + ds.substring(0, 50) + " | " + r["[Qtd_Registros]"]);
  });

})();
