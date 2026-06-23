#!/usr/bin/env node

const https = require('https');
const mysql = require('mysql2/promise');

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;
const startYear = 2024;
const startMonth = 1;

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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  const baseUrl = 'https://donahelena.reportload.com';
  const workspaceId = '0a4c534a-f8ef-4b3f-a842-4982c842b41c';
  const datasetId = '70a003f4-30ff-49a2-8991-deba110f7455';
  
  try {
    console.log('[MIGRACAO] INICIANDO MIGRAÇÃO DO ANALÍTICO: Jan/2024 até', currentMonth + '/' + currentYear);

    // 1. Obtendo o Token Global
    console.log('[API] Autenticando (Laiz) no ReportLoad...');
    const loginRes = await makeRequest(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'compras4@donahelena.com.br', password: '@D3z3mbr0%', language: 'pt-BR' })
    });
    
    if (loginRes.status !== 200 || !loginRes.body.token) throw new Error('Falha no Login ReportLoad');
    
    console.log('[API] Obtendo Embedded Token (OPME)...');
    const reportViewRes = await makeRequest(baseUrl + '/api/auth/report_view/report-view?id=c498464e-67a3-43f0-8c22-2dbb5efe1048', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + loginRes.body.token, 'Content-Type': 'application/json' }
    });
    const embeddedToken = reportViewRes.body?.token?.token;
    if (!embeddedToken) throw new Error('Falha no Embedded Token');

    // 2. Conectando no MariaDB
    console.log('[DB] Conectando MySQL...');
    const connection = await mysql.createConnection({
        socketPath: '/var/run/mysqld/mysqld.sock',
        user: 'root',
        password: 'QbbRkK7bKiGFMRCWggiLgaiu',
        database: 'materiais_opme'
    });

    let limitadorAtingido = false;

    // 3. O Grande Loop Histórico (por DT_TERMINO - a data da cirurgia do paciente)
    for (let loopYear = startYear; loopYear <= currentYear; loopYear++) {
        const mesFinalScope = (loopYear === currentYear) ? currentMonth : 12;

        for (let loopMonth = 1; loopMonth <= mesFinalScope; loopMonth++) {
            
            console.log(`\n============================`);
            console.log(`[DAX] Solicitando carga de: MÊS ${loopMonth} | ANO ${loopYear}`);

            // Usamos DT_TERMINO porque é a de origem do "Analítico" e sempre há. 
            // A DT_BAIXA pode ser nula em casos "Não Baixados".
            const daxQuery = `
              EVALUATE 
              SUMMARIZECOLUMNS(
                  'OPME'[NR_ATENDIMENTO],
                  'OPME'[NR_CIRURGIA],
                  'OPME'[CD_MATERIAL],
                  'OPME'[DS_MATERIAL],
                  'OPME'[QT_MATERIAL],
                  'OPME'[VL_MATERIAL_CONTA],
                  'OPME'[VL_ULTIMA_COMPRA],
                  'OPME'[VL_LUCRO_LIQ],
                  'OPME'[DS_FORNECEDOR],
                  'OPME'[SITUACAO],
                  'OPME'[DT_TERMINO],
                  'OPME'[DT_BAIXA],
                  'OPME'[DS_CONVENIO],
                  'OPME'[DS_SETOR],
                  FILTER('OPME', YEAR('OPME'[DT_TERMINO]) = ${loopYear} && MONTH('OPME'[DT_TERMINO]) = ${loopMonth})
              )
            `;

            const queryRes = await makeRequest(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + embeddedToken, 'Content-Type': 'application/json' },
              body: JSON.stringify({ queries: [{ query: daxQuery }] })
            });

            if (queryRes.status !== 200) {
               console.error(`[ERRO] DAX travou no mês ${loopMonth}/${loopYear}. Status: ${queryRes.status}`);
               continue; // Pula sem quebrar
            }

            const rows = queryRes.body?.results?.[0]?.tables?.[0]?.rows || [];
            console.log(`[API] Retornou ${rows.length} registros no Lote.`);

            if (rows.length > 0) {
                // Monta INSERT array
                const valuesArray = [];
                for (const r of rows) {
                    const nr_aten = r['OPME[NR_ATENDIMENTO]'] || null;
                    const nr_cirur = r['OPME[NR_CIRURGIA]'] || null;
                    const cd_mat = r['OPME[CD_MATERIAL]'] || null;
                    const ds_mat = r['OPME[DS_MATERIAL]'] ? r['OPME[DS_MATERIAL]'].toString().trim().substring(0, 255) : null;
                    const qtde = r['OPME[QT_MATERIAL]'] || null;
                    const vl_c = r['OPME[VL_MATERIAL_CONTA]'] || null;
                    const vl_u = r['OPME[VL_ULTIMA_COMPRA]'] || null;
                    const vl_l = r['OPME[VL_LUCRO_LIQ]'] || null;
                    const forn = r['OPME[DS_FORNECEDOR]'] ? r['OPME[DS_FORNECEDOR]'].toString().trim().substring(0, 255) : null;
                    const situ = r['OPME[SITUACAO]'] ? r['OPME[SITUACAO]'].toString().trim().substring(0, 100) : null;
                    const dt_t = r['OPME[DT_TERMINO]'] || null;
                    const dt_b = r['OPME[DT_BAIXA]'] || null;
                    const conv = r['OPME[DS_CONVENIO]'] ? r['OPME[DS_CONVENIO]'].toString().trim().substring(0, 100) : null;
                    const srt = r['OPME[DS_SETOR]'] ? r['OPME[DS_SETOR]'].toString().trim().substring(0, 100) : null;

                    valuesArray.push([nr_aten, nr_cirur, cd_mat, ds_mat, qtde, vl_c, vl_u, vl_l, forn, situ, dt_t, dt_b, conv, srt, loopYear, loopMonth]);
                }

                // Delete preventivo do mês em caso do loop recomeçar (seguro).
                await connection.execute(`DELETE FROM consumo_analitico WHERE ano = ? AND mes = ?`, [loopYear, loopMonth]);
                
                // Insert do lote (inserimos de 5k em 5k só pra n estourar buffer do MariaDB)
                const chunkSize = 2000;
                for (let i = 0; i < valuesArray.length; i += chunkSize) {
                    const ch = valuesArray.slice(i, i + chunkSize);
                    await connection.query(
                        `INSERT INTO consumo_analitico (nr_atendimento, nr_cirurgia, cd_material, ds_material, qtde, vl_conta, vl_ultima_compra, vl_lucro_liq, ds_fornecedor, situacao, dt_termino, dt_baixa, ds_convenio, ds_setor, ano, mes) VALUES ?`,
                        [ch]
                    );
                }
                console.log(`[DB] Salvos com Sucesso.`);
            }

            // Timeout de respeito à API
            await delay(1200); 
        }
    }

    await connection.end();
    console.log('\n[CONCLUÍDO] MISTURA COM O BANCO FOI GERAL! MIGRAÇÃO FINALIZADA. 🎉');

  } catch (err) {
      console.error('[ERRO GERAL]:', err.message);
  }
})();
