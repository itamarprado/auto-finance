# Dados, integração bancária e migração

O Auto Finance processa e guarda os dados financeiros no PostgreSQL da instalação local. Esta decisão complementa os [requisitos](02-requisitos.md) e a [referência da integração Pluggy](07-pluggy-integracao.md).

## 1. Como manter a instalação atualizada

| Entrada | Uso | Verificação |
| --- | --- | --- |
| Registro manual | Contas, cartões, saldos iniciais e movimentações. | Conferir ciclos, totais e histórico após arquivar um instrumento. |
| Arquivo de extrato ou fatura | Importação periódica e continuidade do histórico. | Prévia, validação, confirmação e reimportação sem duplicidade. |
| Meu Pluggy | Leitura opcional das conexões autorizadas, com credencial própria da instalação. | Conferir cobertura de contas, cartões, faturas e transações conforme o banco e a modalidade. [Uso pessoal](https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use) |

Cada titular autoriza suas conexões no fluxo oficial. O modelo local pode distinguir vários titulares sem depender de uma conta do provedor que aceite bancos de pessoas diferentes. A configuração de várias fontes e as cotas aplicáveis devem ser verificadas nas condições do provedor. [Condições e limites](07-pluggy-integracao.md#1-viabilidade-e-cobertura)

Quando a integração estiver implementada, uma tarefa local vai consultar a API enquanto o serviço estiver em execução. A cadência de atualização do banco depende do provedor. A coleta registra seu último sucesso por conexão e retoma o processamento de uma janela conhecida após falha. Uma janela repetida mantém a contagem de transações.

| Cenário de aceitação | Evidência |
| --- | --- |
| Fonte autorizada | A API retorna os instrumentos e movimentos permitidos pela conexão. |
| Titulares ou cartões distintos | Instrumentos com atributos semelhantes permanecem separados. |
| Falha, expiração ou revogação | Apenas a fonte afetada pausa. Dados já gravados e entradas manuais permanecem acessíveis. |
| Fatura aberta ou ausente | A instalação identifica quando o valor é estimado e reconcilia com o valor confirmado ao receber a fatura. |
| Serviço local interrompido | A retomada parte do último ponto confirmado e evita duplicidades. |

## 2. O que pode migrar

O Dinzo documenta dois pontos de exportação relevantes. Em **Configurações → Privacidade e dados → Exportar meus dados**, a web oferece as transações do extrato em CSV ou Excel, com data, descrição, valor, categoria, conta e origem documentados. No **Extrato → Exportar**, PDF e Excel seguem o recorte do extrato, e relatórios têm formatos de exportação próprios. A web também tem exportação de posições de investimentos em CSV. Uma amostra de cada arquivo é necessária para verificar período, filtros, linhas ocultas, projetadas, transferências, descontos e colunas efetivamente disponíveis. [Exportar meus dados](https://ajuda.dinzo.com.br/hc/central-de-ajuda-dinzo/articles/1787188743-lgpd-e-seus-direitos-sobre-os-dados), [Relatórios e exportação](https://ajuda.dinzo.com.br/hc/central-de-ajuda-dinzo/articles/1787188737-relatorios-e-como-exportar), [Investimentos](https://ajuda.dinzo.com.br/hc/central-de-ajuda-dinzo/articles/1787188739-investimentos-no-dinzo).

| Informação | Melhor fonte inicial | Verificação e lacunas |
| --- | --- | --- |
| Compras, receitas e despesas | Exportação de dados do Dinzo e extratos/faturas oficiais para conferência. | Confirmar sinal, data, moeda, origem, descrição, conta e categoria. Identificar compras de cartão, pagamentos de fatura e transferências. |
| Contas e cartões | Cadastro seletivo, conferência no banco e, onde útil, leitura oficial do Dinzo. | Preservar nomes distintos, tipo, moeda, saldo na data de corte, fechamento, vencimento, limite e conta pagadora. |
| Faturas, pagamentos e parcelas futuras | Faturas do banco, leitura do Dinzo para transações com vínculos e posição dos parcelamentos. | Capturar ciclo de cada compra, fatura em aberto, pagamentos parciais e planos sem quitação. O saldo restante de um plano não vira nova compra. |
| Categorias, tags, notas e comprovantes | CSV e API/conector conforme os campos. | A categoria está documentada no arquivo. Verificar IDs, hierarquia, tags, notas e disponibilidade dos arquivos de comprovante. Um link pode depender do acesso ao Dinzo. |
| Metas, recorrências, assinaturas e regras | API/conector onde expostos e conferência manual das configurações. | Se necessário, recriar critérios, datas, saldos guardados, exceções e próximo vencimento. Levantar regras de automação à parte caso não estejam disponíveis por leitura oficial. |
| Investimentos e empréstimos | CSV de posições, respostas oficiais disponíveis e extratos da instituição. | Separar posição numa data de histórico de movimentação. Verificar preço bruto, líquido, vencimento e obrigações em aberto. |
| Totais para conferência | Extrato, faturas oficiais e relatórios do Dinzo para recortes conhecidos. | Documentar a base de consumo, o caixa efetivado, o período, a origem e a inclusão de lançamentos ocultos ou pendentes. |

Faturas, categorias, tags, metas, assinaturas, recorrências e parcelamentos podem precisar de fontes distintas conforme a ferramenta de origem. Uma extração deve limitar os períodos, paginar e distinguir efetivados, pendências gravadas e projeções. Validar se os pagamentos de fatura e seus vínculos estão presentes antes de consolidar os dados. [Referência de uma API de origem](https://dinzo.com.br/docs/reference)

## 3. Regras para ingestão e conciliação

1. **Preparar a origem.** Guardar o lote, o período declarado e o destino pretendido. Na prévia, validar datas, sinal, separador, moeda, tipo, nomes de contas e colunas obrigatórias. Uma fatura e um extrato da conta têm finalidades diferentes, mesmo quando ambos mostram o pagamento da mesma fatura.
2. **Identificar antes de somar.** Usar o identificador da movimentação em conjunto com sua origem e conta, quando disponível, e reconhecer a repetição integral de um lote no mesmo destino. Em janelas sobrepostas e fontes diferentes, comparar conta, direção, valor, data e descrição original como indícios. Com evidência insuficiente, propor equivalências para revisão e manter a possibilidade de registrar dois eventos legítimos.
3. **Definir precedência por informação.** Confirmar o fato, saldo e valor da fatura com a fonte competente. Preservar a categoria, as tags, a nota e a descrição que o usuário revisou. Exibir a origem do atributo alterado quando ela explica diferenças.
4. **Tratar vínculos de modo explícito.** Conciliar duas pontas de uma transferência, um pagamento de fatura com sua saída bancária, ou um fato efetivado com a projeção que substitui. Estornos e créditos devem carregar seu contexto quando conhecido.
5. **Conferir e publicar o lote.** Mostrar quantos registros entram, são atualizados, são descartados como duplicados confirmados ou precisam de decisão. Permitir reexecução segura e desfazer com atenção a vínculos e edições posteriores.

### Uma data de corte com saldo verificável

Escolher um fechamento de dia com saldo bancário conferível, mais faturas e parcelas abertas conhecidas. Há duas maneiras de começar. Com histórico completo a partir de uma data, gravar o saldo imediatamente anterior aos primeiros movimentos e recompor os demais. Com saldo atual como referência, importar movimentos anteriores como histórico e calcular saldos posteriores apenas a partir da referência e dos movimentos que a sucedem. A definição precisa dizer quais movimentos do próprio dia já estão refletidos no saldo. O mesmo recorte deve identificar créditos, dívidas e faturas que atravessam a data de corte.

Exemplo fictício. Se o saldo de fechamento de 30/11 é R$ 2.000 e o app começa a operar em 01/12, uma compra no débito de R$ 150 em novembro pode aparecer no histórico. O cálculo de dezembro parte de R$ 2.000. Uma parcela de cartão referente a compra feita em novembro e ainda a vencer continua nas obrigações do ciclo de dezembro.

## 4. Comprovação da troca

| Etapa futura | Evidência para concluir |
| --- | --- |
| Selecionar histórico e fontes | Período e conjunto de contas definidos. Amostras de arquivo e acesso aos metadados verificados. |
| Exportar e preservar uma cópia local | Arquivos originais guardados com data, origem e recorte. O acesso de leitura ao Dinzo é tratado como temporário. |
| Importar para teste e medir divergências | Para um mês fechado, conferir contagem, receitas e despesas por base, saldos de abertura/fechamento, transferências e diferença por conta. Para cada cartão prioritário, conferir ciclo, total, valor pago, aberto e parcelas restantes. Toda divergência relevante tem uma explicação ou correção. |
| Validar a rotina com dados novos | Executar um ciclo mensal em paralelo, incluindo importação repetida ou atualização, fechamento e pagamento de fatura. Verificar volume de revisão aceitável. |
| Restaurar um backup | Um ambiente separado reproduz totais, vínculos e registros requeridos. |
| Conferir continuidade | A instalação atualiza as fontes habilitadas e oferece consulta ao histórico reconciliado. |

Antes de desativar qualquer ferramenta de origem, verifique o histórico importado e restaure um backup de teste. A revogação bancária, o encerramento da assinatura e a exclusão da conta seguem as regras da ferramenta de origem.
