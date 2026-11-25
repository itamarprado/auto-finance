# Plano de desenvolvimento seguro do Auto Finance

O objetivo é distribuir o código de um organizador financeiro com interface web e execução local. A primeira etapa integra React, Fastify, PostgreSQL e verificações de segurança com dados sintéticos. Os incrementos seguintes acrescentam migrações, controles de acesso e fluxos financeiros.

O ciclo de desenvolvimento seguro (SSDLC) inclui modelagem de ameaças, análise de código e dependências, testes dinâmicos e resposta a incidentes. A integração bancária segue como opção com credenciais próprias. [NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final), [Requisitos](02-requisitos.md), [Integração Pluggy](07-pluggy-integracao.md).

## Fase 0 Planejamento e requisitos

1. **Fixar a primeira entrega.** Incluir o espaço compartilhado, contas, cartões, extrato, faturas, importação, rateios e reembolsos, assinaturas por cartão e previsão mensal de gastos recorrentes. Usar os requisitos existentes como critérios de aceitação. Planejar metas, regras de categorização e alertas após os fluxos centrais, com investimentos e assistente por IA no backlog de extensões.
2. **Transformar a ordem abaixo em tarefas.** Abrir cada tarefa de implementação com objetivo, dependência, requisitos afetados e exemplo verificável. Começar pelo PR da base técnica. Dividir mudanças maiores por fluxo que possa ser demonstrado pelo navegador.
3. **Investigar a integração opcional.** Verificar se a modalidade do provedor permite a configuração da instalação local e preparar fixtures. Dados reais exigem consentimento e controles de segurança já verificados.
4. **Definir os dados permitidos e o custo.** Autorizar no modelo apenas os campos necessários à conciliação e à identificação dos cartões. CPF e credenciais bancárias ficam no fluxo oficial. Escolher ferramentas de análise executáveis sem licença paga, conta de scanner ou teste com cobrança. Os jobs hospedados usam apenas cota incluída com cobrança adicional bloqueada. [Política de dados](05-seguranca.md), [Ferramentas e custos](06-testes-e-ci.md).

**Conclusão da fase.** A primeira etapa tem escopo verificável. O backlog registra decisões sobre autenticação, ambiente local e integração externa. [Requisitos](02-requisitos.md), [Integração](07-pluggy-integracao.md), [Importação](03-dados-e-migracao.md).

## Fase 1 Projeto da base

1. **Definir a estrutura do repositório.** Manter React, TypeScript e Vite na interface e Fastify com TypeScript na API. Usar um único repositório, com módulos para interface, API e regras financeiras, e comandos comuns para desenvolvimento, testes e build. Registrar como iniciar o PostgreSQL de desenvolvimento, aplicar migrações e carregar dados sintéticos.
2. **Desenhar o modelo mínimo.** Separar conta de acesso, espaço compartilhado, titular, conta bancária, conta de crédito, instrumento de cartão e origem do lançamento. Reservar as relações entre compra, fatura, pagamento e parcela. Detalhar as tabelas quando cada fluxo entrar. Toda consulta e gravação financeira usa o espaço autorizado no servidor.
3. **Fixar as regras de domínio iniciais.** Persistir valores em centavos, definir a distribuição de resíduos no parcelamento e no rateio e distinguir data civil, instante de registro e vencimento. Definir quais registros entram nas visões de consumo, responsabilidade e caixa. Usar os exemplos já especificados para testar essas regras.
4. **Definir fronteiras e ambientes.** A API valida identidade, autorização e entrada antes de acessar o banco. Interface e API compartilham a mesma origem em loopback. Desenvolvimento, CI e instalação recebem bancos e credenciais próprios.
5. **Modelar ameaças antes de criar entidades e rotas.** Desenhar navegador, API, banco, arquivos, coletor bancário, backups e CI com suas fronteiras de confiança. Priorizar acesso a outro espaço financeiro, vazamento de segredos, exposição em arquivos e logs, adulteração de dados e perda do banco. Para cada risco, registrar um controle e um teste ou procedimento de verificação. Revisar o modelo quando entrar uma nova rota sensível, integração ou origem de arquivos. [Modelo inicial de ameaças](05-seguranca.md), [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).

