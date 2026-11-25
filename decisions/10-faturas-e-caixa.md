# Faturas, parcelas e fluxo de caixa

## Regras da etapa

- A fatura é identificada por cartão e pelo mês em que fecha. A compra à vista entra no ciclo que inclui o dia de fechamento. Compras depois desse dia entram no próximo. Em mês curto, o fechamento e o vencimento usam o último dia disponível. O vencimento é a primeira ocorrência do dia configurado estritamente posterior ao fechamento.
- A compra parcelada aparece uma vez no Extrato, pelo total na data da compra. Cada fatura mostra a parcela daquele ciclo, a partir do ciclo da compra ou de um primeiro ciclo posterior escolhido pelo usuário. O resíduo em centavos fica na última parcela. Por exemplo, R$ 100 em três parcelas gera R$ 33,33, R$ 33,33 e R$ 33,34.
- O saldo em aberto considera compras e parcelas, menos estornos e pagamentos líquidos. O pagamento manual pode ser parcial ou antecipado, até o valor em aberto. O pagamento gera uma saída na conta escolhida e o estorno integral do pagamento gera a entrada de volta na mesma conta. As duas operações ficam vinculadas e podem ter datas diferentes.
- O estorno de compra aponta para o lançamento à vista ou para a parcela do ciclo e fica limitado ao valor ainda estornável. Ele reduz a fatura original e aparece no Extrato na data informada. Se o ciclo já estava pago, o saldo a favor fica explícito no próprio ciclo. A compensação em outro ciclo depende dos dados do emissor e fica para conciliação.
- A visão de caixa lista movimentos já efetivados. A transferência cria uma saída e uma entrada a partir de um único registro. O efeito é zero quando ambas as contas compõem o filtro e o valor segue visível na conta selecionada. Transferências e pagamentos de fatura ficam separados de receitas e despesas.

## Persistência e segurança

A migração 0004 acrescenta tabelas para planos de parcelas e ajustes financeiros. Compras existentes participam dos ciclos por meio da visão de cobranças. A visão de caixa é usada pelo relatório de caixa e pelo cálculo do saldo das contas, inclusive para respeitar a data de referência de abertura de cada conta.

O Prisma grava os registros. Consultas agregadas e o controle de concorrência usam valores vinculados. Os IDs, vínculos e filtros são limitados ao espaço financeiro. A transação serializa os ajustes do espaço para que pagamentos ou estornos concorrentes não usem o mesmo saldo disponível. Os registros de transferência e estorno são preservados no histórico.

Este recorte acompanha ciclos manuais por cartão cadastrado. A conciliação de pagamentos já importados e a leitura de uma fatura externa compartilhada entre cartões dependem das etapas de importação ou integração. [Plano de desenvolvimento](08-plano-sdlc.md) · [Modelo de dados e conciliação](03-dados-e-migracao.md)
