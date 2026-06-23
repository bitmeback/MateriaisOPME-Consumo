import re

with open('/srv/obsidian-vault/10-Projetos/Consumo de Materiais OPME.md', 'r', encoding='utf-8') as f:
    content = f.read()

nova_arquitetura = """## Nova Arquitetura de Ingestão (API DAX to SQL)

A fase de extração por planilhas manuais ou *web scraping* foi **descontinuada**. Foi implementada uma ingestão de nível corporativo e totalmente silenciosa (Server-to-Server) conectando o Node.js diretamente no Azure Analysis Services através do ReportLoad.

**Fluxo da arquitetura (Duplo Cron diário)**
1. **Login API:** Autenticação master de usuário (`POST /api/login`) no ReportLoad.
2. **Embed Token:** O script consome a API do ReportView para roubar o *token JWT Embedded* do Power BI respectivo.
3. **DAX Execution:** Passando o CORS/IFrame por baixo dos panos, executa uma requisição POST na API de execução nativa do Power BI (`executeQueries`). São enviadas Queries DAX sob medida filtradas por Mês/Ano corrente.
4. **Data Sync:** O JSON retornado flui na memória e sobrescreve (Clean & Replace) o mês vigente diretamente no MariaDB, ignorando Excel ou arquivos no disco.

Foram definidos dois escopos de Ingestão Diária com essa arquitetura (agendados para **06:00 AM**):
- **Consumo (Consolidado):** Script \`opme_capture_api.js\`. Grava apenas a aba primária de "Análise de Consumo" agrupado por Material e Fornecedor na tabela \`consumo_materiais\`.
- **Analítico (Detalhado):** Script \`opme_analitico_diario.js\`. Responsável pelo *drill-down*. Extrai a aba estendida "Analítico", trazendo cirurgia a cirurgia (Atendimento, valores de conta, última compra, lucro, data de baixa e término e situação). Gravado na tabela \`consumo_analitico\` e possui carga histórica desde Janeiro de 2024.

### Estrutura da tabela \`consumo_analitico\`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| id | BIGINT AUTO_INCREMENT | Chave primária |
| nr_atendimento | BIGINT | Número do Atendimento |
| nr_cirurgia | BIGINT | ID da Cirurgia |
| cd_material | INT | Código do material OPME |
| ds_material | VARCHAR(255) | Descrição do material |
| qtde | INT | Quantidade Consumida |
| vl_conta | DECIMAL(15,2) | Valor Material Conta |
| vl_ultima_compra | DECIMAL(15,2) | Valor Última Compra |
| vl_lucro_liq | DECIMAL(15,2) | Valor Lucro Líquido |
| ds_fornecedor | VARCHAR(255) | Fornecedor |
| situacao | VARCHAR(100) | Situação (Lançado/Enviado Faturamento) |
| dt_termino | DATETIME | Data do Término da Cirurgia |
| dt_baixa | DATETIME | Data de Baixa (se houver) |
| ds_convenio | VARCHAR(100) | Convênio |
| ds_setor | VARCHAR(100) | Setor (Ex: Centro Cirurgico) |
| ano / mes | INT | Marcador Temporal |

"""

# Localizar o header "Status" para inserir antes
content = content.replace("## Custos Estimados (mensais)", nova_arquitetura + "\n## Custos Estimados (mensais)")

# Atualizar checkbox do Escopo (Fase 1)
content = content.replace("- [ ] Validar dados", "- [x] Acesso bypass via DAX API da Microsoft concluído com Cronjob implantado e injetando na base.\n- [x] Construção da Base Analítica retroativa a partir de Janeiro de 2024 realizada com mais de 50 mil Registros.\n- [ ] Validar dados")

with open('/srv/obsidian-vault/10-Projetos/Consumo de Materiais OPME.md', 'w', encoding='utf-8') as f:
    f.write(content)
