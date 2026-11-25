# Importação CSV e fechamento mensal

O recorte usa um CSV em UTF-8 de até 512 KB e 500 registros por lote. O separador pode ser ponto e vírgula ou vírgula. Os formatos nativos de emissores dependem de amostras para validação. A tela oferece modelos para conta e cartão.

| Coluna | Regra |
| --- | --- |
| `data` | Obrigatória. Aceita `AAAA-MM-DD` e `DD/MM/AAAA`. |
| `descricao` | Obrigatória. Até 160 caracteres após filtragem. |
| `valor` | Obrigatória. Até duas casas decimais e diferente de zero. Exemplos `-49,90` em conta e `49,90` no cartão. |
| `tipo` | Opcional. Aceita `receita`, `despesa`, `compra` ou `pagamento_fatura`. Sem tipo, a conta usa o sinal do valor e o cartão usa compra. |
| `id_externo` | Opcional. Usar apenas se for uma referência estável no destino. Guarda-se o hash, com deduplicação por destino. |
| `categoria`, `tags` | Opcionais. A categoria tem até 80 caracteres. As tags têm até 40 caracteres cada, separadas por `|`, com limite de 12. |

A prévia não grava no banco. Um lote idêntico confirmado para o mesmo destino não cria outros lançamentos. Valores e datas iguais são indícios para revisão e podem representar movimentos distintos. Para um pagamento de fatura, o registro deve ser vinculado a uma baixa já cadastrada na conta, com o mesmo dia e valor, ou ignorado para revisão posterior. O vínculo conserva as classificações e o efeito financeiro do lançamento original. Cada referência pode ser usada uma vez no lote.

O backend valida novamente o arquivo, o destino e as decisões na confirmação. A migração 0005 guarda metadados e o resultado por registro. O CSV original e as colunas fora do modelo só são usados em memória para a leitura. Descrições, categorias e tags passam por filtragem de identificadores antes da gravação. A exportação é voltada à análise, neutraliza fórmulas de planilha e limita a resposta a 5000 registros por filtro.

O fechamento mensal é uma consulta recalculada por mês. Os totais por categoria seguem a base do extrato e mostram uma linha **Sem categoria** quando se aplica. Os pagamentos e a variação efetiva consultam a base de caixa. As categorias e tags desta etapa são etiquetas dos lançamentos simples do extrato. A estrutura de catálogo, hierarquia e arquivamento de categorias, o backup integral restaurável e os formatos bancários específicos têm escopo separado. [Regras de ingestão](03-dados-e-migracao.md) · [Plano de desenvolvimento](08-plano-sdlc.md)
