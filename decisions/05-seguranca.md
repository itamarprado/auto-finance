# Segurança da instalação local

Esta decisão complementa os [requisitos](02-requisitos.md), a [arquitetura local](04-arquitetura-e-stack.md), a [integração bancária](07-pluggy-integracao.md) e o [plano de testes e CI](06-testes-e-ci.md).

A aplicação e o PostgreSQL da instalação padrão escutam em loopback. Dados financeiros, arquivos e segredos pertencem à instalação local. As conexões bancárias opcionais usam HTTPS e o consentimento concedido pelo titular no fluxo oficial.

## 1. Acesso e sessões

- **Contas autorizadas.** A pessoa responsável pela instalação cria contas e espaços pelo terminal, usando a credencial de migração. O PostgreSQL guarda o derivado da senha com scrypt e sal aleatório. [Armazenamento de senhas OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- **Sessão web.** O servidor cria um token aleatório, guarda seu hash e aplica expiração após 12 horas. O cookie usa `HttpOnly`, `SameSite=Strict`, escopo em `/api` e `Secure` em HTTPS. A instalação padrão usa HTTP em loopback. Login e logout exigem a origem local exata. Logout revoga a sessão no servidor. [OWASP — Sessões](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP — CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- **Autorização por espaço financeiro.** A API verifica sessão, associação ao espaço e permissão em cada operação. Consultas a transações, documentos, exportações e tarefas usam o espaço autorizado como parte do recorte. A titularidade do cartão descreve o dado bancário. O acesso a ele decorre da permissão no espaço compartilhado. [OWASP — Autorização](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
- **Limites e diagnóstico.** Limitar tentativas de login conforme o mecanismo escolhido. Registrar falhas e alterações de acesso e integração com informações mínimas. Evitar dados financeiros e segredos em logs, respostas de erro e ferramentas de monitoramento.

## 2. Servidor, arquivos e segredos bancários

| Componente | Proteção proposta |
| --- | --- |
| Navegador e API | Interface e API na mesma origem local. Respostas autenticadas usam `Cache-Control: no-store`. Conteúdo importado é exibido como texto, salvo quando houver renderização sanitizada. |
| PostgreSQL | Restringir o acesso ao backend e às tarefas autorizadas. Vincular o banco local a loopback, usar credenciais com privilégios mínimos e dar à migração um papel próprio. |
| Segredos do Meu Pluggy | Injetar as credenciais de cada titular no processo autorizado do servidor e manter a chave temporária em memória. Aplicar o procedimento de gestão de credenciais abaixo. |
| Arquivos importados | Validar tamanho e formato no servidor, restringir acesso durante a prévia e descartar o original após confirmação, cancelamento ou expiração. Guardar dados normalizados. Anexos futuros exigem acesso privado, retenção explícita e uma forma de eliminar dados proibidos antes de guardar o arquivo. |
| Ambientes | Separar produção e testes. A CI utiliza base descartável e dados sintéticos. Manter dependências e runtime com correções e limitar permissões de publicação quando a automação de deploy for adotada. |

Cada titular concede consentimento pelo fluxo oficial. O backend local usa a API do provedor por HTTPS e isola a leitura por fonte autorizada. Revogação, expiração ou falha suspende a coleta afetada. O histórico gravado e a operação manual ficam disponíveis enquanto a instalação estiver em execução. [Referência do Meu Pluggy](07-pluggy-integracao.md)

### Dados necessários e retenção

| Dado | Tratamento inicial |
| --- | --- |
| Identificação do cartão | Guardar um ID interno, titular interno, emissor, referência externa necessária à conciliação e, quando útil e disponível, os últimos quatro dígitos. O final serve para exibição. A identificação da conta usa a origem e o vínculo com o titular. |
| Dados de pagamento | O produto só acompanha gastos e faturas. O modelo exclui número completo do cartão (PAN), CVV/CVC, PIN, dados de trilha e credenciais de internet banking. A interface de cadastro pede apenas dados de identificação e conciliação. [PCI SSC — Dados de autenticação de cartão](https://www.pcisecuritystandards.org/faqs/1533/) |
| CPF | Cada titular usa o CPF no fluxo oficial quando exigido. O site vincula pessoas a UUIDs internos. A persistência de CPF fica fora do escopo inicial. Se um uso futuro realmente exigir CPF, documentar finalidade, acesso, retenção e criptografia de campo com chave separada antes de acrescentá-lo. |
| Movimentações e faturas | Guardar só os campos necessários para valores, datas, descrição, vínculos e origem. Tratar descrições como potencialmente sensíveis. Limitar ao espaço autorizado as consultas, exportações e anexos. |

Aplicar uma lista de campos permitidos no servidor antes de persistir, devolver ou exportar dados. O mapeamento da Pluggy reduz a identificação do cartão ao final, se aplicável. A importação aplica a mesma política em arquivos com colunas extras. Tratar descrições e observações como possíveis fontes de CPF, PAN e segredos. Remover trechos sensíveis identificados ou rejeitar a linha para revisão. Payloads brutos ficam fora do banco, logs, traces e relatórios de CI. Logs operacionais guardam identificadores internos, horário, status e código de erro filtrado. Testar a filtragem com dados sintéticos tanto em campos extras quanto em texto livre.

### Configuração e credenciais por ambiente

| Classe | Exemplos | Destino |
| --- | --- | --- |
| Configuração pública | URL pública quando necessária, idioma, sinalizadores visuais | Interface. Valor com prefixo `VITE_*` pode aparecer no build. |
| Configuração interna | Porta, nível de log, horários de sincronização, referências de itens por titular | Backend, com esquema e validação de valores. |
| Segredos | Conexão ao banco, chave de sessão conforme o mecanismo adotado, credenciais Pluggy por titular | Injeção em runtime no servidor ou armazenamento protegido. Chaves diferentes por ambiente e finalidade. |

1. **Desenvolvimento.** Versionar `.env.example` com nomes, valores seguros de exemplo e indicação do componente que consome cada variável. Manter valores reais fora do Git. Validar tipos e presença no startup. Em produção, encerrar o startup se faltar um segredo obrigatório ou se houver valor de exemplo.
   A API lê `.env`. A credencial de migração fica em `.env.migrate`, com acesso restrito. Os testes de integração usam nomes próprios de variáveis e banco descartável.
2. **Navegador.** Tratar todo valor `VITE_*` como público. Manter uma lista curta de configurações públicas. Conexões ao banco, `clientSecret` da Pluggy, tokens e chaves de sessão são exclusivos do servidor. [Variáveis do Vite](https://vite.dev/guide/env-and-mode).
3. **CI e homologação.** Usar credenciais descartáveis de PostgreSQL e adaptadores simulados em PRs. Segredos de homologação e produção são distintos e ficam fora dos jobs de PR. Desabilitar logs de corpos e mascarar cabeçalhos sensíveis, inclusive `Authorization`, `Cookie` e `X-API-KEY`.
4. **Instalação local.** Armazenar os segredos no ambiente do processo ou em arquivo local ignorado, com leitura restrita à conta que executa o serviço. Quando houver persistência de segredos por fonte, definir criptografia e gestão de chave antes da implementação.

### Modelo inicial de ameaças

Manter o diagrama de fluxo e atualizar esta análise ao acrescentar rotas financeiras, upload, jobs, webhooks ou armazenamento. Usar o OWASP ASVS como referência para selecionar controles verificáveis. [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/).

| Risco | Controle | Como verificar |
| --- | --- | --- |
| Acesso às faturas de outro espaço | Autorização por espaço em cada operação e consultas restritas ao espaço autorizado no servidor. | Testar que leitura, escrita, exportação e download de outro espaço são recusados. |
| Roubo de sessão ou alteração sem intenção | Cookies protegidos, expiração, revogação, CSRF e limitação de login. | Testar logout, expiração, alteração sem proteção e tentativas repetidas com contas sintéticas. |
| Dados proibidos persistidos ou expostos | Lista de campos, validação de uploads, cache privado e logs de metadados filtrados. | Inserir campos extras sintéticos e testar banco, arquivos, respostas, exportações e logs. |
| Comprometimento de dependência ou do pipeline | Lockfile, análise de dependências, ações fixadas e credenciais de produção fora da CI de PR. | Rodar SCA, SAST e detecção de segredos, além de revisar permissões de alterações no workflow. |
| Item de um titular vinculado a outro | Confirmar a relação entre credencial, item e titular no servidor. | Simular duas origens do mesmo emissor e recusar um item sem vínculo com a credencial escolhida. |
| Perda ou adulteração de histórico | Operações atômicas, backups cifrados e cópia independente. | Simular falha parcial e restaurar em ambiente separado para conferir totais e vínculos. |

## 3. Backup e operação

1. **Recuperação.** Fazer uma cópia consistente e cifrada do PostgreSQL e dos anexos necessários. Guardar cópia independente dos dados ativos e testar a restauração em uma instalação descartável. Reconfigurar segredos no ambiente local após restaurar. [Backup do PostgreSQL](https://www.postgresql.org/docs/current/backup.html)
2. **Disponibilidade.** Monitorar saúde da aplicação, vencimento do certificado, falhas de backup e última coleta válida de cada banco. O site informa se perdeu comunicação com o servidor ou se há atraso bancário. Operações que podem ser repetidas preservam a consistência na retomada.
3. **Resposta a incidentes.** Em caso de exposição de credenciais, revogar ou rotacionar primeiro. Suspender a integração afetada, revisar logs permitidos, atualizar a instalação, invalidar sessões afetadas e acrescentar um teste de regressão.

## 4. Critérios de aceitação

| Quando | Verificação |
| --- | --- |
| Antes de incluir dados reais | Site disponível por HTTPS. Falham requisições sem sessão ou com associação inválida, inclusive a documentos e operações de gravação. |
| Na prova do acesso compartilhado | Duas contas autorizadas acessam o mesmo espaço pelo navegador. Revogar uma conta ou sessão encerra aquele acesso e preserva o outro. |
| Na prova do Meu Pluggy | Usuários autorizam seus próprios bancos. Segredos ficam no servidor, ausentes do build, dos backups de dados e dos logs. Fixtures com CPF, PAN e campos extras demonstram a filtragem antes da persistência. Falha ou revogação de uma fonte afeta somente a integração correspondente. |
| Antes de depender do site | Restaurar banco e anexos em ambiente separado e conferir totais e vínculos. Verificar que o backup armazenado exige a chave ou senha de recuperação. |
| Antes de distribuir uma versão com dados financeiros | Testar vinculação a loopback, autenticação, autorização, filtragem de dados, proteção de segredos e recuperação. Conferir os checks da revisão aprovada. [Política de bloqueio](06-testes-e-ci.md#política-de-bloqueio-e-exceções) |

Os testes de segurança usam dados sintéticos e um ambiente local descartável.
