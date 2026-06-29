/**
 * opme_cadastro_materiais.js
 * Sincroniza o catálogo mestre de materiais (consumo_materiais_cadastro)
 * buscando CD_MATERIAL + DS_MATERIAL do DAX OPME via ReportLoad.
 * 
 * Roda a cada hora, 2 minutos após o opme-estoque-diario.
 * - INSERT se não existe
 * - UPDATE se a descrição mudou
 * - Não remove materiais que saíram do DAX (podem voltar)
 */

const https = require('https');
const mysql = require('mysql2/promise');

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
  try {
    const baseUrl = 'https://donahelena.reportload.com';
    const workspaceId = '0a4c534a-f8ef-4b3f-a842-4982c842b41c';
    const datasetId = '70a003f4-30ff-49a2-8991-deba110f7455';

    // 1. Login
    const loginRes = await makeRequest(baseUrl + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'compras4@donahelena.com.br', password: '@D3z3mbr0%', language: 'pt-BR' })
    });
    if (!loginRes.body?.token) throw new Error('Login falhou');

    // 2. Embed Token
    const reportViewRes = await makeRequest(baseUrl + '/api/auth/report_view/report-view?id=c498464e-67a3-43f0-8c22-2dbb5efe1048', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + loginRes.body.token, 'Content-Type': 'application/json' }
    });
    const embeddedToken = reportViewRes.body?.token?.token;
    if (!embeddedToken) throw new Error('Token embedded não obtido');

    // 3. Query DAX — todos os materiais com descrição
    const daxQuery = `
      EVALUATE 
      SUMMARIZECOLUMNS('OPME'[CD_MATERIAL], 'OPME'[DS_MATERIAL])
    `;

    const queryRes = await makeRequest(`https://api.powerbi.com/v1.0/myorg/groups/${workspaceId}/datasets/${datasetId}/executeQueries`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + embeddedToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: [{ query: daxQuery }] })
    });

    const rows = queryRes.body?.results?.[0]?.tables?.[0]?.rows || [];
    if (rows.length === 0) {
      console.log('[AVISO] DAX OPME retornou vazio.');
      process.exit(0);
    }
    console.log(`[DAX] ${rows.length} materiais obtidos do OPME.`);

    // 4. Sincronizar com o banco
    const conn = await mysql.createConnection({
      socketPath: '/var/run/mysqld/mysqld.sock',
      user: 'root', password: 'QbbRkK7bKiGFMRCWggiLgaiu', database: 'materiais_opme'
    });

    let inserted = 0, updated = 0, unchanged = 0;

    for (const r of rows) {
      const cdMaterial = r['OPME[CD_MATERIAL]'];
      const descricao = (r['OPME[DS_MATERIAL]'] || '').trim();
      if (!cdMaterial || !descricao) continue;

      // Verificar se já existe
      const [existing] = await conn.execute(
        'SELECT descricao FROM consumo_materiais_cadastro WHERE cd_material = ?',
        [cdMaterial]
      );

      if (existing.length === 0) {
        // INSERT
        await conn.execute(
          'INSERT INTO consumo_materiais_cadastro (cd_material, descricao, fonte) VALUES (?, ?, ?)',
          [cdMaterial, descricao, 'opme']
        );
        inserted++;
      } else if (existing[0].descricao !== descricao) {
        // UPDATE (descrição mudou)
        await conn.execute(
          'UPDATE consumo_materiais_cadastro SET descricao = ?, fonte = ? WHERE cd_material = ?',
          [descricao, 'opme', cdMaterial]
        );
        updated++;
      } else {
        unchanged++;
      }
    }

    console.log(`[OK] Cadastro sincronizado: ${inserted} novos | ${updated} atualizados | ${unchanged} inalterados | ${rows.length} total DAX`);
    await conn.end();

  } catch (err) {
    console.error('[ERRO]:', err.message);
    process.exit(1);
  }
})();
