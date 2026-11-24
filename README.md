# Auto Finance

Organizador de finanças pessoais com interface web e execução local. Cada instalação usa seu próprio banco de dados e, quando a integração bancária estiver disponível, as credenciais configuradas pelo operador da instalação.

A implementação atual inclui a base React, a API Fastify e uma verificação da conexão com o PostgreSQL. Cadastro de dados financeiros, importação e sincronização bancária estão no [plano de desenvolvimento](decisions/08-plano-sdlc.md).

## Uso local

1. Instale Node.js 24 com npm 11 e prepare PostgreSQL 17. O Docker Compose é uma opção para executar o banco.
2. Na raiz do projeto, rode `npm ci --ignore-scripts` e copie `.env.example` para `.env`.
3. Configure `DATABASE_URL` para um banco dedicado ao Auto Finance. Com Docker Compose, defina também `POSTGRES_PASSWORD` e rode `docker compose up -d --wait postgres`. A conexão padrão do Compose usa o banco e usuário `auto_finance` em `127.0.0.1:54329`. Substitua a senha no formato `postgresql://auto_finance:SENHA_LOCAL@127.0.0.1:54329/auto_finance` e codifique os caracteres reservados para URL.
4. Rode `npm run build` e `npm start`. Abra `http://127.0.0.1:3000`. A página mostra o estado da API e do banco. A API escuta na interface de loopback.

### Credenciais

Guarde senhas e chaves em `.env` ou no ambiente do processo local. O Git ignora `.env`. Mantenha chaves fora de variáveis `VITE_*`, que entram no build do navegador. A fundação usa apenas a credencial do banco. O uso futuro de chaves próprias da Pluggy segue o [desenho da integração](decisions/07-pluggy-integracao.md) e as [decisões de segurança](decisions/05-seguranca.md).

## Desenvolvimento

1. Rode `npm run dev:api` em um terminal com `PORT=3000` (ou com a porta omitida).
2. Rode `npm run dev` em outro terminal e abra o endereço mostrado pelo Vite.

## Verificação

- `npm run lint` e `npm run typecheck` verificam a base.
- `npm run test:unit` verifica configuração e cálculos em centavos.
- `npm run test:integration` consulta um PostgreSQL descartável usando `DATABASE_URL`.
- Rode `npx playwright install chromium` uma vez. Depois de fazer o build, rode `npm run test:e2e`. Uma instalação local compatível do Chromium também pode ser indicada por `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- Para abrir um relatório local do navegador, execute `npm run test:e2e -- --reporter=list,html` e abra `playwright-report/index.html`.
- `npm run security:deps` consulta avisos públicos de dependências e falha diante de achados de gravidade alta ou crítica.
- `semgrep scan --config .semgrep.yml --metrics=off --error src` aplica as regras do repositório com o Semgrep CE.
- `gitleaks git --config .gitleaks.toml --redact=100 --log-opts=HEAD .` procura segredos no histórico alcançável pela revisão atual.
- O plano [OWASP ZAP](security/zap-smoke.yaml) verifica somente a página inicial e `/api/health` na porta local `3107`. Execute o build nessa porta com PostgreSQL descartável e indique um diretório para o relatório em `ZAP_REPORT_DIR`. No ZAP 2.17.0, use `zap.sh -cmd -silent -notel -autorun security/zap-smoke.yaml` ou o lançador correspondente no Windows.

O [workflow](.github/workflows/ci.yml) verifica código e segredos antes do build. Usa PostgreSQL descartável em loopback e dados sintéticos. Em um remoto GitHub com Actions habilitado, os resultados aparecem em **Actions → Validação da base → Summary** e nos logs de cada job. Ao configurar proteção de merge, exija **Código e segredos** e **Testes e segurança**. [Plano de CI](decisions/06-testes-e-ci.md).

## Commits

Use um prefixo em colchetes e uma descrição curta. Use `[feat]` para funcionalidade, `[fix]` para correção, `[doc]` para documentação e `[test]` para mudanças apenas de testes.
