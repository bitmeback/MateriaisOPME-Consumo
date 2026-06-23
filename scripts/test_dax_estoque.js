const https = require('https');

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

(async () => {
  const baseUrl = 'https://donahelena.reportload.com';
  const workspaceId = '0a4c534a-f8ef-4b3f-a842-4982c842b41c';
  const datasetId = '70a003f4-30ff-49a2-8991-deba110f7455';
  
  const loginRes = await makeRequest(baseUrl + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'compras4@donahelena.com.br', password: '@D3z3mbr0%', language: 'pt-BR' })
  });
  
  const reportViewRes = await makeRequest(baseUrl + '/api/auth/report_view/report-view?id=c498464e-67a3-43f0-8c22-2dbb5efe1048', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + loginRes.body.token, 'Content-Type': 'application/json' }
  });
  const embeddedToken = reportViewRes.body?.token?.token;

  // Analisando a tabela de estoque
  const daxQuery = `
    EVALUATE 
    TOPN(5, 'SALDO_ESTOQUE')
  `;

  const queryRes = await makeRequest(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + embeddedToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ queries: [{ query: daxQuery }] })
  });
  
  if (queryRes.status !== 200) {
      console.log('Error DAX:', JSON.stringify(queryRes.body, null, 2).substring(0, 1000));
  } else {
      const rows = queryRes.body.results[0].tables[0].rows;
      console.log('Estrutura Tabela SALDO_ESTOQUE:\n', JSON.stringify(rows[0], null, 2));
  }
})();