**Conclusão da fase.** Há um desenho mínimo da base, das relações e das verificações. O primeiro PR pode ser implementado com Node.js, npm e PostgreSQL definidos no repositório e reproduzidos na CI. [Arquitetura](04-arquitetura-e-stack.md), [Segurança](05-seguranca.md), [Cenários financeiros](02-requisitos.md#5-cenários-de-referência).

## Fase 2 Implementação da fundação

A sequência começa em `main`, usando branches curtas de trabalho. O remoto `origin` aponta para o GitHub. Usar GitHub Actions como proposta inicial para esse remoto e verificar se a proteção de branches pode exigir os checks. Se a configuração disponível não permitir o bloqueio automático, registrar a limitação e decidir como exigir CI verde antes do merge. [Plano de CI](06-testes-e-ci.md).

| Ordem | Entrega | Evidência para concluir |
| --- | --- | --- |
| **PR 1 — Ambiente, build e CI** | Criar React/Vite, Fastify, conexão PostgreSQL, lockfile e `.env.example`. Validar a configuração do servidor na inicialização. Rodar testes, SAST, SCA, detecção de segredos e uma primeira análise dinâmica passiva contra o build descartável. | Interface e API sobem do zero. Vitest valida uma regra em centavos, Playwright abre o site e os scanners produzem relatório. Uma regra com fixture sintética demonstra que o check falha quando detecta o problema. Verificar o bloqueio de merge no remoto quando a proteção estiver disponível. |
| **PR 2 — Banco e migrações** | Introduzir migrações, entidades de usuário, espaço e membro, dados sintéticos e papéis separados para execução da API e migração. Aplicar restrições de integridade e usar transações em gravações vinculadas. | Uma base vazia recebe as migrações. As restrições recusam vínculos inconsistentes, e o papel da API carece de permissão para alterar o esquema. |
| **PR 3 — Acesso ao espaço financeiro** | Integrar autenticação e sessões revogáveis. Validar associação e autorização no servidor, com testes de isolamento. | Sessão anônima, revogada ou sem vínculo com o espaço recebe recusa do servidor. |

**Conclusão da fase.** A base inicia a partir de configuração documentada, a CI valida o build e as verificações de segurança em cada revisão, e o espaço compartilhado está protegido pela API. A primeira tarefa executável é o **PR 1**. [Requisitos de segurança](02-requisitos.md), [Verificações da CI](06-testes-e-ci.md).

## Fase 3 Construção das funcionalidades

Entregar de cima para baixo. As duas primeiras entregas formam o primeiro fluxo demonstrável com dados sintéticos. As colunas indicam o recorte mínimo de cada entrega e como verificar seu resultado.

Para cada fluxo, validar corpo e resposta da API, autorizar por espaço e usar consultas parametrizadas. Importação e sincronização aplicam uma lista de campos permitidos antes de gravar em banco, logs ou artefatos. Testes cobrem acesso indevido, dados extras sensíveis descartados e repetição de operações. [Dados e segredos](05-seguranca.md), [Critérios de verificação](06-testes-e-ci.md).

| Ordem | Etapas da entrega | Aceitação principal |
| --- | --- | --- |
| **1. Cadastros e extrato básico** | Abrir o painel do espaço após o login. Navegar entre Extrato, Titulares, Contas e Cartões. Cadastrar os instrumentos e registrar compras, despesas e receitas manualmente. Exibir o extrato por conta, cartão e período. | Uma compra aparece com cartão, titular e data corretos no navegador. O saldo de conta considera o saldo de abertura e os lançamentos diretos. RF-01 a RF-03. |
| **2. Faturas, parcelas e caixa** | Definir ciclos e vencimentos, atribuir compras e parcelas à fatura, registrar pagamento parcial, estorno e transferência. Exibir fatura, valor em aberto e fluxo de caixa. | Uma fatura de R$ 600 com R$ 250 quitados fica com R$ 350 em aberto. As compras compõem consumo e o pagamento compõe caixa. As parcelas recompõem o total em centavos. RF-02, RF-03, RF-05, RF-06 e RF-09. |
| **2.1. Navegação de faturas por cartão** | Agrupar o histórico por cartão. Abrir cada fatura em uma tela própria com os lançamentos do ciclo e as ações já disponíveis. | Ao escolher dezembro em um cartão, o detalhe mostra apenas os lançamentos daquele cartão e ciclo. Voltar restaura o grupo e os filtros. [Plano da etapa intermediária](11-navegacao-de-faturas.md). |
| **3. Importação e fechamento mensal** | Implementar prévia do CSV, escolha da conta, histórico do lote, deduplicação e conciliação explícita. Completar filtros, categorias, tags, relatórios e exportação. Adicionar os formatos reais dos bancos conforme amostras. | O mesmo lote reaplicado gera zero novas linhas. Duas compras legítimas iguais podem coexistir. O total do relatório pode ser conferido no extrato. RF-03, RF-04 e RF-07 a RF-10. |
| **4. Rateios e acertos** | Registrar pagador e participação de cada pessoa. Acompanhar saldo a receber ou pagar e conciliar reembolso. | Uma compra de R$ 240 aparece uma vez na fatura e gera duas partes de R$ 120. O reembolso baixa o acerto e mantém o histórico da compra. RF-19. |
| **5. Assinaturas e recorrências** | Cadastrar recorrências com datas e exceções. Identificar cartão ou conta de cobrança. Entregar **Visão geral** e uma seleção visível para cada cartão. Permitir trocar o meio de cobrança para as próximas ocorrências. | A visão geral lista todas as assinaturas. Selecionar um cartão mostra apenas suas cobranças e subtotal. A troca futura preserva ocorrências antigas. RF-11, RF-15 e RF-20. |
| **6. Previsão mensal de gastos recorrentes** | Acompanhar despesas como Conta de Luz, Conta de Internet e Conta de Água, com agrupamento opcional. Reaproveitar recorrências existentes, estimar valores variáveis, ajustar um mês individual e confirmar o valor da cobrança. | Conta de Luz estimada em R$ 180 e confirmada em R$ 205 atualiza o total uma vez e exibe a diferença de R$ 25. O ajuste de um mês preserva os outros meses. RF-21. |

A projeção de saldo por conta (RF-12) vem depois da previsão de gastos. Reservas, tetos e despesas fora das séries recorrentes ficam para revisão de escopo posterior.

### Integração bancária em paralelo

1. **Contrato simulado.** Depois que a base de importação e conciliação existir, implementar o adaptador no servidor e usar fixtures para paginação, compra retroativa, mudança de ID, estornos, faturas incompletas e duas credenciais no mesmo IP. Testar nova tentativa e falha isolada por conexão.
2. **Sandbox.** Verificar autenticação e leitura no ambiente de teste da Pluggy, incluindo o endpoint `/v2/transactions`. Cobrir cenários específicos do proxy pessoal com fixtures onde o sandbox tiver comportamento diferente.
3. **Prova real e agendamento.** Com consentimento concedido e controles verificados, testar cada origem habilitada na instalação do operador. Observar a atualização com o serviço em execução, a retomada após falha e a reexecução sem duplicidades.
4. **Importação e registro manual.** Validar os fluxos com arquivos de exemplo e manter a entrada manual disponível. [Critérios de integração](07-pluggy-integracao.md), [Importação](03-dados-e-migracao.md).

**Conclusão da fase.** A jornada financeira principal está operável com dados sintéticos em desenvolvimento, e cada entrega tem testes das suas regras. O estado da sincronização real fica registrado separadamente.

## Fase 4 Verificação do sistema

1. **Executar jornadas de ponta a ponta em uma instalação descartável.** Usar identidades e dados sintéticos. Registrar e importar compras, conferir faturas, alternar cartões na visão de assinaturas, conciliar um reembolso e conferir o planejado e o realizado por contexto.
2. **Verificar integridade e regressões.** Cobrir gravações simultâneas, duplicidade, reimportação, mudança de ciclo, perda de confirmação de uma gravação, migração a partir da base anterior e retomada após falha parcial na integração.
3. **Verificar segurança e recuperação.** Rodar SAST, SCA e detecção de segredos na revisão candidata. Executar DAST passivo e testes de autorização com dados sintéticos. Verificar sessão, CSRF, cache privado, ausência de CPF, número completo de cartão e segredos nos dados persistidos, logs e build conforme a política de cada dado. Restaurar backup cifrado em ambiente separado e conferir totais e vínculos.
4. **Revisar uso em telas diferentes.** Conferir os fluxos principais em computador e celular, incluindo estados vazio, carregando, sem acesso e erro. Registrar defeitos com passos de reprodução e acrescentar testes para os casos corrigidos.

**Conclusão da fase.** Os checks obrigatórios passam, os fluxos essenciais são aceitos e a restauração foi demonstrada. Liberar dados reais depois de confirmar isolamento, filtragem de dados e segredos separados. Resolver achados que bloqueiam a publicação. [Política de bloqueio e exceções](06-testes-e-ci.md), [Critérios de segurança](05-seguranca.md).

## Fase 5 Distribuição e migração local

1. **Testar uma instalação limpa.** Preparar PostgreSQL local, copiar a configuração de exemplo, construir a aplicação e conferir se a interface responde apenas em loopback. Documentar a primeira inicialização.
2. **Preparar atualização e recuperação.** Vincular artefatos ao commit aprovado, gerar inventário de dependências (SBOM), testar migrações e registrar os passos para restaurar o banco quando necessário.
3. **Verificar importação opcional.** Exportar dados da origem, escolher a data de corte e fazer uma importação de ensaio. Conferir saldos, faturas e vínculos antes da carga definitiva.

**Conclusão da fase.** Uma pessoa consegue instalar, configurar, atualizar e restaurar a aplicação na própria máquina. [Dados e migração](03-dados-e-migracao.md), [Operação local](04-arquitetura-e-stack.md#distribuição-e-operação-local).

## Fase 6 Operação e evolução

1. Acompanhar disponibilidade, falhas e atrasos de sincronização por titular, expiração de consentimento e sucesso dos backups. Separar erros do site de problemas no banco de origem.
2. Reavaliar dependências mesmo quando o lockfile estiver igual, porque podem surgir novos avisos. Aplicar correções e migrações pelo fluxo de PR. Testar restauração e revogação de credenciais periodicamente.
3. Priorizar melhorias a partir do uso real. Cada mudança volta ao ciclo de escopo, desenho proporcional, implementação, verificação e publicação.

**Evidência de operação.** Há rastro da versão em uso, das últimas sincronizações e dos backups. Falhas têm procedimento de diagnóstico e retomada. [Segurança e operação](05-seguranca.md).

## Regras de trabalho para cada PR

- Partir de uma tarefa com resultado esperado e exemplo verificável. Identificar mudanças em dados, acesso, dependências, configurações e integrações. Incluir migração, documentação e testes pertinentes.
- Usar o mesmo conjunto de comandos no desenvolvimento e na CI. Rodar build, lint, tipos, testes unitários, integração com PostgreSQL, E2E e as verificações de segurança do recorte. Usar dados sintéticos no remoto.
- Revisar a mudança e exigir CI verde para a revisão que entrará em `main`. Atualizar a branch e repetir a validação quando a base mudar de forma que afete o resultado.
- Demonstrar a funcionalidade pelo ponto de entrada normal. Conferir como a operação reage a entradas inválidas, falhas e repetição quando esses casos fizerem parte do fluxo.
