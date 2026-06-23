#!/usr/bin/env node
const https = require('https');
const mysql = require('mysql2/promise');

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

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
  
  try {
    console.log(`[DIARIO] INICIANDO INGESTÃO DO ANALÍTICO: ${currentMonth}/${currentYear}`);

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

    const connection = await mysql.createConnection({
        socketPath: '/var/run/mysqld/mysqld.sock', user: 'root', password: 'QbbRkK7bKiGFMRCWggiLgaiu', database: 'materiais_opme'
    });

    const daxQuery = `
      EVALUATE 
      SUMMARIZECOLUMNS(
          'OPME'[NR_ATENDIMENTO], 'OPME'[NR_CIRURGIA], 'OPME'[CD_MATERIAL], 'OPME'[DS_MATERIAL],
          'OPME'[QT_MATERIAL], 'OPME'[VL_MATERIAL_CONTA], 'OPME'[VL_ULTIMA_COMPRA], 'OPME'[VL_LUCRO_LIQ],
          'OPME'[DS_FORNECEDOR], 'OPME'[SITUACAO], 'OPME'[DT_TERMINO], 'OPME'[DT_BAIXA],
          'OPME'[DS_CONVENIO], 'OPME'[DS_SETOR],
          FILTER('OPME', YEAR('OPME'[DT_TERMINO]) = ${currentYear} && MONTH('OPME'[DT_TERMINO]) = ${currentMonth})
      )
    `;

    const queryRes = await makeRequest(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + embeddedToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxQuery }] })
    });

    const rows = queryRes.body?.results?.[0]?.tables?.[0]?.rows || [];
    if (rows.length > 0) {
        const valuesArray = [];
        for (const r of rows) {
            const nr_aten = r['OPME[NR_ATENDIMENTO]'] || null; const nr_cirur = r['OPME[NR_CIRURGIA]'] || null;
            const cd_mat = r['OPME[CD_MATERIAL]'] || null; const qtde = r['OPME[QT_MATERIAL]'] || null;
            const ds_mat = r['OPME[DS_MATERIAL]'] ? r['OPME[DS_MATERIAL]'].toString().trim().substring(0, 255) : null;
            const forn = r['OPME[DS_FORNECEDOR]'] ? r['OPME[DS_FORNECEDOR]'].toString().trim().substring(0, 255) : null;
            const situ = r['OPME[SITUACAO]'] ? r['OPME[SITUACAO]'].toString().trim().substring(0, 100) : null;
            const conv = r['OPME[DS_CONVENIO]'] ? r['OPME[DS_CONVENIO]'].toString().trim().substring(0, 100) : null;
            const srt = r['OPME[DS_SETOR]'] ? r['OPME[DS_SETOR]'].toString().trim().substring(0, 100) : null;
            valuesArray.push([nr_aten, nr_cirur, cd_mat, ds_mat, qtde, r['OPME[VL_MATERIAL_CONTA]'] || null, r['OPME[VL_ULTIMA_COMPRA]'] || null, r['OPME[VL_LUCRO_LIQ]'] || null, forn, situ, r['OPME[DT_TERMINO]'] || null, r['OPME[DT_BAIXA]'] || null, conv, srt, currentYear, currentMonth]);
        }

        await connection.execute(`DELETE FROM consumo_analitico WHERE ano = ? AND mes = ?`, [currentYear, currentMonth]);
        const chunkSize = 2000;
        for (let i = 0; i < valuesArray.length; i += chunkSize) {
            await connection.query(`INSERT INTO consumo_analitico (nr_atendimento, nr_cirurgia, cd_material, ds_material, qtde, vl_conta, vl_ultima_compra, vl_lucro_liq, ds_fornecedor, situacao, dt_termino, dt_baixa, ds_convenio, ds_setor, ano, mes) VALUES ?`, [valuesArray.slice(i, i + chunkSize)]);
        }
        console.log(`[DB] Atualização diária com ${rows.length} registros Concluída.`);
    }

    await connection.end();
  } catch (err) { console.error('[ERRO]:', err.message); }
})();
