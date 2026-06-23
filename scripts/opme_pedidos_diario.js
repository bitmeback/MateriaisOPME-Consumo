#!/usr/bin/env node
const https = require('https');
const mysql = require('mysql2/promise');

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

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
          'OPME'[NR_ATENDIMENTO], 'OPME'[NR_CIRURGIA], 'OPME'[CD_MATERIAL], 'OPME'[DS_MATERIAL],
          'OPME'[QT_MATERIAL], 'OPME'[VL_MATERIAL_CONTA], 'OPME'[VL_ULTIMA_COMPRA], 'OPME'[VL_LUCRO_LIQ],
          'OPME'[VL_PROPORCIONAL_TX], 'OPME'[VL_IMPOSTO], 'OPME'[VL_ITEM_OC], 'OPME'[DS_SETOR_ATENDIMENTO], 
          'OPME'[DS_MOTIVO_BAIXA], 'OPME'[DS_CARATER], 'OPME'[DS_CONVENIO], 'OPME'[DS_FORNECEDOR], 
          'OPME'[IE_PACOTE], 'OPME'[SITUACAO], 'OPME'[DT_TERMINO], 'OPME'[DT_BAIXA], 
          'OPME'[NR_INTERNO_CONTA], 'OPME'[NR_NOTA_FISCAL_ENT_CONSIGNADO], 'OPME'[DS_MATERIAL_CONSIGNADO],
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
            const strCl = (val, mx) => val ? val.toString().trim().substring(0, mx) : null;
            const numCl = val => val || null;
            valuesArray.push([
                numCl(r['OPME[NR_ATENDIMENTO]']), numCl(r['OPME[NR_CIRURGIA]']), numCl(r['OPME[CD_MATERIAL]']),
                strCl(r['OPME[DS_MATERIAL]'], 255), null, numCl(r['OPME[QT_MATERIAL]']), numCl(r['OPME[VL_MATERIAL_CONTA]']),
                numCl(r['OPME[VL_ULTIMA_COMPRA]']), numCl(r['OPME[VL_LUCRO_LIQ]']), numCl(r['OPME[VL_PROPORCIONAL_TX]']),
                numCl(r['OPME[VL_IMPOSTO]']), numCl(r['OPME[VL_ITEM_OC]']), strCl(r['OPME[DS_SETOR_ATENDIMENTO]'], 150),
                strCl(r['OPME[DS_MOTIVO_BAIXA]'], 150), strCl(r['OPME[DS_CARATER]'], 150), strCl(r['OPME[DS_CONVENIO]'], 150),
                strCl(r['OPME[DS_FORNECEDOR]'], 255), strCl(r['OPME[IE_PACOTE]'], 10), strCl(r['OPME[SITUACAO]'], 150),
                numCl(r['OPME[DT_TERMINO]']), numCl(r['OPME[DT_BAIXA]']), numCl(r['OPME[NR_INTERNO_CONTA]']), 
                strCl(r['OPME[NR_NOTA_FISCAL_ENT_CONSIGNADO]'], 100), strCl(r['OPME[DS_MATERIAL_CONSIGNADO]'], 50),
                currentYear, currentMonth
            ]);
        }
        await connection.execute(`DELETE FROM pedidos_mat_cirurgias WHERE ano = ? AND mes = ?`, [currentYear, currentMonth]);
        const chunkSize = 2000;
        for (let i = 0; i < valuesArray.length; i += chunkSize) {
            await connection.query(`INSERT INTO pedidos_mat_cirurgias (nr_atendimento, nr_cirurgia, cd_material, ds_material, ds_pendencias, qtde, vl_conta, vl_ultima_compra, vl_lucro_liq, vl_taxa_prop, vl_imposto, vl_oc, ds_setor_atendimento, ds_motivo_baixa, ds_carater, ds_convenio, ds_fornecedor, ie_pacote, situacao, dt_termino, dt_baixa, nr_interno_conta, nr_nf_ent_consignado, tipo, ano, mes) VALUES ?`, [valuesArray.slice(i, i + chunkSize)]);
        }
    }
    await connection.end();
  } catch (err) { console.error('[ERRO]:', err.message); }
})();
