# Etapa intermediária de navegação de faturas

**Status:** implementada antes da importação e do fechamento mensal.

## Fluxo

1. A entrada **Faturas** do menu lateral abre uma tela com grupos por cartão. Cada grupo identifica nome, titular e final do cartão, quando cadastrado. Os grupos podem ser recolhidos.
2. Cada grupo lista as faturas de vários ciclos. Cada linha mostra mês de fechamento, vencimento, situação e valor em aberto, pago ou a favor, conforme o caso. A proposta é abrir no ciclo atual e mostrar o histórico recente, com opção de ampliar o período e consultar os ciclos futuros que já têm parcelas.
3. Selecionar uma fatura abre uma tela própria com identificação do cartão, datas do ciclo, resumo e lançamentos daquela fatura. O detalhe lista compras, parcelas, estornos e pagamentos e mantém as ações de pagar e estornar. Uma compra que ocorreu em novembro e entrou no ciclo de dezembro aparece no detalhe de dezembro.
4. **Voltar para faturas** recupera o período e o grupo aberto. O botão Voltar do navegador e o recarregamento preservam a navegação. A identificação na URL usa o cartão e o mês de fechamento, com autorização do espaço no servidor.

## Alterações diretas

- Criar a lista agrupada por cartão e a tela de detalhe da fatura. Uma fatura quitada ou inteiramente estornada continua visível quando houver movimentos associados ao ciclo. Cartões sem faturas mostram uma mensagem de estado vazio.
- Consultar os resumos por períodos de até 60 meses. Os atalhos carregam os últimos 12 meses, incluindo o atual, ou os próximos 12. Carregar os lançamentos somente ao abrir o cartão e o ciclo selecionados. A identidade é espaço financeiro, cartão e mês de fechamento.

## Alterações indiretas

- Separar as ações de pagamento e estorno da lista atual e reaproveitá-las no detalhe. Após uma gravação, atualizar o detalhe e o resumo usado na lista.
- Adaptar navegação, filtros e estados de carregamento, erro e ausência de resultados no desktop e no celular.
- Reutilizar as consultas e regras de cálculo atuais. A etapa está prevista sem migração do banco. A tela de fluxo de caixa continua usando os registros de pagamento e transferência já existentes.

## Critérios de aceite

- Dois cartões com faturas no mesmo mês permanecem em grupos distintos. O detalhe de um ciclo exclui lançamentos de outro cartão e de outro mês de fechamento.
- O resumo da lista coincide com os totais do detalhe. Um pagamento parcial atualiza os dois pontos.
- Voltar mantém a posição de navegação. Recarregar o detalhe retoma o mesmo cartão e ciclo.
- Testes de integração cobrem agrupamento, correspondência dos totais e isolamento por espaço. O teste de navegador cobre abrir, pagar e voltar, além da apresentação em tela estreita.

[Regras de cálculo já implementadas](10-faturas-e-caixa.md) · [Plano de desenvolvimento](08-plano-sdlc.md)
