# Previsão mensal de gastos recorrentes

A tela **Previsão de gastos** usa as despesas e assinaturas da agenda existente. É possível criar uma despesa recorrente pela tela, indicar valor fixo ou variável e atribuir um grupo opcional como Casa ou Carro. Os grupos servem como filtros e podem ser atribuídos ou alterados para séries existentes. Receitas e ocorrências puladas ficam fora da previsão de gastos.

Cada ocorrência começa com o valor da série. Um ajuste de data ou valor afeta apenas a ocorrência escolhida. A previsão agrupa as contas pelo mês da data prevista. Quando o lançamento do extrato ocorre no mês seguinte, a conta continua no mês de referência original na previsão, e a agenda de recorrências mostra o lançamento na data efetiva.

O usuário pode confirmar ou corrigir manualmente o valor assim que a cobrança chegar, inclusive quando for zero. Confirmar preserva a estimativa e não cria lançamento ou pagamento. É possível reabrir uma previsão confirmada manualmente. O vínculo com o extrato aceita um único lançamento no mesmo espaço e, quando já houve confirmação manual, exige o mesmo valor para evitar interpretar um pagamento parcial como quitação. A confirmação ou o lançamento vinculado substitui a estimativa no total atualizado. A projeção de saldo por conta fica para uma entrega posterior.

A migração 0008 acrescenta metadados à série e o valor confirmado à ocorrência, preservando os registros existentes. O backend usa os controles de autorização e o bloqueio financeiro da agenda. A validação cobre conciliação entre meses, reabertura, filtragem por grupo e isolamento entre espaços.
