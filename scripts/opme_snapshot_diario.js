#!/usr/bin/env node
/**
 * opme_snapshot_diario.js
 * -----------------------
 * Snapshot diário do estado de todos os materiais OPME de consumo.
 * Roda após a ingestão de dados e calcula o status (normal/alerta/critico)
 * de cada par (material, fornecedor), gravando na tabela consumo_snapshot_diario.
 *
 * Uso: node opme_snapshot_diario.js [--dry-run]
 *
 * Chave única (data_snapshot, cd_material, cnpj_fornecedor) garante
 * idempotência — re-runs no mesmo dia fazem REPLACE ao invés de duplicar.
 */

const mysql = require('mysql2/promise');

const DB_CONFIG = {
    socketPath: '/var/run/mysqld/mysqld.sock',
    user: 'root',
    password: 'QbbRkK7bKiGFMRCWggiLgaiu',
    database: 'materiais_opme'
};

(async () => {
    const dryRun = process.argv.includes('--dry-run');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    console.log(`[SNAPSHOT] ${dryRun ? '[DRY-RUN] ' : ''}Gerando snapshot para ${today}...`);

    const conn = await mysql.createConnection(DB_CONFIG);

    try {
        // Mesma query de cálculo do opme_alerta_estoque.js
        const queryCalculo = `
            SELECT 
                s.cd_material,
                s.cd_fornec_consignado AS cnpj_fornecedor,
                MAX(s.saldo) as saldo,
                MAX(COALESCE(cad.descricao, 'Material Desconhecido')) as descricao,
                COALESCE(ROUND(SUM(c.consumo) / NULLIF(COUNT(DISTINCT c.mes), 0), 1), 0) AS media_trimestre,
                (MAX(s.saldo) / NULLIF(COALESCE(ROUND(SUM(c.consumo) / NULLIF(COUNT(DISTINCT c.mes), 0), 1), 0), 0)) AS crity_ratio
            FROM saldo_estoque_atual s
            LEFT JOIN consumo_materiais_cadastro cad ON s.cd_material = cad.cd_material
            LEFT JOIN consumo_materiais c ON s.cd_material = c.codigo
                AND c.ano = YEAR(CURDATE()) 
                AND c.mes >= MONTH(CURDATE()) - 3
            LEFT JOIN consumo_fornecedor_especialidade cfe ON cfe.cnpj_fornecedor = s.cd_fornec_consignado AND cfe.id_especialidade = 1
            LEFT JOIN consumo_relacoes_inativas cri ON cri.cd_material = s.cd_material AND cri.cnpj_fornecedor = s.cd_fornec_consignado
            WHERE cfe.id_especialidade IS NULL
              AND cri.cd_material IS NULL
            GROUP BY s.cd_material, s.cd_fornec_consignado
            HAVING media_trimestre >= 1
            ORDER BY crity_ratio ASC, media_trimestre DESC
        `;

        const [results] = await conn.query(queryCalculo);
        console.log(`[SNAPSHOT] ${results.length} materiais calculados.`);

        if (dryRun) {
            // Mostra amostra sem gravar
            let critico = 0, alerta = 0, normal = 0;
            for (const item of results) {
                const saldo = parseFloat(item.saldo) || 0;
                const media = parseFloat(item.media_trimestre) || 0;
                // Thresholds por faixa de média
                let threshold_critico, threshold_warning;
                if (media <= 3) {
                    threshold_critico = 0;
                    threshold_warning = Math.ceil(media);
                } else {
                    threshold_critico = Math.ceil(media * 0.9);
                    threshold_warning = Math.ceil(media);
                }

                let status = 'normal';
                if (media <= 3) {
                    if (saldo <= 0) { status = 'critico'; critico++; }
                    else if (saldo < threshold_warning) { status = 'alerta'; alerta++; }
                    else { normal++; }
                } else {
                    if (saldo <= threshold_critico) { status = 'critico'; critico++; }
                    else if (saldo <= threshold_warning) { status = 'alerta'; alerta++; }
                    else { normal++; }
                }
                console.log(`  [${status.toUpperCase()}] ${item.cd_material} | Saldo: ${saldo} | Media: ${media}`);
            }
            console.log(`[DRY-RUN] Resumo: ${critico} críticos, ${alerta} alerta, ${normal} normal`);
            await conn.end();
            process.exit(0);
        }

        // Gravar snapshot com REPLACE (idempotente no mesmo dia)
        let inserted = 0;
        for (const item of results) {
            const saldo = parseFloat(item.saldo) || 0;
            const media = parseFloat(item.media_trimestre) || 0;
            // Thresholds por faixa de média
            let threshold_critico, threshold_warning;
            if (media <= 3) {
                threshold_critico = 0;
                threshold_warning = Math.ceil(media);
            } else {
                threshold_critico = Math.ceil(media * 0.9);
                threshold_warning = Math.ceil(media);
            }

            let status = 'normal';
            if (media <= 3) {
                if (saldo <= 0) status = 'critico';
                else if (saldo < threshold_warning) status = 'alerta';
            } else {
                if (saldo <= threshold_critico) status = 'critico';
                else if (saldo <= threshold_warning) status = 'alerta';
            }

            await conn.execute(
                `REPLACE INTO consumo_snapshot_diario 
                    (data_snapshot, cd_material, cnpj_fornecedor, status, saldo, media_trimestre) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [today, item.cd_material, item.cnpj_fornecedor, status, saldo, media]
            );
            inserted++;
        }

        // Estatísticas
        const [stats] = await conn.query(
            'SELECT status, COUNT(*) as total FROM consumo_snapshot_diario WHERE data_snapshot = ? GROUP BY status',
            [today]
        );
        const resumo = stats.map(s => `${s.status}: ${s.total}`).join(' | ');
        console.log(`[SNAPSHOT] ${inserted} registros gravados para ${today}. ${resumo}`);

        // Total histórico
        const [totalRows] = await conn.query('SELECT COUNT(DISTINCT data_snapshot) as dias, COUNT(*) as total FROM consumo_snapshot_diario');
        console.log(`[SNAPSHOT] Acumulado: ${totalRows[0].dias} dias, ${totalRows[0].total} registros totais.`);

    } catch (err) {
        console.error('[ERRO]', err.message);
        process.exit(1);
    } finally {
        await conn.end();
    }
})();
