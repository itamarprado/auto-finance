# Requisitos do Auto Finance

O Auto Finance é um organizador de finanças pessoais com interface web e execução local. A [arquitetura](04-arquitetura-e-stack.md) descreve a instalação e o [plano de dados e migração](03-dados-e-migracao.md) descreve a importação opcional.

## 1. Premissas e critérios de sucesso

- **Escopo.** Acompanhar contas e cartões, organizar assinaturas e recorrências por cartão, ratear despesas e planejar gastos por contexto com valores informados manualmente.
- **Premissas.** Interface no navegador, API e banco da instalação local, BRL e datas de calendário brasileiras. O modelo distingue titulares de cartões, participantes de rateios, permissões de acesso e consentimentos bancários.
- **Sucesso no dia a dia.** Em um mês acompanhado, é possível conferir cada saldo e fatura, descobrir o que aumentou, saber o que vence e corrigir divergências sem tratar os mesmos movimentos duas vezes.
- **Recuperação e integração.** O backup permite recuperar o histórico em outra instalação local. Uma integração opcional com credenciais próprias pode ser retomada depois de uma falha, sem duplicar movimentos.

## 2. Requisitos funcionais propostos

**Base** forma um primeiro recorte operável. **Planejamento** estende a base ao acompanhamento futuro. **Primeira entrega** reúne os fluxos de assinatura, rateio e planejamento. **Extensão** depende de validação de uso. A sincronização externa tem critérios próprios.

