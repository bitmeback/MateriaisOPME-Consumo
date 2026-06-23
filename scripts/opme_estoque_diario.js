#!/usr/bin/env node
const https = require('https');
const mysql = require('mysql2/promise');

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = ''; res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject); if (options.body) req.write(options.body); req.end();
  });
}

(async () => {
  const baseUrl = 'https://donahelena.reportload.com';
  const workspaceId = '0a4c534a-f8ef-4b3f-a842-4982c842b41c';
  const datasetId = '70a003f4-30ff-49a2-8991-deba110f7455';
  
  try {
    console.log('[ESTOQUE] INICIANDO INGESTÃO DO SALDO DA MANHÃ');

    const loginRes = await makeRequest(baseUrl + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'compras4@donahelena.com.br', password: '@D3z3mbr0%', language: 'pt-BR' })
    });
    const reportViewRes = await makeRequest(baseUrl + '/api/auth/report_view/report-view?id=c498464e-67a3-43f0-8c22-2dbb5efe1048', {
      method: 'GET', headers: { 'Authorization': 'Bearer ' + loginRes.body.token, 'Content-Type': 'application/json' }
    });
    const embeddedToken = reportViewRes.body?.token?.token;

    const connection = await mysql.createConnection({
        socketPath: '/var/run/mysqld/mysqld.sock', user: 'root', password: 'QbbRkK7bKiGFMRCWggiLgaiu', database: 'materiais_opme'
    });

    const daxQuery = `
      EVALUATE 
      SUMMARIZECOLUMNS(
          'SALDO_ESTOQUE'[CD_MATERIAL],
          'SALDO_ESTOQUE'[CD_FORNEC_CONSIGNADO],
          'SALDO_ESTOQUE'[CHAVE_SALDO],
          "saldo", SUM('SALDO_ESTOQUE'[SALDO])
      )
    `;

    const queryRes = await makeRequest(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + embeddedToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxQuery }] })
    });

    const rows = queryRes.body?.results?.[0]?.tables?.[0]?.rows || [];

    if (rows.length > 0) {
        await connection.execute('TRUNCATE TABLE saldo_estoque_atual');

        const valuesArray = [];
        const agora = new Date().toISOString().replace('T', ' ').substring(0, 19);

        for (const r of rows) {
            const cdMat = r['SALDO_ESTOQUE[CD_MATERIAL]'] || null;
            const cdForn = r['SALDO_ESTOQUE[CD_FORNEC_CONSIGNADO]'] || null;
            const chave = r['SALDO_ESTOQUE[CHAVE_SALDO]'] || null;
            const sld = r['[saldo]'] !== undefined ? r['[saldo]'] : 0; 
            
            if(chave) valuesArray.push([cdMat, cdForn, chave, sld, agora]);
        }
        
        console.log(`[DB] Espelhando ${valuesArray.length} saldos locais...`);
        const chunkSize = 2000;
        for (let i = 0; i < valuesArray.length; i += chunkSize) {
            await connection.query(
                'INSERT INTO saldo_estoque_atual (cd_material, cd_fornec_consignado, chave_saldo, saldo, data_extracao) VALUES ?', 
                [valuesArray.slice(i, i + chunkSize)]
            );
        }
        
        console.log('[SUCESSO] Sincronização do Inventário finalizada.');
    } else {
        console.log('[AVISO] Dataset de Estoque retornou vazio.');
    }
    
    await connection.end();
  } catch (err) { console.error('[ERRO]:', err.message); }
})();
