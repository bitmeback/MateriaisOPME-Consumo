#!/usr/bin/env node
/**
 * OPME Consumo de Materiais - Ingestão Direta via API PowerBI
 * ==============================================================================
 * Acessa o ReportLoad via API (Autenticação Master) para extrair o token do Power BI.
 * Emite uma query DAX na API do Dataset pedindo o resultado do Mês e Ano definidos.
 * Em seguida, usa as credenciais de banco para inserir a carga em consumo_materiais.
 *
 * Exemplo uso Mês/Ano corrente:
 *   node opme_capture_api.js
 * Exemplo um mês passado:
 *   node opme_capture_api.js --year 2026 --month 5
 */

const https = require('https');
const mysql = require('mysql2/promise');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const argv = yargs(hideBin(process.argv))
  .option('year', { type: 'number', description: 'Ano de extração.' })
  .option('month', { type: 'number', description: 'Mês de extração.' })
  .argv;

const currentDate = new Date();
const targetYear = argv.year || currentDate.getFullYear();
const targetMonth = argv.month || (currentDate.getMonth() + 1);

console.log(`[INIT] Rodando Extração do mês ${targetMonth}/${targetYear} via Power BI/ReportLoad API...`);

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
    console.log('[API] Autenticando com credenciais da Laiz no ReportLoad...');
    const loginRes = await makeRequest(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'compras4@donahelena.com.br', password: '@D3z3mbr0%', language: 'pt-BR' })
    });
    
    if (loginRes.status !== 200 || !loginRes.body.token) throw new Error('Falha no Login.');

    console.log('[API] Solicitando Token Embedded do Report c498464e (OPME)...');
    const reportViewRes = await makeRequest(baseUrl + '/api/auth/report_view/report-view?id=c498464e-67a3-43f0-8c22-2dbb5efe1048', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + loginRes.body.token, 'Content-Type': 'application/json' }
    });
    const embeddedToken = reportViewRes.body?.token?.token;
    if (!embeddedToken) throw new Error('Falha obtendo Embedded Token.');

    console.log(`[API] Acionando ExecuteQueries PowerBI para Mês ${targetMonth} e Ano ${targetYear}...`);
    // Alterando o DAX para que a condição de MATCH seja mais flexivel devido aspas DAX.
    const daxQuery = `
      EVALUATE 
      SUMMARIZECOLUMNS(
          'OPME'[CD_MATERIAL],
          'OPME'[DS_MATERIAL],
          'OPME'[DS_FORNECEDOR],
          FILTER('OPME', YEAR('OPME'[DT_BAIXA]) = ${targetYear} && MONTH('OPME'[DT_BAIXA]) = ${targetMonth}),
          "Consumo", SUM('OPME'[QT_MATERIAL])
      )
    `;

    const queryRes = await makeRequest(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + embeddedToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ queries: [{ query: daxQuery }] })
    });

    if (queryRes.status !== 200) throw new Error('Falha na query DAX: ' + JSON.stringify(queryRes.body));
    
    const rows = queryRes.body.results[0].tables[0].rows;
    console.log(`[SUCESSO] ${rows.length} registros extraídos do Dataset.`);

    if (rows.length === 0) {
        console.log('[AVISO] Nenhum consumo encontrado no período reportado. Finalizando sem Ingestão.');
        process.exit(0);
    }

    console.log('[DB] Conectando no banco de dados materiais_opme (socket mysqld)...');
    const connection = await mysql.createConnection({
        socketPath: '/var/run/mysqld/mysqld.sock',
        user: 'root',
        password: 'QbbRkK7bKiGFMRCWggiLgaiu',
        database: 'materiais_opme'
    });

    const valuesArray = [];
    for (const r of rows) {
        const cod  = r['OPME[CD_MATERIAL]'] ? r['OPME[CD_MATERIAL]'].toString() : null;
        let desc = r['OPME[DS_MATERIAL]'] ? r['OPME[DS_MATERIAL]'].trim() : null;
        let forn = r['OPME[DS_FORNECEDOR]'] ? r['OPME[DS_FORNECEDOR]'].trim() : null;
        const cons = r['[Consumo]'] || 0;
        
        if(desc && desc.length > 255) desc = desc.substring(0, 255);
        if(forn && forn.length > 150) forn = forn.substring(0, 150);

        if (cod) {
           valuesArray.push([cod, desc, cons, null, forn, targetYear, targetMonth ]);
        }
    }

    if (valuesArray.length > 0) {
        console.log(`[DB] Excluindo a carga do ano ${targetYear} e mês ${targetMonth} vigente para recarga limpa...`);
        await connection.execute('DELETE FROM consumo_materiais WHERE ano = ? AND mes = ?', [targetYear, targetMonth]);
        
        console.log(`[DB] Inserindo ${valuesArray.length} registros na base 'consumo_materiais'...`);
        const queryInsert = 'INSERT INTO consumo_materiais (codigo, descricao, consumo, saldo, fornecedor, ano, mes) VALUES ?';
        const [result] = await connection.query(queryInsert, [valuesArray]);
        console.log(`[DB] Ingestão Concluída! Linhas afetadas: ${result.affectedRows}`);
    }

    await connection.end();
    console.log('[FINISH] Execução Finalizada!');
    
  } catch (err) {
      console.error('[ERRO] Falha fatal no fluxo:', err.message);
      process.exit(1);
  }
})();
