# Pluggy e Meu Pluggy — referência para a integração bancária

Referência para a integração bancária opcional do Auto Finance. A API roda na máquina do operador, usa as credenciais da instalação e guarda no PostgreSQL local os campos permitidos. [Arquitetura](04-arquitetura-e-stack.md), [Requisitos](02-requisitos.md).

## 1. Viabilidade e cobertura

O recurso depende de credenciais próprias, consentimento e cobertura do provedor. A publicação do código não distribui chaves nem crava o custo da conta externa. Consulte o guia do Meu Pluggy e a oferta em vigor antes de habilitar a integração. [Guia de uso pessoal](https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use), [Planos](https://www.pluggy.ai/precos), [Cobertura por instituição](https://docs.pluggy.ai/pt/docs/open-finance/institutions-coverage).

Cada fonte associa uma credencial, a autorização do titular e os identificadores retornados pela API. A aplicação mantém essas relações ao conciliar os dados. Para múltiplos titulares, valide separadamente o consentimento, a modalidade permitida e o isolamento de cada origem. O modelo local preserva a titularidade mesmo quando o operador usa apenas importação ou cadastro manual. [FAQ do Meu Pluggy](https://docs.pluggy.ai/pt/docs/get-started/faq).

| Limite | Consequência para a instalação |
| --- | --- |
| Conexões pessoais | Conferir a disponibilidade e o limite da conta no provedor. |
| API REST | Respeitar cotas por endpoint e IP de saída e responder a HTTP 429 com retentativas limitadas. [Limites REST](https://docs.pluggy.ai/pt/reference/rate-limits) |
| Coleta do Open Finance | A cadência e as cotas do banco seguem as regras do provedor e do Open Finance. [Limites operacionais](https://docs.pluggy.ai/pt/docs/open-finance/rate-limits) |

Se a fonte estiver indisponível ou sem cobertura, oferecer lançamento manual e importação de arquivos oficiais. [Dados e migração](03-dados-e-migracao.md).

## 2. Autorização e configuração

1. **Cada titular conecta seus bancos no Meu Pluggy.** Seleciona os produtos de interesse e autoriza no fluxo oficial da instituição.
2. **Cada titular vincula a própria aplicação no Dashboard da Pluggy.** No fluxo pessoal documentado, usa a mesma conta no Meu Pluggy e no Dashboard. Em Aplicações → Demo → Conectar Conta, escolhe **MeuPluggy** e autoriza a leitura das conexões existentes. Escolher diretamente o banco no Dashboard pertence a outra modalidade de conexão.
3. **Registrar os identificadores e a credencial certa.** Para cada titular, guardar a referência à sua aplicação e os `itemId` de suas conexões, obtidos em Itens Conectados. Associar esses itens ao titular correspondente no nosso backend. **`GET /v2/items` retorna 403 no uso pessoal e não pode ser habilitado.** O sistema consulta os itens que já conhece.
4. **Autenticar no servidor local.** `POST /auth` recebe `clientId` e `clientSecret` e devolve `apiKey`. A chave vai no cabeçalho `X-API-KEY` das leituras. Reusar durante sua validade, coordenar a renovação por credencial e manter o segredo no ambiente local protegido. Mascarar cabeçalhos e corpos sensíveis nos logs. Uma falha de credencial pausa apenas a fonte correspondente.

O **Connect Token** é uma credencial de escopo limitado para o widget. Validar a disponibilidade desse fluxo para a modalidade escolhida antes de introduzir configuração na interface. O token de acesso à API e o consentimento bancário têm papéis distintos. [Autenticação](https://docs.pluggy.ai/pt/docs/authentication), [POST /auth](https://docs.pluggy.ai/pt/reference/auth/auth-create).

## 3. Endpoints e paginação

Base REST: `https://api.pluggy.ai`. Enviar JSON para autenticação e validar todas as respostas antes de gravar.

| Endpoint | Uso nesta aplicação |
| --- | --- |
| `POST /auth` | Obter ou renovar a chave do titular. [Referência](https://docs.pluggy.ai/pt/reference/auth/auth-create) |
| `GET /items/{id}` | Conferir a conexão conhecida. Ler `status`, `executionStatus`, `error`, `statusDetail`, `products`, `lastUpdatedAt`, `consentExpiresAt` e `nextAutoSyncAt` quando disponíveis. [Referência](https://docs.pluggy.ai/pt/reference/items/items-retrieve) |
| `GET /accounts?itemId=…` | Descobrir contas daquele item. Paginação por `page` e `totalPages`. `GET /accounts/{id}` serve para diagnóstico pontual. [Listagem](https://docs.pluggy.ai/pt/reference/account/accounts-list), [Detalhe](https://docs.pluggy.ai/pt/reference/account/accounts-retrieve) |
| `GET /v2/transactions?accountId=…` | Ler compras e movimentações da conta. `accountId` é obrigatório. Consumir `results` e seguir `next` até `null`. [Referência](https://docs.pluggy.ai/pt/reference/transaction/transactions-list-by-cursor) |
| `GET /bills?accountId=…` e `GET /bills/{id}` | Listar faturas por conta de crédito, usando `page` e `totalPages`. Consultar uma fatura específica quando necessário. Confirmar disponibilidade no proxy pessoal e no emissor. [Listagem](https://docs.pluggy.ai/pt/reference/bill/bills-list), [Detalhe](https://docs.pluggy.ai/pt/reference/bill/bills-retrieve) |

**Usar `/v2/transactions` desde o início.** O guia do Meu Pluggy ainda exemplifica `GET /transactions`, mas a referência oficial declara o endpoint antigo obsoleto. Aplicações criadas a partir de 2 de junho de 2026, horário de Brasília, recebem `410 ENDPOINT_DEPRECATED` no endpoint antigo. Para as aplicações anteriores, a retirada está documentada para 31 de dezembro de 2026. [Referência de paginação e migração](https://docs.pluggy.ai/pt/reference/basic-concepts).

- **Cursor.** `next` já é a query string com os filtros e o cursor. Anexá-la como recebida ao caminho fixo `/v2/transactions`. `after` é opaco. Uma página vazia com `next` ainda deve ser seguida. A referência indica páginas de até 500 registros.
- **Janela da transação.** `dateFrom` e `dateTo` filtram a data do lançamento e usam `YYYY-MM-DD`. São úteis para a carga inicial e para reavaliar períodos. `createdAtFrom`, em UTC, busca novos registros na Pluggy mesmo se a data da compra for antiga. Ele é um cursor temporal de criação, sem cobertura geral de atualizações ou exclusões. `createdAtFrom` e `dateFrom` são mutuamente exclusivos.
- **Filtros retirados na v2.** Filtrar por `billId`, `type` e `operationType` no backend ou PostgreSQL. O vínculo de fatura vem em `creditCardMetadata.billId`. `ids` permite consultar até 500 IDs na mesma conta, útil para atualizar registros apontados por eventos.
- **Consultas da interface.** O navegador lê nossa base normalizada. O backend usa a Pluggy para sincronizar dados, sem fazer uma chamada externa a cada abertura de extrato, gráfico ou aba. [Conceitos básicos](https://docs.pluggy.ai/pt/reference/basic-concepts), [Listagem v2](https://docs.pluggy.ai/pt/reference/transaction/transactions-list-by-cursor), [Transações e registros retroativos](https://docs.pluggy.ai/pt/docs/products/transactions).

## 4. Campos financeiros e casos de cartão

| Objeto | Campos e decisões de modelagem |
| --- | --- |
| Conta | `id`, `itemId`, `type`, `subtype`, nome, moeda, `balance` e metadados necessários para conciliar. `BANK` representa conta bancária e `CREDIT/CREDIT_CARD` representa cartão. `balance` e `bankData.closingBalance` têm semânticas distintas. O segundo pode incluir saldo bloqueado. [Conta](https://docs.pluggy.ai/pt/docs/products/accounts) |
| Conta de crédito | `creditData.creditLimit`, `availableCreditLimit`, `balanceDueDate`, marca e `holderType` quando transmitidos. Em Open Finance, `balance` do cartão é limite usado. Usar `totalAmount` da fatura para seu total oficial. `balanceCloseDate` é `null` em Open Finance, portanto registrar a regra de fechamento no app quando necessário e marcar a previsão como estimativa. [Conta](https://docs.pluggy.ai/pt/docs/products/accounts) |
| Transação | Preservar `id`, `providerId` quando houver, `accountId`, `amount`, `currencyCode`, `date`, `description`, `type`, `status`, `operationType` e metadados de classificação necessários. `PENDING` abrange compras aguardando liquidação, parcelas futuras e outras pendências conforme a conta. `POSTED` representa lançamento liquidado. Em compra internacional, preservar `amountInAccountCurrency` quando informado e usar a moeda correspondente ao comparar com a fatura. [Transações](https://docs.pluggy.ai/pt/docs/products/transactions) |
| Metadados de cartão | `creditCardMetadata` pode trazer `installmentNumber`, `totalInstallments`, `purchaseDate`, `cardNumber`, `payeeMCC` e `billId`. A documentação limita `totalAmount` das parcelas a conectores diretos. `cardNumber` pode variar dentro da mesma conta para adicionais e virtuais. Derivar no máximo os últimos quatro dígitos se úteis. Validar ao importar e persistir só os campos permitidos, excluindo números completos e CPF. [Metadados de cartão](https://docs.pluggy.ai/pt/docs/products/transactions), [Política de dados](05-seguranca.md#dados-necessários-e-retenção) |
| Fatura | `id`, `dueDate`, `totalAmount`, `totalAmountCurrencyCode`, pagamento mínimo quando presente, `payments` e `financeCharges`. Encargos também podem aparecer como transações. Usar valores oficiais para conferência e vincular representações do mesmo evento. [Faturas](https://docs.pluggy.ai/pt/docs/products/credit-card-bills) |

**Sinais.** No cartão, compras costumam chegar com `amount` positivo porque aumentam a dívida. Pagamentos chegam com valor negativo e estornos podem reduzir a dívida. Em conta bancária, débitos saem do saldo. A conversão para a convenção interna depende do tipo da conta e da natureza da transação. Preservar o valor original e converter para centavos com aritmética decimal. Classificar pagamento de fatura, estorno e cashback de forma explícita quando os dados permitirem. `PAGAMENTO_FATURA` pode identificar inclusive uma transação derivada pela Pluggy de um pagamento já informado na fatura. A mesma baixa pode aparecer na conta bancária, no cartão e em `payments`. Reconciliar as fontes e contar consumo e saída de caixa nas visões corretas. [Transações e sinais](https://docs.pluggy.ai/pt/docs/products/transactions), [Faturas e pagamentos](https://docs.pluggy.ai/pt/docs/products/credit-card-bills).

**Datas.** Guardar o valor bruto e distinguir data de lançamento, `purchaseDate`, fechamento estimado, vencimento e pagamento. O guia descreve `date` como postagem em ISO 8601. Instantes reais são interpretados em `America/Sao_Paulo` para exibição e períodos financeiros. Campos de data civil, como vencimento, devem preservar o dia transmitido quando serializados como meia-noite. Confirmar o comportamento para cada emissor com exemplos reais, inclusive compras próximas da virada do dia. [Transações](https://docs.pluggy.ai/pt/docs/products/transactions), [Esquema da fatura](https://docs.pluggy.ai/pt/docs/products/credit-card-bills).

**Fatura aberta e parcelas.** A instituição pode transmitir a fatura apenas após o fechamento ou mesmo após o vencimento. Parte das compras parceladas pode aparecer só quando a fatura correspondente estiver disponível. Usar o `billId` recebido para relacionar compras e faturas. A fatura aberta calculada pelo app fica identificada como estimativa. Se a cobertura de parcelas futuras for incompleta, mostrar o que foi transmitido e distinguir qualquer projeção própria dos lançamentos confirmados. Uma parcela recebida substitui a expectativa correspondente. Uma compra integral informativa não deve entrar junto com suas parcelas. [Considerações de Open Finance](https://docs.pluggy.ai/pt/docs/open-finance/considerations-faq), [Parcelas de cartão](https://docs.pluggy.ai/pt/docs/products/credit-card-installments).

**Assinaturas por cartão.** Usar a conta de crédito externa como âncora. Associar o instrumento específico pela identificação de cartão disponível e mapeamento confirmado. Titular, instrumento e fatura são conceitos diferentes. Uma conta pode ter vários instrumentos e a API pode omitir o final em parte dos lançamentos. Nesses casos, mostrar a conta ou pedir classificação no aplicativo. O agrupamento de assinaturas é mantido no nosso domínio. [Contas](https://docs.pluggy.ai/pt/docs/products/accounts), [Transações de cartão](https://docs.pluggy.ai/pt/docs/products/transactions).

## 5. Sincronização proposta para a instalação local

O item da aplicação pessoal funciona como proxy dos dados já coletados na conexão de origem. Uma tarefa local pode consultar o item enquanto o Auto Finance estiver em execução. Use a última leitura confirmada para retomar o trabalho após interrupção. [Guia do Meu Pluggy](https://meu.pluggy.ai/api-guide), [Ciclo de vida de Item](https://docs.pluggy.ai/pt/docs/connections/item).

1. **Carga inicial.** Registrar as conexões autorizadas e listar contas. Permitir confirmação do mapeamento de instrumentos. Importar movimentos e faturas disponíveis no intervalo definido e informar o período que chegou de cada fonte.
2. **Coleta periódica.** Executar por item, com uma tarefa por conexão de cada vez. Verificar o estado do item, atualizar as contas e faturas, ler criações desde o último marco confirmado com pequena sobreposição e conferir novamente as janelas de fatura ativa e de fechamentos recentes. Definir o tamanho e a frequência dessas janelas após medir o que cada emissor altera depois do fechamento. A consulta de criações captura lançamentos datados retroativamente. A releitura dos ciclos captura alterações de linhas antigas, status e `billId`.
3. **Persistência atômica.** Identificar execução, conta, consultas e páginas recebidas. Aplicar no PostgreSQL apenas os campos normalizados e permitidos por conta. Avançar cada marco apenas após obter as páginas necessárias e confirmar a gravação. Repetir a janela em caso de erro. Manter relatório de último sucesso, atraso, quantidade de linhas e falhas com metadados filtrados. Payloads brutos ficam fora da base e dos logs. [Política de dados](05-seguranca.md#dados-necessários-e-retenção).
4. **Atualização na interface.** Mostrar horário da última coleta validada pelo site e horário informado pelo provedor quando disponível. “Buscar dados disponíveis” pode solicitar uma consulta ao nosso backend com limite de frequência. A disponibilidade de novas compras no banco continua sujeita ao ciclo da Pluggy e à instituição.

### Reconciliação e identidade

- Usar identificadores internos para cartões, faturas e transações. Relacionar os identificadores externos com a fonte autorizada, a instituição e o instrumento. Emissor, descrição, valor ou final do cartão podem coincidir entre instrumentos distintos.
- Um `id` da Pluggy pode mudar quando a transação é removida e recriada após ajustes de data, valor ou descrição. Usar o `providerId` da instituição, quando disponível e consistente, como âncora por conta. Em conectores diretos ele é nulo. Confirmar seu preenchimento no proxy pessoal. Preservar múltiplos IDs externos associados à mesma transação interna só após reconciliação confiável.
- Se faltar identificador estável, cruzar conta, data, descrição, valor, tipo, parcela e ciclo. Conservar compras legítimas iguais e encaminhar correspondências ambíguas à revisão. Manter categoria, notas, rateio e plano doméstico vinculados ao registro interno.
- Ausência num resultado, inclusive HTTP 200 vazio, pode indicar janela, atraso, falha parcial, expiração ou alteração do banco. A releitura de uma janela por si só não é prova de exclusão. Quando houver remoção identificada, marcar o evento idempotentemente, preservar o histórico e reconciliar a eventual substituição. [Ciclo de transações de cartão](https://docs.pluggy.ai/pt/docs/products/credit-card-statement-cycle), [Transações](https://docs.pluggy.ai/pt/docs/products/transactions).

### Webhooks como evolução

O guia pessoal informa que o proxy replica eventos. A referência descreve `item/updated`, `item/error`, `item/deleted`, `transactions/created`, `transactions/updated` e `transactions/deleted`. O agendador com leituras e reconciliação é a proposta inicial, com validação dos casos retroativos. Webhook é candidato se a prova mostrar necessidade de identificar alterações e remoções com mais precisão. Verificar no plano pessoal a disponibilidade do cadastro e da assinatura antes de depender deles. [Uso pessoal](https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use), [Webhooks](https://v2.docs.pluggy.ai/pt/docs/developer-tools/webhooks-ref).

Se adotado, usar HTTPS, validar a origem por meio do mecanismo oficial disponível e verificar a assinatura `X-Pluggy-Signature` com o corpo bruto quando habilitada. Associar o evento a uma conexão conhecida, registrar/processar de modo idempotente e fazer nova leitura dos dados afetados. `createdTransactionsLink` pode trazer cursor e filtro de criação, mas qualquer leitura deve ficar restrita à API oficial e à conta esperada. Eventos de atualização permitem buscar `ids`, e deletados sinalizam remoções sem mapear para o substituto. Persistir o evento e confirmar recebimento antes do trabalho pesado. Manter uma coleta periódica para recuperar lacunas. [Referência de webhooks e entregas](https://docs.pluggy.ai/en/reference/webhooks), [Assinatura e reenvios](https://v2.docs.pluggy.ai/pt/docs/developer-tools/webhooks-ref), [Eventos de transações](https://docs.pluggy.ai/pt/docs/products/transactions).

## 6. Limites, erros e consentimento

| Situação | Tratamento no app |
| --- | --- |
| HTTP 400 ou `410 ENDPOINT_DEPRECATED` | Mostrar falha de integração, capturar `codeDescription` e revisar endpoint/parâmetros. Repetir só após corrigir a causa. |
| HTTP 401 | Renovar a API Key uma vez se estiver vencida. Se `POST /auth` rejeitar a aplicação ou as credenciais, suspender a fonte e indicar revisão da configuração. |
| HTTP 403 | Verificar plano, recurso e autorização. Para listagem geral de itens no Meu Pluggy, usar os `itemId` já registrados. |
| HTTP 404 em item/conta | Conferir se o recurso foi removido ou o vínculo mudou na renovação. Preservar o histórico enquanto o mapeamento é revisado. |
| HTTP 429, timeout ou 5xx | Respeitar `Retry-After` ou `RateLimit-Reset` quando presentes e usar novas tentativas limitadas com espera progressiva. Manter o último ponto de coleta confirmado. |
| Item com sucesso parcial ou dados incompletos | Conferir `statusDetail` por produto. Não interpretar falhas como fatura zerada, conta sem saldo ou cartão excluído. |
| Autorização expirada | Sinalizar ação do titular e suspender novas leituras daquela fonte. Distinguir expiração de API Key, consentimento da instituição e autorização da aplicação proxy. |

Os limites REST são contados por endpoint, IP de saída e janela de tempo. As cotas operacionais de Open Finance também dependem do titular, instituição e produto. Consultar os limites vigentes, evitar conexões redundantes, limitar concorrência e retomar leituras de forma idempotente. [Erros HTTP](https://docs.pluggy.ai/pt/reference/error-codes), [Limites REST](https://docs.pluggy.ai/pt/reference/rate-limits), [Limites operacionais](https://docs.pluggy.ai/pt/docs/open-finance/rate-limits).

**Diagnóstico de cobertura.** Se o cartão não aparecer, verificar o item, os produtos retornados e a autorização feita no banco. A referência também descreve `GET /items/{id}/resources` para conferir os recursos declarados pela instituição num item de Open Finance. O uso desse diagnóstico no proxy do Meu Pluggy fica sujeito à disponibilidade na prova. Se a diferença persistir, registrar a instituição, o período, o tipo de dado ausente e os IDs técnicos para o canal oficial de suporte, mantendo informações sensíveis fora dos logs e do repositório. [Recursos do item](https://docs.pluggy.ai/pt/docs/connections/item), [Erros e validações](https://docs.pluggy.ai/pt/docs/connections/errors-validations), [Suporte](https://v2.docs.pluggy.ai/en/docs/get-started/contact).

**O acesso da aplicação proxy dura um ano**, conforme o guia pessoal, separado dos consentimentos dos bancos. `consentExpiresAt` é a verificação documentada para o proxy. Depois da expiração, contas e transações podem voltar vazias enquanto o item ainda mostra o último status `UPDATED`. Na atualização seguinte pode aparecer `LOGIN_ERROR` com `USER_AUTHORIZATION_EXPIRED`. A renovação acontece pelo fluxo MeuPluggy no Dashboard e pode gerar novos `itemId`. Reconferir IDs e reconciliar ao histórico, com revisão para vínculos incertos. Desativar a coleta no nosso site e revogar autorização na origem são operações separadas. Manter o histórico conforme a política do app e a autorização aplicável. [Expiração e renovação](https://docs.pluggy.ai/pt/docs/guides/meu-pluggy-personal-use), [Item](https://docs.pluggy.ai/pt/reference/items/items-retrieve), [Estado da Pluggy](https://status.pluggy.ai/).

## 7. Prova de integração e critérios de aceitação

| Etapa | Evidência necessária |
| --- | --- |
| Configuração autorizada | Validar o tipo de conta, o escopo dos acessos e as condições do provedor para cada fonte da instalação. |
| Suíte automatizada | Fixtures sintéticas para instrumentos distintos, campos nulos, paginação, erros 401/429/5xx, expiração, troca de ID, transação retroativa, compras coincidentes, parcelas e faturas oficiais ou estimadas. |
| Sandbox | Usar Pluggy Bank para verificar formato de leitura, credenciais de teste e falhas documentadas. Sandbox valida o contrato básico. Cobertura, consentimento e transmissão de fatura dos cartões reais exigem outro teste. [Sandbox oficial](https://docs.pluggy.ai/pt/docs/guides/sandbox) |
| Leitura autorizada | Em cada fonte habilitada, verificar instrumento, período disponível, vínculo com fatura, data e sinal. |
| Sincronização local | Observar a atualização com o serviço em execução e o navegador fechado. Parar o serviço e conferir que ele retoma a partir da última leitura confirmada. |
| Conferência com emitentes | Comparar compras, fatura fechada, vencimento, pagamentos e parcelas com os registros das instituições nas fontes verificadas. |

O [plano de dados e migração](03-dados-e-migracao.md) cobre entradas manuais e importação. As [decisões de segurança](05-seguranca.md) definem o armazenamento de credenciais. A [CI](06-testes-e-ci.md) valida o adaptador com dados sintéticos.
