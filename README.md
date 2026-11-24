# Auto Finance

Organizador de finanças pessoais com interface web e execução local. Cada instalação usa seu próprio banco de dados e, quando a integração bancária estiver disponível, as credenciais configuradas pelo operador da instalação.

A implementação atual inclui React, Fastify, uma verificação da conexão com o PostgreSQL e o esquema inicial de usuários, espaços financeiros e membros. Autenticação, cadastro financeiro, importação e sincronização bancária estão no [plano de desenvolvimento](decisions/08-plano-sdlc.md).

## Uso local

1. Instale Node.js 24 com npm 11 e prepare PostgreSQL 17. O Docker Compose é uma opção para executar o banco.
2. Na raiz do projeto, rode `npm ci --ignore-scripts` e copie `.env.example` para `.env` e `.env.migrate.example` para `.env.migrate`.
3. Crie o banco dedicado `auto_finance` e prepare os papéis conforme a seção abaixo. Se já houver uma instalação do projeto, preserve o volume existente e reaproveite o mesmo banco.
4. Em `.env`, aponte `DATABASE_URL` para o banco com o papel `auto_finance_api`. Em `.env.migrate`, aponte `DATABASE_MIGRATION_URL` para o mesmo banco com o papel `auto_finance_migrator`. No Compose, use o endereço `127.0.0.1:54329` e o formato `postgresql://USUARIO:SENHA@127.0.0.1:54329/auto_finance`. Codifique caracteres reservados da senha para URL.
5. Rode `npm run db:migrate`, `npm run build` e `npm start`. Abra `http://127.0.0.1:3000`. A página mostra o estado da API e da conexão com o banco. A API escuta na interface de loopback.

### Preparar o banco

Com Docker Compose, defina `POSTGRES_PASSWORD` em `.env` e execute:

```sh
docker compose up -d --wait postgres
docker compose exec postgres psql -X -U auto_finance -d auto_finance -v ON_ERROR_STOP=1 -f /opt/auto-finance/bootstrap.sql
docker compose exec postgres psql -X -U auto_finance -d auto_finance
```

Na última sessão do `psql`, execute `\password auto_finance_migrator` e `\password auto_finance_api`, atribua senhas diferentes e saia com `\q`. Com PostgreSQL nativo, execute [database/bootstrap.sql](database/bootstrap.sql) com `psql -X -v ON_ERROR_STOP=1` e a conta administradora do banco dedicado, depois defina as senhas na sessão de administração.

O papel de migração é dono dos esquemas da aplicação e do registro de migrações. O papel da API pode consultar e inserir dados nas tabelas iniciais. Ele carece de permissão de DDL, de acesso ao registro de migrações e de associação ao papel de migração. A atualização de uma instalação existente usa `npm run db:migrate`. Reexecutar o comando verifica os checksums das versões aplicadas e aplica apenas as pendentes. Adicione mudanças futuras em um novo arquivo numerado de [database/migrations/](database/migrations).

O comando aplica as migrações pendentes em uma transação. Mantenha as migrações anteriores intactas e deixe o controle da transação com o comando.

### Credenciais

Guarde credenciais em arquivos ignorados pelo Git ou no ambiente do processo local. Mantenha `.env.migrate` restrito a quem aplica migrações. A API carrega `.env` na inicialização. Mantenha segredos fora de variáveis `VITE_*`, que entram no build do navegador. O uso futuro de chaves da Pluggy segue o [desenho da integração](decisions/07-pluggy-integracao.md) e as [decisões de segurança](decisions/05-seguranca.md).

## Desenvolvimento

1. Rode `npm run dev:api` em um terminal com `PORT=3000` (ou com a porta omitida).
2. Rode `npm run dev` em outro terminal e abra o endereço mostrado pelo Vite.

## Verificação

- `npm run lint` e `npm run typecheck` verificam a base.
- `npm run test:unit` verifica configuração e cálculos em centavos.
- `npm run test:integration` aplica migrações e grava registros sintéticos. Configure `TEST_DATABASE_URL` (API) e `TEST_DATABASE_MIGRATION_URL` (migração), no ambiente ou em `.env.test`, para um PostgreSQL descartável provisionado pela mesma rotina de bootstrap.
- Rode `npx playwright install chromium` uma vez. Depois de fazer o build, rode `npm run test:e2e`. Uma instalação local compatível do Chromium também pode ser indicada por `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- Para abrir um relatório local do navegador, execute `npm run test:e2e -- --reporter=list,html` e abra `playwright-report/index.html`.
- `npm run security:deps` consulta avisos públicos de dependências e falha diante de achados de gravidade alta ou crítica.
- `semgrep scan --config .semgrep.yml --metrics=off --error src` aplica as regras do repositório com o Semgrep CE.
- `gitleaks git --config .gitleaks.toml --redact=100 --log-opts=HEAD .` procura segredos no histórico alcançável pela revisão atual.
- O plano [OWASP ZAP](security/zap-smoke.yaml) verifica somente a página inicial e `/api/health` na porta local `3107`. Execute o build nessa porta com PostgreSQL descartável e indique um diretório para o relatório em `ZAP_REPORT_DIR`. No ZAP 2.17.0, use `zap.sh -cmd -silent -notel -autorun security/zap-smoke.yaml` ou o lançador correspondente no Windows.

O [workflow](.github/workflows/ci.yml) verifica código e segredos antes do build. Usa PostgreSQL descartável em loopback e dados sintéticos. Em um remoto GitHub com Actions habilitado, os resultados aparecem em **Actions → Validação da base → Summary** e nos logs de cada job. Ao configurar proteção de merge, exija **Código e segredos** e **Testes e segurança**. [Plano de CI](decisions/06-testes-e-ci.md).

## Commits

Use um prefixo em colchetes e uma descrição curta. Use `[feat]` para funcionalidade, `[fix]` para correção, `[doc]` para documentação e `[test]` para mudanças apenas de testes.