| ID | Recorte | Capacidade | Verificação |
| --- | --- | --- | --- |
| RF-01 | Base | Cadastrar conta bancária, carteira, pessoa e cartão manual, com saldo inicial datado, conta pagadora, limite, fechamento e vencimento conforme o tipo. Identificar titular, arquivar e escolher participação nos totais. | O arquivamento preserva a consulta de períodos anteriores. Os cartões ficam disponíveis com seus respectivos titulares e ciclos, e a dívida de um titular pode ser excluída do caixa pessoal do outro. |
| RF-02 | Base | Registrar e editar receita, despesa, agendamento, estorno e transferência própria. Distinguir data, valor, conta, origem, situação e campos de organização. | Uma transferência afeta as duas contas uma vez, tem vínculo navegável e fica fora da receita e despesa consolidadas. |
| RF-03 | Base | Pesquisar e filtrar extrato por período, conta, cartão, categoria, tag, tipo, origem e situação. Distinguir extrato por compra e fluxo de caixa. | A soma e o detalhamento do conjunto filtrado usam os mesmos registros. Uma linha pode mostrar sua origem, situação e vínculos. |
| RF-04 | Base | Organizar com categorias e subcategorias, várias tags, descrição editável, observações, exclusão de totais e indicação de itens sem categoria. | Reclassificar altera os relatórios pertinentes. Ocultar dos totais preserva o saldo individual. Categoria arquivada continua reconhecível no histórico. |
| RF-05 | Base | Atribuir compras a faturas, acompanhar o fechamento e registrar pagamentos parciais, totais ou antecipados, com vínculo reversível ao débito bancário. Mostrar fatura, saldo a pagar e limite como números separados. | R$ 600 de fatura com R$ 250 pagos mostra R$ 350 a pagar. Importar o pagamento real já registrado permite conciliá-lo sem segundo débito. |
| RF-06 | Base | Criar compra parcelada pelo total, primeira parcela e quantidade. Acompanhar progresso, valor restante e fim do plano. | Todas as parcelas recompõem o total em centavos. A fatura de cada mês recebe apenas as parcelas daquele ciclo. |
| RF-07 | Base | Importar arquivos de extrato e fatura, com escolha da conta ou do cartão, prévia, validação, revisão e histórico por lote. Priorizar CSV e avaliar OFX conforme as amostras disponíveis. | Repetir o mesmo lote confirmado cria zero novas movimentações. Linhas rejeitadas têm motivo, e o usuário pode corrigir apenas as afetadas. |
| RF-08 | Base | Sugerir pares para conciliar movimentações, previsões, transferências e pagamentos. Permitir manter ambos, vincular ou desfazer o vínculo conforme o caso. | Dois lançamentos de mesmo valor e data podem coexistir. Vincular um par preserva seus dados de origem e explica a alteração nos totais. |
| RF-09 | Base | Exibir saldos por conta, resultado mensal e próximos vencimentos. Oferecer relatório por categoria e período com detalhamento e exportação. | Cada total informa período, base e inclusão de pendências. O valor pode ser conferido nas linhas correspondentes. |
| RF-10 | Base | Exportar dados para análise e gerar backup completo restaurável. | Após restaurar, o extrato, saldos, ciclos, metadados e vínculos apresentam os mesmos resultados. |
| RF-11 | Planejamento | Cadastrar recorrências com frequência, início, fim e exceções. Editar só a ocorrência, dali em diante ou a série. Conciliar com o realizado. | O salário previsto cede lugar ao recebimento confirmado. Alterar as próximas ocorrências preserva as já efetivadas. |
| RF-12 | Planejamento posterior à previsão de gastos | Projetar caixa e compromissos, com horizonte mensal e detalhamento por data, conta e origem. Exibir saldo livre após compromissos e, quando houver, reservas de metas. | Um salário previsto entra na data correta. Uma compra parcelada entra no caixa apenas pelo pagamento previsto da fatura correspondente. |
| RF-13 | Planejamento | Acompanhar metas de economia e limites de gastos, com escopo, período, valor realizado e previsto. Controlar aportes declarados e progresso por categoria conforme a meta. | Um aporte anotado na meta muda o progresso, e o saldo bancário deriva dos movimentos da conta. Um limite de cartão usa o ciclo designado. |
| RF-14 | Planejamento | Definir regras locais para categorizar, renomear ou etiquetar lançamentos de arquivos e integrações. Mostrar condições, prévia, conflitos e desfazer aplicação retroativa. | Uma regra reaplicada tem o mesmo efeito e não sobrescreve silenciosamente uma correção manual. |
| RF-15 | Planejamento | Acompanhar assinaturas, marcar situação e vincular a uma recorrência ou cobrança real quando reconhecida. Permitir trocar o cartão das próximas ocorrências. Alertas locais de fatura, compromissos ou orçamento. | Um serviço identificado e também cadastrado aparece uma vez na projeção. A troca de cartão passa a valer a partir da ocorrência escolhida e preserva o histórico. O comportamento dos alertas com o app fechado é explícito. |
| RF-16 | Integração opcional | Sincronizar as contas e cartões autorizados pelo operador, usando credenciais próprias e as modalidades do provedor. Mostrar última atualização, consentimento e falhas por fonte. | Cartões com o mesmo emissor ou final permanecem distintos. Repetir uma leitura mantém a contagem, e falha de uma fonte preserva seu histórico e a atualização das demais. |
| RF-17 | Extensão | Investimentos, proventos, dívidas, patrimônio e evolução, com cadastro manual quando útil. | Diferenciar posição, movimentação e valor de mercado, além de impedir que aporte e resgate inflem receitas ou despesas. |
| RF-18 | Extensão | Captura rápida, perguntas por linguagem natural, simulação de compras ou outros recursos personalizados. | Simulações mantêm o histórico intacto. Um assistente usa as mesmas operações, permissões e regras do restante do app. |
| RF-19 | Primeira entrega | Ratear uma despesa entre pessoas e registrar acertos ou reembolsos, inclusive parciais. Distinguir pagador, partes de responsabilidade e obrigação com o cartão. | Uma compra de R$ 240 dividida ao meio mantém uma cobrança na fatura e duas partes de R$ 120. Vincular um PIX de reembolso ao rateio baixa o saldo entre as pessoas e preserva a despesa original. |
| RF-20 | Primeira entrega | Na tela Assinaturas, oferecer **Visão geral** e uma opção de navegação visível para cada cartão cadastrado, em abas ou cards selecionáveis. Na visão geral, identificar o cartão de cobrança ao lado de cada assinatura. Na opção do cartão, mostrar suas assinaturas e o subtotal correspondente. | Com assinaturas em dois cartões, a visão geral exibe as duas listas em conjunto, com o cartão identificado em cada linha. Ao selecionar um cartão, aparecem somente suas assinaturas. Cobranças em conta ou ainda sem cartão identificado aparecem na visão geral com sua origem. Dois cartões que compartilham fatura podem ser consultados individualmente. |
| RF-21 | Primeira entrega | Prever gastos mensais por despesa recorrente nomeada pelo usuário, como Conta de Luz, Conta de Internet e Conta de Água. Cada despesa pode funcionar sozinha ou pertencer a um grupo opcional. Permitir valor fixo ou estimado, ajuste em um mês e confirmação manual do valor, com vínculo ao extrato quando disponível. | Uma conta de luz estimada em R$ 180 e confirmada em R$ 205 exibe a variação de R$ 25 e entra uma vez com R$ 205 na previsão atualizada. Uma conta sem grupo aparece no mês, e um ajuste pontual preserva os outros meses. |
| RF-22 | Primeira entrega | Permitir organizar instrumentos de titulares distintos na mesma instalação local. Representar titularidade, participação em rateios, autorização de acesso e consentimento bancário separadamente. | Cada instrumento mantém seu titular. Permissões e consentimentos podem ser alterados independentemente. |

