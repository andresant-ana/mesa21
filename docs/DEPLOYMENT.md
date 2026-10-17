# MESA/21 — Cloudflare e publicação controlada

## Estado confirmado em 17/10/2026

Relatório do Work, após inspecionar o Dashboard da conta do proprietário:

- **Workers Free** (US$ 0) ativo, sem pagamento ou upgrade autorizado.
- Workers, Durable Objects e armazenamento SQLite-backed disponíveis nas cotas gratuitas indicadas no painel.
- Subdomínio configurado: `matrixiseverywhere.workers.dev`.
- **Nenhum Worker criado ou publicado**, sem conexão GitHub OAuth (desnecessária para deploy via Wrangler).
- Account ID foi fornecido pelo proprietário, **mas não é gravado no repositório público**. Quando houver autorização final, usá-lo na variável de environment do GitHub `CLOUDFLARE_ACCOUNT_ID`.

Este relatório foi fornecido pelo usuário a partir da sessão Work; o acesso remoto à conta Cloudflare não foi repetido nesta etapa.

## Configuração do repositório, já testada

- `wrangler.jsonc` define `GameSession`, `RoomLobby` e `AccountDirectory`.
- O environment Wrangler `production` declara explicitamente os três bindings (eles **não são herdados**).
- `npm run deploy:check` executa um **dry-run** do pacote de produção, sem credenciais nem publicação.
- `public/_headers` define CSP, `X-Frame-Options`, `nosniff` e outras proteções nas páginas, e APIs definem cabeçalhos próprios.
- O CI normal (`.github/workflows/ci.yml`) dispara em PR/main e testa código, domínio, Worker/DO local e interface no Chromium, sem fazer deploy.
- `.github/workflows/deploy-production.yml` é **manual-only**: nenhum push, PR ou agendamento pode iniciá-lo.

## Como funciona a futura autorização de deploy

O workflow manual é **bloqueado por padrão**. O job de verificação só inicia se TODAS as condições abaixo forem atendidas:

1. Acionamento manual via `workflow_dispatch`, selecionando `main`.
2. Campo `confirm_release` igual a `PUBLICAR_MESA21`.
3. Campo `expected_sha` igual aos 40 caracteres hexadecimais do SHA exato em `main`.
4. Variável de **repositório** `MESA21_RELEASE_APPROVED` igual a `true` (deixe **ausente** ou `false` até cumprir todos os critérios).
5. Passagem de checagem TS, testes unitários/integração, build, dry-run, Worker smoke e Playwright browser smoke.
6. Job `publish` associado ao GitHub Environment `production`, sujeito às proteções/approvals configurados pelo proprietário; credenciais somente disponíveis nesse job.
7. Presença de `CLOUDFLARE_API_TOKEN` válido (secret) e `CLOUDFLARE_ACCOUNT_ID` (variable) **no Environment production**.
8. Somente então o passo final executa `npx wrangler deploy --env production`.

**Não criar token de API nem ativar a variável de liberação agora. O deploy não foi autorizado.**

### Ações de interface a executar apenas quando os bloqueios forem resolvidos

- GitHub do repo → **Settings → Environments**: criar `production`, restringir deployments à `main` e, se disponível, configurar required reviewers. Evitar selecionar "Prevent self-review" quando o proprietário é o único revisor, pois impediria a aprovação.
- No GitHub Environment `production`, criar variável `CLOUDFLARE_ACCOUNT_ID` com o ID observado no painel, e um **environment secret** `CLOUDFLARE_API_TOKEN`. O token deve ser gerado no painel Cloudflare com **escopo mínimo para Workers** e somente na conta correta; nenhuma credencial deve ser colada no chat ou no repositório.
- GitHub → Settings → Secrets and variables → Actions → Variables: criar `MESA21_RELEASE_APPROVED=false` (opcional; ausente já bloqueia). Alterar para `true` **somente** após passar o checklist de lançamento, com aprovação explícita.
- GitHub → Actions → **Publicar MESA21 na Cloudflare (manual)** → Run workflow, selecionar `main`, digitar as confirmações e acompanhar os jobs. Nunca usar este caminho como substituto para QA.
- Espera-se o nome do Worker `mesa21-production` ao publicar com `--env production`. O endereço potencial seria `mesa21-production.matrixiseverywhere.workers.dev`, **mas ainda não existe URL publicada ou validada**. Conferir a URL devolvida pelo Wrangler no deploy real.

## Bloqueios de segurança antes de disponibilizar ao público

1. **Antiabuso:** rate limiting inicial via Worker foi implementado (documentado em `docs/ABUSE_PROTECTION.md`), mas é local a cada região e não substitui Turnstile, proteção contra bots distribuídos, monitoramento, quotas duráveis por identidade e limites de conexões simultâneas. É um controle parcial.
2. **Fairness:** compromisso SHA-256 e revelação do sapato após aposentadoria foram implementados **somente no multiplayer casual**. Essa transparência parcial não comprova aleatoriedade independente nem todas as cartas distribuídas; falta semente combinada de jogador/servidor, replay e implementação nas modalidades solo e classificatória. Nunca declarar `provably fair` sem completar e auditar. Ver `docs/SHOE_COMMITMENT.md`.
3. **Concorrência e identidade:** contas usam um único `AccountDirectory`, e salas casuais usam armazenamento distinto; multiplayer classificatório com pagamentos idempotentes **não está pronto**.
4. **Privacidade e custos:** política de dados/retenção, testes de abuso, testes de carga e limites do plano gratuito precisam ser validados. Verificar obrigações legais de jogo de simulação sem dinheiro real.
5. **Qualidade:** testes WCAG, aparelhos físicos, navegador Safari/Firefox e auditoria visual completa contra o Stitch estão pendentes.
6. **Reprodutibilidade:** o projeto ainda usa `npm install`; antes de publicar convém adotar lockfile e `npm ci` para builds reproduzíveis.

## Depois da publicação (somente quando autorizada)

Validar com dois navegadores e sessões independentes: cookies Secure, cadastro, recuperação de conta, bônus, blackjack solo/classificatório, salas públicas e privadas, convites, WebSocket, divisão de mãos e reconexão. Monitorar erros, armazenamento, uso diário e quotas e manter plano de rollback. Nenhuma confirmação de sucesso do CI implica deploy real.

## Referências oficiais

- Cloudflare: https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Variáveis Wrangler: https://developers.cloudflare.com/workers/wrangler/system-environment-variables/
- Environments Wrangler: https://developers.cloudflare.com/workers/wrangler/environments/
- GitHub Environments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments
