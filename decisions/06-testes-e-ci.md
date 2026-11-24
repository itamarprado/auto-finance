# Testes automatizados e integração contínua

Complementa os [requisitos](02-requisitos.md), a [arquitetura](04-arquitetura-e-stack.md), as [decisões de segurança](05-seguranca.md) e o [SSDLC](08-plano-sdlc.md).

**Começar com integração contínua (CI) para validação do site.** A cada commit novo num PR, o pipeline constrói a interface web e a API, inicia um ambiente descartável e roda os testes. O merge só fica disponível quando a revisão atual passa nas verificações. A publicação e o deploy automatizado ficam para a fase de entrega.

## 1. Plataforma e proteção da branch principal

O código é desenvolvido para distribuição pública, e os dados financeiros pertencem à instalação local. O workflow incluído usa runners Linux padrão do GitHub Actions e PostgreSQL descartável. A execução local das CLIs continua disponível. [Cobrança e cotas do Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

**Segurança do workflow.** Execute verificações de PR no evento `pull_request`, em runners descartáveis, com permissões explícitas de leitura e dados sintéticos. Fixe Actions por SHA completo, imagens por digest e binários externos por checksum. Revise mudanças em workflows, regras e lockfiles, pois elas podem alterar os resultados que o PR apresenta. [Uso seguro do GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use).

| Regra | Aplicação proposta |
| --- | --- |
| Alterações passam por PR/MR | Proteger `main` contra push direto e force push. No GitLab, configurar `Allowed to push and merge: No one` e dar permissão de merge pela interface conforme os participantes do projeto. |
| O PR atual precisa estar verde | Um pipeline obrigatório por revisão do PR. No GitLab, habilitar `Pipelines must succeed` e manter desativada a opção de aceitar pipelines pulados. Os jobs obrigatórios rodam também em mudanças somente de documentação, mantendo um resultado inequívoco. |
| A validação precisa refletir a versão que entra | No GitLab Free, usar merge **fast-forward**, com atualização da branch e nova execução quando `main` avançar. Manter desativado o rebase automático no merge, que pode ajustar o código sem rodar novamente os testes sobre o resultado. No GitHub, exigir branch atualizada antes do merge ou validação equivalente da combinação. |
| Falhas ficam visíveis | Falha, timeout ou ausência de job obrigatório bloqueiam o merge. No GitHub, se houver um check agregador, ele deve executar mesmo quando um job anterior falhar e exigir sucesso explícito dos jobs obrigatórios. |
| Alteração de CI é parte do PR | Revisar mudanças que afetam cobertura, filtros de jobs ou permissões. Uma correção de bug inclui o menor teste de regressão que reproduz o caso. Revisão por segunda pessoa é útil quando houver outro colaborador disponível. |

As regras devem ser demonstradas no próprio remoto com um PR de teste. A validação precisa rejeitar uma revisão com teste falhando, aceitar uma revisão corrigida e exigir nova execução quando a versão estável avançar. [Métodos de merge no GitLab](https://docs.gitlab.com/user/project/merge_requests/methods/), [Pipelines de merge request](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/), [Checks obrigatórios no GitHub](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

## 2. Camadas de teste

| Camada | Ferramentas propostas | O que deve verificar |
| --- | --- | --- |
| Análise estática | ESLint, TypeScript e build de produção | Detectar contratos de tipos quebrados, imports incorretos e problemas no build do site e da API. |
| Unitários | Vitest | Regras de centavos e datas, ciclos de fatura, parcelas, rateios, previsão e agrupamentos. Rodar com entradas pequenas e resultados exatos. |
| Integração | Vitest, Fastify e PostgreSQL real descartável | Migrações, persistência, transações concorrentes, idempotência, autenticação, autorização no servidor, importação e restauração em uma base separada. |
| Contrato da integração bancária | Vitest com respostas sintéticas e adaptador ou servidor simulado | Exercitar paginação, IDs, transações atualizadas, erros, autorização expirada e isolamento entre fontes. |
| End-to-end no navegador | Playwright com interface e API construídas pela CI | Iniciar o serviço em loopback, abrir a interface e percorrer fluxos com identidades sintéticas. Usar Chromium para o conjunto principal e validar também um tamanho de tela de celular. |

Cobertura de código é um indicador auxiliar. Medir cobertura das regras centrais desde o início e exigir casos para invariantes financeiros e falhas conhecidas. Definir limites por módulo depois de ter uma base representativa. Validar no primeiro PR que o runner inicia a API construída, aplica as migrações e abre o site no navegador. [Cobertura do Vitest](https://vitest.dev/config/coverage.html), [Testes no Fastify](https://fastify.dev/docs/latest/Guides/Testing/), [Playwright na CI](https://playwright.dev/docs/ci).

### Verificações de segurança gratuitas

| Técnica | Ferramenta | Quando e como aplicar |
| --- | --- | --- |
| **SAST**, análise estática de segurança | **Semgrep Community Edition** | Desde o PR 1. Executar a CLI com regras versionadas localmente e métricas desativadas, sem depender de SaaS. Começar por padrões relevantes a TypeScript, interpolação de SQL, HTML sem tratamento e exposição de segredos em configuração pública. Validar as regras com exemplos sintéticos. [Semgrep CE](https://github.com/semgrep/semgrep), [Métricas do Semgrep](https://semgrep.dev/docs/metrics/) |
| **SCA**, análise de dependências | **`npm audit`** | Desde o primeiro lockfile, em PR e periodicamente antes de publicar. Usar a árvore fixada por `npm ci`. O comando consulta o registro npm com metadados das dependências. Bloquear avisos altos e críticos conforme a política abaixo. Corrigir atualização de dependência em PR com testes. [npm audit](https://docs.npmjs.com/cli/audit/) |
| **Detecção de segredos** | **Gitleaks CLI**, licença MIT | Examinar o histórico inicial e os commits introduzidos por cada PR. Mascarar integralmente o valor detectado nos relatórios e testar com um segredo sintético. Executar a CLI diretamente. O wrapper `gitleaks-action` tem condições de licenciamento para organizações que ficam fora deste plano. [Gitleaks CLI](https://github.com/gitleaks/gitleaks), [Licença do wrapper](https://github.com/gitleaks/gitleaks-action) |
| **DAST**, análise da aplicação em execução | **OWASP ZAP Baseline**, análise passiva | Rodar um smoke sobre o primeiro build descartável. Com login e rotas financeiras, ampliar o conjunto de páginas e respostas observadas e repetir antes da publicação. Limitar o alvo ao site de teste controlado pelo projeto, com dados sintéticos e origem isolada. Usar apenas navegação conhecida e análise passiva de respostas, voltada a cabeçalhos, cookies e exposição de conteúdo. [ZAP Baseline](https://www.zaproxy.org/docs/docker/baseline-scan/) |
| **Testes de segurança de API e navegador** | **Vitest e Playwright** | Junto de cada rota. Cobrir autorização por espaço, sessão revogada, CSRF, uploads inválidos, descarte de dados proibidos, ausência de segredos no build e falha isolada por titular. Verificar acesso autenticado com contas sintéticas. [Cenários de segurança](05-seguranca.md) |
| **Inventário do build** | **`npm sbom`**, formato CycloneDX | Antes do primeiro deploy, gerar inventário das dependências e associá-lo ao commit publicado. Manter o mesmo lockfile da revisão verificada pela CI. [npm sbom](https://docs.npmjs.com/cli/v11/commands/npm-sbom/) |

Usar o DAST para observar a versão em teste e complementar com testes determinísticos do código para autorização e lógica de negócio. A prova do DAST confirma que a análise alcançou as rotas planejadas. Um scanner que encerra cedo ou perde acesso ao alvo produz execução incompleta.

### Política de bloqueio e exceções

- **Em cada PR.** Bloquear segredo detectado, falha de teste de segurança, achado das regras SAST obrigatórias e vulnerabilidade alta ou crítica detectada pelo SCA, salvo exceção específica e documentada.
- **Antes de publicar.** Exigir os checks da revisão candidata, DAST passivo concluído com as rotas previstas e testes de acesso e minimização aprovados. Achado alto ou crítico confirmado impede a publicação enquanto não houver correção ou mitigação verificada. Exposição de segredo, PAN ou CPF e falha de autorização exigem correção.
- **Triagem.** Registrar ID do achado, componente, impacto, mitigação e data de revisão. Exceções se aplicam ao achado específico. Falha de infraestrutura ou falta de cota deixa a verificação pendente. Relatório vazio ou scanner pulado não vale como aprovação.

## 3. Cenários de regressão prioritários

| Área | Teste e resultado esperado |
| --- | --- |
| Valores e datas | Parcelar R$ 100 em três parcelas recompõe exatamente R$ 100. Ratear R$ 100 entre três pessoas também recompõe o total. Compra perto do fechamento, virada do ano e recorrência no dia 31 obedecem à regra de data escolhida. |
| Compras e pagamentos | Uma compra de R$ 300 aparece uma vez no consumo. Sua fatura aparece no caixa na data adequada. Pagamentos parciais, estornos e antecipações alteram a obrigação e o saldo segundo o vínculo. |
| Transferências e duplicidade | Transferência afeta as duas contas em uma única gravação e mantém efeito zero no consumo consolidado. Reimportar o lote gera zero novas linhas. Duas compras reais com mesma data e valor podem coexistir. |
| Rateio e reembolso | Compra de R$ 240 mantém uma cobrança na fatura, duas partes de R$ 120 e um saldo a receber quando aplicável. Conciliar o PIX baixa o acerto sem inflar a receita da casa. |
| Assinaturas | Visão geral lista assinaturas dos dois cartões. Selecionar cada cartão mostra apenas os serviços daquele cartão. Troca futura de cartão preserva cobranças passadas, e cartões com a mesma fatura continuam selecionáveis separadamente. |
| Casa e Carro | Energia prevista em R$ 180 e conciliada em R$ 205 altera a expectativa em R$ 25. O gasto aparece no plano e a fatura concentra a saída de caixa. Reservas e tetos têm efeitos próprios. |
| Meu Pluggy | Cartões sintéticos de titulares distintos permanecem separados mesmo com emissor coincidente. Reler uma janela mantém a contagem. Uma compra pendente passa a confirmada e a falha de uma fonte preserva seu histórico. |
| Persistência e migrações | Migrar base nova e base de uma versão anterior suportada. Conferir contagem, somas e relações depois de atualizar. Em falha de gravação ou migração, preservar consistência e poder reabrir a base prevista pelo procedimento de recuperação. |
| Acesso e concorrência | Duas contas autorizadas veem o mesmo conjunto. Sessão revogada e tentativa de acessar outro espaço são recusadas. Importação paralela da mesma origem conserva a unicidade dos lançamentos. |
| Backup e falha de integração | Restaurar um backup cifrado em outra base preserva extrato, rateios e vínculos. Chave incorreta é recusada. Nenhuma credencial real aparece nos artefatos. O site abre o histórico e aceita lançamentos quando o adaptador bancário está indisponível. |

O primeiro fluxo E2E valida login e acesso ao mesmo espaço em duas sessões de navegador. Conforme as telas forem entregues, cadastrar dois cartões sintéticos, carregar assinaturas, alternar entre **Visão geral** e cada cartão e conferir o subtotal. Acrescentar fluxos de reimportação de faturas, realização de estimativas de Casa e Carro e restauração em ambiente separado. As regras exaustivas de cada cenário ficam em testes unitários e de integração.

## 4. Fluxo de desenvolvimento e execução

1. **No computador, antes de enviar.** Usar os mesmos scripts do pipeline para executar lint, tipos e testes rápidos. Hooks de Git podem agilizar o feedback local. A regra que decide o merge fica no repositório remoto.
2. **Ao abrir ou atualizar um PR.** Instalar do lockfile com `npm ci` e versões explícitas do toolchain. Rodar lint, tipos, unitários, integração com PostgreSQL, build, SAST, SCA e detecção de segredos. Iniciar o ambiente descartável a partir do build e rodar E2E e DAST conforme o recorte. Reportar resultados por job e configurar um tempo limite.
3. **Ao entrar em `main`.** Disparar uma validação de confirmação da branch principal. Cancelar execuções antigas do mesmo PR quando houver novo commit e evitar pipelines redundantes de branch e PR para a mesma revisão. Na prova, medir minutos, filas e falhas de ambiente. Manter o conjunto de PR pequeno o suficiente para caber na cota sem retirar as verificações essenciais.
4. **Ao investigar falhas.** Disponibilizar relatório de testes e, nos cenários E2E, trace ou captura de tela em falha, com retenção curta e dados sintéticos. Separar falha de infraestrutura de falha do produto. Um teste instável precisa de diagnóstico para continuar sendo um sinal confiável. [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer).

Scripts previstos no `package.json` incluem `lint`, `typecheck`, `test:unit`, `test:integration`, `build` e `test:e2e`. Usar o mesmo lockfile nos ambientes, a mesma versão principal do PostgreSQL e cache de downloads. Na fase de entrega, prever uma verificação do site publicado e das migrações em homologação antes de automatizar o deploy.

### Dados e isolamento

- Usar CPF, pessoas, emissores e transações fictícios nas amostras. Fixar relógio e dados nos testes de calendário e criar um diretório temporário único por execução. Validar o comportamento com data de Brasília explicitamente, sem depender do relógio ou do fuso do runner.
- A CI usa respostas simuladas para consultas bancárias. A prova com cartões reais usa ambiente privado autorizado, separado dos jobs de PR, com segredos distintos e consentimentos por titular.
- Usar runner isolado para executar código de PR. Manter banco, arquivos e credenciais de produção fora desses jobs. No GitHub, usar `pull_request` com permissões de leitura mínimas, sem executar código não confiável em `pull_request_target`. Fixar actions por SHA completo e ferramentas ou imagens de scanner por versão verificada ou digest. Separar validação de credenciais de deploy. [Segurança de CI no GitHub](https://docs.github.com/en/actions/reference/security/secure-use), [Segurança em pipelines de merge request do GitLab](https://docs.gitlab.com/ci/pipelines/merge_request_pipelines/).

## 5. Primeiro marco

O primeiro PR de implementação deve entregar scripts reproduzíveis, um teste unitário financeiro, um teste da API com PostgreSQL e um teste que abre o site no navegador. Incluir SAST, SCA, detecção de segredos e smoke de DAST passivo. Confirmar que o pipeline acusa um achado sintético e demonstrar o bloqueio da branch onde o remoto permitir. Cada funcionalidade acrescenta seus próprios casos de regressão.