## 3. Requisitos de qualidade e integridade

| ID | Requisito | Evidência de aceitação |
| --- | --- | --- |
| RQ-01 | Oferecer interface web responsiva em loopback. Manter histórico e lançamentos manuais disponíveis durante indisponibilidade de uma integração. | O navegador da máquina local consulta dados já gravados e o estado da sincronização. Após perder a confirmação de uma gravação, é possível conferir o resultado antes de repetir. |
| RQ-02 | Calcular dinheiro com precisão exata em centavos e arredondamento previsível. Distinguir data de compra, competência do relatório, vencimento, pagamento e registro. | Virada de ano, fevereiro e compra de R$ 100,00 em três parcelas produzem resultados estáveis. |
| RQ-03 | Gravar operações vinculadas de forma indivisível e permitir repetição segura de importações. | Fechar o app durante a gravação de uma transferência deixa duas pontas válidas ou nenhuma. Interromper uma importação é recuperável. |
| RQ-04 | Mostrar origem de lançamentos, precedência de dados, vínculos, ajustes e composição dos totais. | É possível explicar uma divergência sem inferir pelo nome da categoria ou pelo valor exibido. |
| RQ-05 | Proteger PostgreSQL, documentos, sessões e segredos no ambiente local. Autorizar operações financeiras no backend e reter os campos necessários. O modelo inicial exclui CPF, PAN completo, CVV, PIN e credenciais bancárias. | Importação e integração filtram os campos antes de persistir. Credenciais ficam no servidor local, fora do build, logs e exportações. |
| RQ-06 | Gerar backup cifrado, versionado e restaurável do banco e dos anexos necessários, com cópia independente do ambiente principal. | A restauração em ambiente separado recupera histórico, saldos, faturas e vínculos. A exportação em CSV permanece um recurso separado. |
| RQ-07 | Permitir evolução sem duplicar regras entre extrato, faturas, relatórios e futuras integrações. | Uma nova origem de transações preserva os mesmos resultados para entradas equivalentes. Uma nova visão consegue explicar de onde vêm seus totais. |
| RQ-08 | Usar terminologia e formatação pt-BR, navegação por teclado e estados de erro, vazio, pendente e sincronização compreensíveis. | Datas e valores são inequívocos. Estimativas e avisos podem ser identificados também por texto. |
| RQ-09 | Exigir autenticação para as operações financeiras, usar sessões revogáveis e verificar a associação ao espaço financeiro no servidor. | Identidade anônima, sem acesso ao espaço ou com sessão revogada tem as operações financeiras recusadas. |
| RQ-10 | Validar cada revisão de PR com lint, tipos, testes unitários, integração com PostgreSQL e E2E no navegador. Proteger o merge na branch principal e usar dados sintéticos no pipeline. | Um PR com teste obrigatório falhando fica impedido de entrar em `main`. Uma revisão corrigida passa pelos testes do site e da API construídos pelo pipeline. |
| RQ-11 | Aplicar SSDLC com modelagem de ameaças, SAST, SCA, detecção de segredos e DAST passivo em ambiente isolado. Usar ferramentas gratuitas e bloquear gastos adicionais de CI. | A base demonstra a execução dos checks e detecção de achados sintéticos. A publicação exige revisão aprovada, DAST concluído e falhas graves corrigidas ou mitigadas conforme a política de triagem. |

Os critérios de proteção estão em [Segurança do organizador financeiro](05-seguranca.md). As fases, ferramentas e bloqueios estão no [plano de desenvolvimento seguro](08-plano-sdlc.md) e no [plano de testes e CI](06-testes-e-ci.md).

## 4. Conceitos que precisam existir na especificação

