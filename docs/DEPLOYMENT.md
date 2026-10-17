# M8 — Preparação para publicação gratuita no Cloudflare

## Verificações desta etapa
- `wrangler.jsonc` mantém três Durable Objects: `GameSession`, `RoomLobby` e `AccountDirectory`.
- **Correção essencial:** o ambiente nomeado `production` declara explicitamente os três bindings. No Wrangler, bindings de Durable Objects **não são herdados** pelos ambientes nomeados.
- `npm run deploy:check` compila o Worker no modo production com `wrangler deploy --dry-run`, sem credenciais e **sem publicar nada**.
- `public/_headers` aplica CSP, X-Frame-Options, Permissions-Policy, Referrer-Policy e proteção MIME às páginas HTML/CSS/JS servidas como Static Assets. APIs HTTP adicionam cabeçalhos de segurança no Worker.
- `npm run smoke` verifica cabeçalhos reais de páginas, além de autenticação, créditos e multiplayer.

## Antes de conectar uma conta Cloudflare
1. Executar todo o CI, incluindo Playwright, para validar renderização e navegação.
2. Revisar acessibilidade, mensagens de erros, limites de saldo e privacidade.
3. Tratar abuso: criação em massa de contas/salas, spam, rate limiting por origem e proteção Turnstile. Limitação atual por username não substitui controles de borda.
4. Validar fairness externamente (commit/reveal do baralho não está implementado): embaralhamento criptográfico é necessário, mas **não equivale a ser provably fair**.
5. Testar desempenho, custos e quotas reais de Worker/DO. Uma conta gratuita pode ter limites de chamadas e armazenamento; a aplicação deve falhar com mensagem útil em vez de gerar custos sem controle.
6. Confirmar termos de uso, idade, política de privacidade, retenção de dados e legislação aplicável a jogo exclusivamente simulado.

## Procedimento de publicação (ainda não executado)
- Proprietário conecta conta Cloudflare ou executa autenticação `wrangler login` em ambiente apropriado, **nunca cole tokens secretos no repositório ou no chat**.
- Rodar `npm install`, `npm run check`, `npm test`, `npm run build`, `npm run smoke`, `npm run ui-smoke` e `npm run deploy:check`.
- Inspecionar configurações `env.production` e confirmar que todos os DOs estão vinculados.
- Com autorização e política de segurança aprovadas, executar `npx wrangler deploy --env production`.
- Acessar URL retornada pelo Cloudflare, executar smoke com duas sessões em navegadores separados, conferir cookies Secure, fluxo de cadastro/recuperação e replay do blackjack.
- Monitorar erros, armazenamento, uso diário e quotas, além de possuir procedimento documentado para rollback.

**Estado:** pronto apenas para validação de compilação e testes locais. **Não há URL pública nem implantação confirmada.**

Referências oficiais:
- https://developers.cloudflare.com/workers/static-assets/headers/
- https://developers.cloudflare.com/durable-objects/reference/environments/
- https://developers.cloudflare.com/workers/wrangler/commands/
