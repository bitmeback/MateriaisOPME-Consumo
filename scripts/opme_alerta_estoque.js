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
                s.saldo,
                c.descricao,
                c.fornecedor,
                CEIL(SUM(c.consumo) / 3) AS media_trimestre,
                (s.saldo / NULLIF(CEIL(SUM(c.consumo) / 3), 0)) AS crity_ratio
            FROM saldo_estoque_atual s
            LEFT JOIN consumo_materiais c ON s.cd_material = c.codigo
            WHERE c.ano = YEAR(CURDATE()) AND c.mes >= MONTH(CURDATE()) - 3
            GROUP BY s.cd_material, s.saldo, c.descricao, c.fornecedor
            HAVING media_trimestre > 1
            ORDER BY crity_ratio ASC, media_trimestre DESC
        `;

        const [results] = await connOpme.query(queryCalculo);
        
        let msgCriticos = ''; let contCritico = 0;
        let msgAlertas = ''; let contAlerta = 0;

        for (const item of results) {
            const codigo = item.cd_material || 'N/A';
            const saldo = parseFloat(item.saldo) || 0;
            const media = parseFloat(item.media_trimestre) || 0;
            const threshold_critico = Math.ceil(media * 0.95);
            const threshold_warning = Math.ceil(media * 1.05);
            
            const shortDesc = item.descricao ? item.descricao.substring(0, 30) : 'Material Desconhecido';
            const shortForn = item.fornecedor ? item.fornecedor.substring(0, 25) : 'Não inf.';

            if (saldo <= threshold_critico) {
                if(contCritico < 15) {
                    msgCriticos += `• *[${codigo}]* ${shortDesc}...\n  ↳ Forn: ${shortForn}\n  ↳ Média: ${media} | *Saldo: ${saldo}*\n\n`;
                }
                contCritico++;
            } else if (saldo <= threshold_warning && saldo > threshold_critico) {
                if(contAlerta < 15) {
                    msgAlertas += `• *[${codigo}]* ${shortDesc}...\n  ↳ Forn: ${shortForn}\n  ↳ Média: ${media} | *Saldo: ${saldo}*\n\n`;
                }
                contAlerta++;
            }
        }

        if (contCritico === 0 && contAlerta === 0) {
            console.log('[MONITOR] 🟢 Nenhum estoque operando sob risco. Auditoria não necessária.');
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

        finalReport += `\n📌 _Monitorado: ${results.length} materiais em giro._`;

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