- **Movimentação efetivada, lançamento pendente e ocorrência projetada.** A previsão aponta para a entidade que a originou. Quando o fato ocorre, o vínculo impede que os dois contem juntos. A política de baixa automática em data agendada é uma decisão de produto.
- **Conta, cartão, compra, ciclo e pagamento.** Uma compra consome ou ocupa parte do limite. Um pagamento vincula dinheiro da conta ao saldo devedor do ciclo. Um estorno precisa apontar à compra ou ao ajuste correspondente quando a origem permite.
- **Registro de origem e organização pessoal.** Guardar separadamente a descrição/identidade de origem e a descrição, categoria, notas ou tags revisadas. Uma reimportação atualiza dados externos segundo sua precedência e preserva o trabalho de organização.
- **Saldo de referência.** Para conta manual, saldo inicial datado e movimentos efetivados. Para dados conectados, saldo do provedor e data de referência, com uma explicação para os movimentos ausentes ou posteriores. A compatibilidade entre esses dois métodos precisa de definição explícita.
- **Transferência, aporte, resgate e pagamento de fatura.** Têm significado próprio e efeitos diferentes em saldo, consumo e fluxo. A categoria por si só não deve comandar o efeito financeiro.
- **Série, parcela e assinatura.** Guardar identidade estável da ocorrência para tratar adiamento, exceção, pagamento em outra data e reconciliação. Detecção automática sugere a série e precisa de referência rastreável.
- **Exportação e backup.** Exportação serve para análise ou troca de dados. Backup precisa representar também regras, configurações, mapeamentos, vínculos e os anexos incluídos na política escolhida.

## 5. Cenários de referência

Todos os valores abaixo são fictícios. Servem para fechar decisões antes da implementação.

| Cenário | Resultado esperado |
| --- | --- |
| PIX de R$ 200 da conta corrente para a própria poupança | Corrente −R$ 200, poupança +R$ 200, efeito zero no saldo agregado e nos totais de consumo. |
| Compra de R$ 300 em 28/11, com vencimento em 10/12 e pagamento em 12/12 | Novembro na base de compra, dezembro na base por vencimento e saída efetiva em 12/12 no caixa. A base escolhida é visível. |
| Compra de R$ 100 em três parcelas | A soma é R$ 100. Uma política possível é R$ 33,33 + R$ 33,33 + R$ 33,34. Definir onde fica o centavo residual e aplicar a regra em todas as visões. |
| Fatura de R$ 600 com pagamento de R$ 250 e estorno de R$ 50 apropriado ao mesmo ciclo | Restam R$ 300 a pagar. O estorno e o pagamento continuam distinguíveis e o estorno não vira entrada de salário ou receita comum. |
| Fatura estimada de R$ 400 passa a confirmada em R$ 420 | A previsão substitui a estimativa, mantém data e fonte da atualização e permite explicar os R$ 20 de diferença quando se conhece a composição. |
| Duas compras reais de R$ 35 no mesmo dia e conta | Permanecem duas se a origem distingue os eventos. Se o arquivo for ambíguo, a tela de revisão permite manter as duas. |
| Cartão afeta o limite total em R$ 900 e só R$ 300 vencem neste mês | O resumo exibe ambos sem usar R$ 900 como saída de caixa integral do mês. |
| Mensalidade prevista em recorrência, catálogo de assinatura e extrato bancário | A próxima cobrança aparece uma vez; com confirmação do banco, aparece realizada uma vez. |
| Recorrência no dia 31, em fevereiro, com alteração futura | Aplicar política explícita de último dia ou omissão. A regra conserva a data escolhida para meses posteriores e preserva ocorrências já encerradas. |
| Novo saldo de referência hoje com extrato histórico anterior | O histórico pode aparecer para análise sem ser somado pela segunda vez ao saldo de hoje. |

## 6. Sequência proposta e pontos de decisão

1. **Validar integrações opcionais.** Testar uma credencial própria e confirmar a modalidade de uso antes de ampliar a cobertura. A prova de leitura e atualização está em [Dados e migração](03-dados-e-migracao.md).
2. **Fechar as regras da primeira entrega.** Validar conta e cartão manual, diferença entre caixa e consumo, ciclo de fatura, data de pagamento, deduplicação, recorrências, importação e restauração.
3. **Percorrer um ciclo mensal.** Usar o futuro app em paralelo num mês com saldo inicial conhecido, faturas, transferências e pelo menos uma reimportação. Ajustar as regras a partir das divergências identificadas.
4. **Entregar planejamento financeiro.** Projetar recorrências e assinaturas por cartão, ratear compras, conciliar reembolsos e agrupar previsões por contexto.
5. **Avaliar as extensões.** Simulações, automações para arquivos e previsão de dívidas seguem a prioridade de uso, com impacto técnico detalhado na [proposta de arquitetura](04-arquitetura-e-stack.md).

| Decisão pendente | O que muda no projeto |
| --- | --- |
| Quais formatos de importação terão suporte inicial? | Define o mapeamento de colunas, a visualização de prévia e os casos de teste. |
| Quais recursos o provedor devolve para uma conexão autorizada? | Define a cobertura da sincronização e quando usar lançamento manual ou importação. |
| Quanto do histórico deve ser importado? | Define a data de corte, o tratamento do saldo inicial e a conferência dos vínculos. |
