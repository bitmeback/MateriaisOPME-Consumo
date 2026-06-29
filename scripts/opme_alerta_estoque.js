#!/usr/bin/env node
const http = require('http');
const mysql = require('mysql2/promise');

async function sendWahaMessage(phone, message) {
    const data = JSON.stringify({
        chatId: phone.replace(/[^0-9]/g, '') + '@c.us',
        text: message,
        session: 'default'
    });

    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost', port: 3001, path: '/api/sendText', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Api-Key': 'opme-waha-secret-2026' }
        }, res => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

(async () => {
    try {
        console.log('[MONITOR] Gerando Matriz de Threshold...');
        
        const connOpme = await mysql.createConnection({
            socketPath: '/var/run/mysqld/mysqld.sock', user: 'root', password: 'QbbRkK7bKiGFMRCWggiLgaiu', database: 'materiais_opme'
        });

        const queryCalculo = `
            SELECT 
                s.cd_material,
                s.cd_fornec_consignado AS cnpj_fornecedor,
                MAX(s.saldo) as saldo,
                MAX(COALESCE(cad.descricao, 'Material Desconhecido')) as descricao,
                MAX(COALESCE(f.name, 'Não cadastrado')) as fornecedor,
                COALESCE(ROUND(SUM(c.consumo) / NULLIF(COUNT(DISTINCT c.mes), 0), 1), 0) AS media_trimestre,
                (MAX(s.saldo) / NULLIF(COALESCE(ROUND(SUM(c.consumo) / NULLIF(COUNT(DISTINCT c.mes), 0), 1), 0), 0)) AS crity_ratio
            FROM saldo_estoque_atual s
            LEFT JOIN consumo_materiais_cadastro cad ON s.cd_material = cad.cd_material
            LEFT JOIN consumo_materiais c ON s.cd_material = c.codigo
                AND c.ano = YEAR(CURDATE()) 
                AND c.mes >= MONTH(CURDATE()) - 3
            LEFT JOIN consumo_fornecedores f ON f.cnpj = s.cd_fornec_consignado
            LEFT JOIN consumo_fornecedor_especialidade cfe ON cfe.cnpj_fornecedor = s.cd_fornec_consignado AND cfe.id_especialidade = 1
            LEFT JOIN consumo_relacoes_inativas cri ON cri.cd_material = s.cd_material AND cri.cnpj_fornecedor = s.cd_fornec_consignado
            WHERE cfe.id_especialidade IS NULL
              AND cri.cd_material IS NULL
            GROUP BY s.cd_material, s.cd_fornec_consignado
            ORDER BY crity_ratio ASC, media_trimestre DESC
        `;

        const [results] = await connOpme.query(queryCalculo);
        
        let msgCriticos = ''; let contCritico = 0;
        let msgAlertas = ''; let contAlerta = 0;
        let msgSemGiro = ''; let contSemGiro = 0;

        // 1. Mapear status anteriores em lote da tabela consumo_status_atual para checar as transições
        const [rowsStatus] = await connOpme.query('SELECT cd_material, cnpj_fornecedor, status_atual FROM consumo_status_atual');
        const statusMap = {};
        for (const row of rowsStatus) {
            const key = `${row.cd_material}_${row.cnpj_fornecedor}`;
            statusMap[key] = row.status_atual;
        }

        for (const item of results) {
            const codigo = item.cd_material || 'N/A';
            const cnpj = item.cnpj_fornecedor || '';
            const saldo = parseFloat(item.saldo) || 0;
            const media = parseFloat(item.media_trimestre) || 0;
            // Thresholds por faixa de média
            let threshold_critico, threshold_warning;
            if (media <= 3) {
                // Grupo A — consumo esporádico/baixo
                // Saldo >= média = NORMAL | Saldo > 0 e < média = ALERTA | Saldo = 0 = CRÍTICO
                threshold_critico = 0;
                threshold_warning = Math.ceil(media);
            } else {
                // Grupo B — consumo regular/alto: margem 10% para warning
                threshold_critico = Math.ceil(media * 0.9);
                threshold_warning = Math.ceil(media);
            }
            
            const shortDesc = item.descricao ? item.descricao.substring(0, 30) : 'Material Desconhecido';
            const shortForn = item.fornecedor ? item.fornecedor.substring(0, 25) : 'Não inf.';

            // Determinar o status calculado hoje
            let currentStatus = 'normal';
            if (media < 1 && saldo > 0) {
                // SEM GIRO — estoque parado sem consumo recente
                currentStatus = 'sem_giro';
                if(contSemGiro < 5) {
                    msgSemGiro += `• *[${codigo}]* ${shortDesc}...\n  ↳ Forn: ${shortForn}\n  ↳ Média: — | *Saldo: ${saldo}*\n\n`;
                }
                contSemGiro++;
            } else if (media < 1 && saldo <= 0) {
                // INATIVO — sem estoque e sem consumo
                currentStatus = 'inativo';
            } else if (media <= 3) {
                // Grupo A
                if (saldo <= 0) {
                    currentStatus = 'critico';
                    if(contCritico < 15) {
                        msgCriticos += `• *[${codigo}]* ${shortDesc}...\n  ↳ Forn: ${shortForn}\n  ↳ Média: ${media} | *Saldo: ${saldo}*\n\n`;
                    }
                    contCritico++;
                } else if (saldo < threshold_warning) {
                    currentStatus = 'alerta';
                    if(contAlerta < 15) {
                        msgAlertas += `• *[${codigo}]* ${shortDesc}...\n  ↳ Forn: ${shortForn}\n  ↳ Média: ${media} | *Saldo: ${saldo}*\n\n`;
                    }
                    contAlerta++;
                }
            } else {
                // Grupo B
                if (saldo <= threshold_critico) {
                    currentStatus = 'critico';
                    if(contCritico < 15) {
                        msgCriticos += `• *[${codigo}]* ${shortDesc}...\n  ↳ Forn: ${shortForn}\n  ↳ Média: ${media} | *Saldo: ${saldo}*\n\n`;
                    }
                    contCritico++;
                } else if (saldo <= threshold_warning) {
                    currentStatus = 'alerta';
                    if(contAlerta < 15) {
                        msgAlertas += `• *[${codigo}]* ${shortDesc}...\n  ↳ Forn: ${shortForn}\n  ↳ Média: ${media} | *Saldo: ${saldo}*\n\n`;
                    }
                    contAlerta++;
                }
            }

            // --- Lógica silenciosa de transição de status (Passo 1 do Planejamento) ---
            if (cnpj !== '') {
                const key = `${codigo}_${cnpj}`;
                const oldStatus = statusMap[key] || null;

                if (oldStatus !== currentStatus) {
                    console.log(`[STATUS VIRADA] Material ${codigo} (${shortForn}): ${oldStatus} -> ${currentStatus}`);
                    
                    // Grava transição no histórico
                    await connOpme.execute(
                        'INSERT INTO consumo_status_historico (cd_material, cnpj_fornecedor, status_anterior, status_novo, saldo_momento, media_momento) VALUES (?, ?, ?, ?, ?, ?)',
                        [codigo, cnpj, oldStatus, currentStatus, saldo, media]
                    );

                    if (oldStatus === null) {
                        // Cadastro inicial de estado mestre
                        await connOpme.execute(
                            'INSERT INTO consumo_status_atual (cd_material, cnpj_fornecedor, status_atual, data_entrada) VALUES (?, ?, ?, NOW())',
                            [codigo, cnpj, currentStatus]
                        );
                    } else {
                        // Atualiza estado mestre reiniciando o aging temporal
                        await connOpme.execute(
                            'UPDATE consumo_status_atual SET status_atual = ?, data_entrada = NOW() WHERE cd_material = ? AND cnpj_fornecedor = ?',
                            [currentStatus, codigo, cnpj]
                        );
                    }
                }
            }
        }

        if (contCritico === 0 && contAlerta === 0 && contSemGiro === 0) {
            console.log('[MONITOR] 🟢 Nenhum estoque operando sob risco. Nenhum item sem giro. Auditoria não necessária.');
            await connOpme.end();
            process.exit(0);
        }

        let finalReport = `🏥 *Hospital Dona Helena | OPME*\n*Prevenção de Ruptura de Estoque* 🚨\n📅 ${new Date().toLocaleDateString('pt-BR')}\n\n`;
        
        if (contCritico > 0) {
            finalReport += `🔴 *ITENS CRÍTICOS (${contCritico})*\n_Saldo 5% inferior à Média (Prioritários)_\n\n${msgCriticos}`;
            if(contCritico > 15) finalReport += `_(+ ${contCritico - 15} itens críticos omitidos)_\n`;
        }

        if (contAlerta > 0) {
            finalReport += `\n🟠 *ITENS EM ALERTA (${contAlerta})*\n_Saldo próximo da Média (+5%)_\n\n${msgAlertas}`;
            if(contAlerta > 15) finalReport += `_(+ ${contAlerta - 15} alertas omitidos)_\n`;
        }

        if (contSemGiro > 0) {
            finalReport += `\n🟣 *SEM GIRO (${contSemGiro})*\n_Estoque parado sem consumo recente_\n\n${msgSemGiro}`;
            if(contSemGiro > 5) finalReport += `_(+ ${contSemGiro - 5} itens sem giro omitidos)_\n`;
        }

        finalReport += `\n📌 _Monitorado: ${results.length} materiais._`;

        const connReports = await mysql.createConnection({
            socketPath: '/var/run/mysqld/mysqld.sock', user: 'root', password: 'QbbRkK7bKiGFMRCWggiLgaiu', database: 'materiais_opme_reports'
        });

        const [contacts] = await connReports.query(`SELECT phone FROM report_recipients WHERE type='whatsapp' AND active=1`);
        let destinationsString = "";

        if (contacts.length > 0) {
            console.log(`[WAHA] Multicast para ${contacts.length} inscritos...`);
            for (const c of contacts) {
                if (c.phone) {
                    destinationsString += c.phone + ", ";
                    await sendWahaMessage(c.phone, finalReport);
                    await new Promise(r => setTimeout(r, 1500)); 
                }
            }
            
            // Auditoria
            console.log('[AUDIT] Salvando Memorial de Envio da Madrugada no Banco OPME...');
            await connOpme.execute(
                `INSERT INTO alerta_estoque_audit (conteudo_mensagem, destinatarios, qtd_criticos, qtd_alertas) VALUES (?, ?, ?, ?)`,
                [finalReport, destinationsString, contCritico, contAlerta]
            );

        } else {
            console.log('[AVISO] Nenhuma inscrição encontrada.');
        }

        await connOpme.end(); await connReports.end();
        console.log('[FINISH] Execução Finalizada e Auditada!');

    } catch (err) { console.error('[ERRO GERAL]:', err.message); }
})();
