#!/usr/bin/env node
/**
 * OPME Consumo de Materiais - Script de Ingestão
 * ================================================
 * 
 * Importa dados de consumo de materiais OPME a partir de arquivos Excel (.xlsx)
 * gerados pelo BI ReportLoad (https://donahelena.reportload.com).
 * 
 * Padrão de nome dos arquivos: YYYY-mmm.xlsx (ex: 2024-jan.xlsx, 2025-dez.xlsx)
 * 
 * Estrutura esperada do arquivo:
 *   Código | Descrição | Consumo | Meses | Média mensal | Saldo** | Fornecedor
 * 
 * Uso:
 *   node opme_consumo_materiais_ingest.js --file <caminho_arquivo>
 *   node opme_consumo_materiais_ingest.js --dir <caminho_diretorio>
 *   node opme_consumo_materiais_ingest.js --file arquivo.xlsx --save-csv
 * 
 * Opções:
 *   --file <path>      Importar um arquivo específico
 *   --dir <path>       Importar todos os arquivos .xlsx de um diretório
 *   --save-csv         Salvar cópia dos dados importados como CSV
 *   --dry-run          Simular importação sem gravar no banco
 *   --verbose          Mostrar detalhes de cada registro
 *   --help             Mostrar ajuda
 * 
 * Data: 2026-06-22
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const xlsx = require('xlsx');

// ============================================
// CONFIGURAÇÃO
// ============================================
const CONFIG = {
    db: {
        host: '127.0.0.1',
        socketPath: '/var/run/mysqld/mysqld.sock',
        user: 'root',
        password: 'QbbRkK7bKiGFMRCWggiLgaiu',
        database: 'materiais_opme',
        charset: 'utf8mb4'
    },
    batchSize: 500,  // registros por INSERT batch
};

// Mapeamento de meses em português
const MONTH_MAP = {
    'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4, 'mai': 5, 'jun': 6,
    'jul': 7, 'ago': 8, 'set': 9, 'out': 10, 'nov': 11, 'dez': 12
};

// ============================================
// FUNÇÕES AUXILIARES
// ============================================

function parseFileName(fileName) {
    // Extrai ano e mês do padrão YYYY-mmm.xlsx (aceita prefixo doc_xxx_)
    const match = fileName.match(/(\d{4})-(\w{3})\.xlsx$/i);
    if (!match) return null;
    
    const year = parseInt(match[1], 10);
    const monthAbbr = match[2].toLowerCase();
    const month = MONTH_MAP[monthAbbr];
    
    if (!month) {
        console.error(`  [ERRO] Mês não reconhecido: "${monthAbbr}" em ${fileName}`);
        return null;
    }
    
    return { year, month, yearMonth: `${year}-${String(month).padStart(2, '0')}` };
}

function parseNumber(value) {
    if (value === null || value === undefined || value === '' || value === 'None') {
        return null;
    }
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value).replace(',', '.'));
    return isNaN(parsed) ? null : parsed;
}

function parseString(value) {
    if (value === null || value === undefined || value === 'None') {
        return null;
    }
    const trimmed = String(value).trim();
    return trimmed === '' ? null : trimmed;
}

function showHelp() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  OPME Consumo de Materiais - Script de Ingestão             ║
╚══════════════════════════════════════════════════════════════╝

Uso: node opme_consumo_materiais_ingest.js [opções]

Opções:
  --file <path>      Importar um arquivo Excel específico
  --dir <path>       Importar todos os .xlsx de um diretório
  --save-csv         Salvar CSV dos dados importados (pasta ./output/)
  --dry-run          Simular sem gravar no banco
  --verbose          Mostrar detalhes de cada registro
  --help             Mostrar esta ajuda

Exemplos:
  node opme_consumo_materiais_ingest.js --file /path/2024-jan.xlsx
  node opme_consumo_materiais_ingest.js --dir /path/arquivos/ --verbose
  node opme_consumo_materiais_ingest.js --dir ./dados/ --save-csv
`);
}

// ============================================
// PROCESSAMENTO DO ARQUIVO
// ============================================

function processWorkbook(filePath) {
    const fileName = path.basename(filePath);
    const period = parseFileName(fileName);
    
    if (!period) {
        console.error(`  [ERRO] Nome do arquivo não segue o padrão YYYY-mmm.xlsx: ${fileName}`);
        return null;
    }
    
    console.log(`\n📄 Processando: ${fileName} (${period.yearMonth})`);
    
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(worksheet, { defval: null });
    
    if (rows.length === 0) {
        console.error(`  [ERRO] Arquivo vazio: ${fileName}`);
        return null;
    }
    
    // Verificar cabeçalho
    const headers = Object.keys(rows[0]);
    const expectedHeaders = ['Código', 'Descrição', 'Consumo', 'Meses', 'Média mensal', 'Saldo**', 'Fornecedor'];
    const headerMatch = expectedHeaders.every(h => headers.includes(h));
    
    if (!headerMatch) {
        console.warn(`  [AVISO] Cabeçalhos não correspondem ao padrão. Encontrados: ${headers.join(', ')}`);
    }
    
    // Processar linhas
    const records = [];
    let skipped = 0;
    
    for (const row of rows) {
        // Pular linhas de rodapé (Total, Filtros)
        const codigo = row['Código'];
        if (!codigo || codigo === 'Total' || String(codigo).startsWith('Filtros')) {
            skipped++;
            continue;
        }
        
        records.push({
            codigo: parseNumber(codigo),
            descricao: parseString(row['Descrição']),
            consumo: parseNumber(row['Consumo']),
            saldo: parseNumber(row['Saldo**']),
            fornecedor: parseString(row['Fornecedor']),
            ano: period.year,
            mes: period.month,
            arquivo_origem: fileName
        });
    }
    
    console.log(`  ✓ ${records.length} registros extraídos (${skipped} linhas ignoradas)`);
    
    return { records, period, fileName };
}

// ============================================
// GRAVAÇÃO NO BANCO
// ============================================

async function saveToDatabase(records, period, dryRun = false) {
    if (dryRun) {
        console.log(`  [DRY-RUN] ${records.length} registros seriam inseridos`);
        return { inserted: 0, updated: records.length, errors: 0 };
    }
    
    let connection;
    try {
        connection = await mysql.createConnection(CONFIG.db);
        await connection.beginTransaction();
        
        // Preparar query de UPSERT
        const query = `
            INSERT INTO consumo_materiais 
                (codigo, descricao, consumo, saldo, fornecedor, ano, mes, arquivo_origem)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                descricao = VALUES(descricao),
                consumo = VALUES(consumo),
                saldo = VALUES(saldo),
                fornecedor = VALUES(fornecedor),
                arquivo_origem = VALUES(arquivo_origem),
                data_importacao = CURRENT_TIMESTAMP
        `;
        
        let inserted = 0;
        let updated = 0;
        let errors = 0;
        
        // Processar em batches
        for (let i = 0; i < records.length; i += CONFIG.batchSize) {
            const batch = records.slice(i, i + CONFIG.batchSize);
            
            for (const record of batch) {
                try {
                    const values = [
                        record.codigo,
                        record.descricao,
                        record.consumo,
                        record.saldo,
                        record.fornecedor,
                        record.ano,
                        record.mes,
                        record.arquivo_origem
                    ];
                    
                    const [result] = await connection.execute(query, values);
                    
                    if (result.affectedRows === 1) {
                        inserted++;
                    } else if (result.affectedRows === 2) {
                        updated++;
                    }
                } catch (err) {
                    errors++;
                    if (errors <= 5) {
                        console.error(`    [ERRO] Código ${record.codigo}: ${err.message}`);
                    }
                }
            }
        }
        
        await connection.commit();
        
        console.log(`  ✓ Banco: ${inserted} inseridos, ${updated} atualizados, ${errors} erros`);
        return { inserted, updated, errors };
        
    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) await connection.end();
    }
}

// ============================================
// CSV EXPORT (opcional)
// ============================================

function saveToCSV(records, period, fileName) {
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const csvFileName = `${fileName.replace('.xlsx', '')}_imported.csv`;
    const csvPath = path.join(outputDir, csvFileName);
    
    // Cabeçalho
    const header = 'Código,Descrição,Consumo,Saldo,Fornecedor,Ano,Mês,Arquivo';
    const lines = [header];
    
    for (const r of records) {
        const line = [
            r.codigo ?? '',
            `"${(r.descricao || '').replace(/"/g, '""')}"`,
            r.consumo ?? '',
            r.saldo ?? '',
            `"${(r.fornecedor || '').replace(/"/g, '""')}"`,
            r.ano,
            r.mes,
            r.arquivo_origem
        ].join(',');
        lines.push(line);
    }
    
    fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
    console.log(`  ✓ CSV salvo: ${csvPath}`);
}

// ============================================
// FUNÇÃO PRINCIPAL
// ============================================

async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.length === 0) {
        showHelp();
        process.exit(0);
    }
    
    const dryRun = args.includes('--dry-run');
    const saveCSV = args.includes('--save-csv');
    const verbose = args.includes('--verbose');
    
    let filesToProcess = [];
    
    // Verificar --file ou --dir
    const fileArg = args.indexOf('--file');
    const dirArg = args.indexOf('--dir');
    
    if (fileArg !== -1 && args[fileArg + 1]) {
        const filePath = path.resolve(args[fileArg + 1]);
        if (!fs.existsSync(filePath)) {
            console.error(`[ERRO] Arquivo não encontrado: ${filePath}`);
            process.exit(1);
        }
        filesToProcess.push(filePath);
    } else if (dirArg !== -1 && args[dirArg + 1]) {
        const dirPath = path.resolve(args[dirArg + 1]);
        if (!fs.existsSync(dirPath)) {
            console.error(`[ERRO] Diretório não encontrado: ${dirPath}`);
            process.exit(1);
        }
        filesToProcess = fs.readdirSync(dirPath)
            .filter(f => f.endsWith('.xlsx'))
            .map(f => path.join(dirPath, f));
    } else {
        console.error('[ERRO] Especifique --file <path> ou --dir <path>');
        showHelp();
        process.exit(1);
    }
    
    if (filesToProcess.length === 0) {
        console.log('Nenhum arquivo .xlsx encontrado.');
        process.exit(0);
    }
    
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  OPME Consumo de Materiais - Ingestão de Dados             ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n📁 ${filesToProcess.length} arquivo(s) para processar`);
    if (dryRun) console.log('🔍 Modo DRY-RUN (sem gravação no banco)');
    
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalErrors = 0;
    
    for (const filePath of filesToProcess) {
        const data = processWorkbook(filePath);
        if (!data) continue;
        
        if (verbose) {
            console.log(`  Dados amostra (primeiros 3):`);
            data.records.slice(0, 3).forEach(r => {
                console.log(`    Cód:${r.codigo} | ${r.descricao?.substring(0, 40)} | Consumo:${r.consumo} | Saldo:${r.saldo} | Forn:${r.fornecedor?.substring(0, 30)}`);
            });
        }
        
        const result = await saveToDatabase(data.records, data.period, dryRun);
        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalErrors += result.errors;
        
        if (saveCSV) {
            saveToCSV(data.records, data.period, data.fileName);
        }
    }
    
    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('📊 RESUMO DA IMPORTAÇÃO');
    console.log(`   Total inseridos: ${totalInserted}`);
    console.log(`   Total atualizados: ${totalUpdated}`);
    console.log(`   Total erros: ${totalErrors}`);
    console.log('══════════════════════════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('\n[ERRO FATAL]', err.message);
    process.exit(1);
});
