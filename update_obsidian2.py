import re

with open('/srv/obsidian-vault/10-Projetos/Consumo de Materiais OPME.md', 'r', encoding='utf-8') as f:
    content = f.read()

# Substituir status das tarefas
content = content.replace("- [ ] Investigar outlier:", "- [x] Investigar outlier:")
content = content.replace("- [ ] Decidir o que fazer com códigos duplicados", "- [x] Códigos duplicados absorvidos na visão Analítica por NR_CIRURGIA e Fornecedor.")

# Adicionar a nova Fase 1.5 - Prevenção de Rupturas Logísticas
nova_fase = """## Fase 1.5 - Monitor de Rupturas de Estoque (Alertas Ativos)
A inteligência analítica foi mapeada e implementada para evitar a falta de materiais por discrepância de média de uso vs saldo atual.
- [x] Extração Diária do Saldo de Estoque: A tabela fantasma `SALDO_ESTOQUE` é extraída do dataset PowerBI às 06h15 da manhã.
- [x] Inteligência Threshold: Aplicação de Regras Locais Node.js cruzando a Tabela Fato `saldo_estoque_atual` e calculando a Média Trimestral de Consumo Histórica (últimos 90 dias providos do `consumo_materiais`).
- [x] Engine de Delivery WAHA: Disparo agendado para às 06h30 enviando via interface Localhost/API para a MariaDB `report_recipients`. Os contatos "gestor/whatsapp" do BD recebem na palma da mão alertas visuais críticos.

**Regras Threshold Aprovadas:**
- 🔴 **CRITICAL:** `Saldo Atual <= Média Histórica (-5%)`. (Item entrou na zona de desabastecimento)
- 🟠 **WARNING:**  `Saldo Atual <= Média Histórica (+5%) E Saldo > Critical`. (Item acende atenção e vai acabar em poucos dias)
- _Ordenação Lógica:_ Calculada de forma proporcional ("Menor Ratio significa desabastecimento agúdo de um item que antes consumia gigantescamente"). Desempatado para jogar o topo para as maiores Médias Históricas.
"""

content = content.replace("## Fase 2 - Backend e Relatórios", nova_fase + "\n## Fase 2 - Backend e Relatórios")

with open('/srv/obsidian-vault/10-Projetos/Consumo de Materiais OPME.md', 'w', encoding='utf-8') as f:
    f.write(content)
