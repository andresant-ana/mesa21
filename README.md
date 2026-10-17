# MESA/21

Blackjack solo e multiplayer casual, gratuito e leve, com créditos exclusivamente fictícios e identidade visual Playful Minimalism. Partida, cartas, resultado e saldo casual são autoritativos no servidor. Não há dinheiro real. A classificação solo usa apenas créditos fictícios persistentes da conta.

## M1 — Fundação e jogo solo

- Cliente HTML/CSS/TypeScript responsivo, sem framework de interface.
- Cloudflare Worker + Durable Object: sessão visitante e estado da partida no servidor.
- Motor de seis baralhos, cartas embaralhadas com fonte criptográfica, natural 3:2, hit, stand, double, split, empate e dealer para em soft 17.
- Créditos casuais separados; API não aceita cartas, saldo ou resultado informados pelo navegador.
- Clarice em SVG inline e cartas desenhadas com CSS; sem imagens raster ou CDN de ícones.
- Lobby social inicial em `/salas.html`: salas públicas/privadas, convites por URL, ocupação de cadeiras e WebSocket de participantes. **Partidas multiplayer casuais implementadas e com smoke Worker/WebSocket; QA de partida ponta a ponta e publicação ainda pendentes.**
- Testes determinísticos e CI com checagem estrita de tipos.

## M5 — Contas (primeira fatia)

- `/conta.html` permite criar conta, entrar, recuperar com código de uso único, consultar perfil e sair.
- Senha derivada com PBKDF2-SHA256, salt aleatório, sessões protegidas por cookies HttpOnly, token revogável com hash no servidor e limitação básica de tentativas por username.
- Diretório de contas persistido em Durable Object SQLite (sem D1 provisionado).
- As contas estão vinculadas à carteira e ao modo solo classificatório; as salas casuais continuam com créditos temporários isolados. Detalhes em `docs/ACCOUNTS.md` e `docs/WALLET.md`.

## M6 — Créditos e ranking

- `/carteira.html`: saldo de créditos fictícios da conta, bônus diário de 500 e movimentações recentes.
- `/classificatoria.html`: blackjack solo classificatório, apostas e resultado controlados pelo servidor; alterações de saldo registradas no ledger.
- `/ranking.html`: classificações semanal, mensal e histórica pelo lucro líquido real de partidas concluídas, sem bônus. Sem usuários fictícios gerados para preencher a tela.

### Ainda não implementado

Classificatória multiplayer com ledger entre objetos, perfil público completo, chat, fairness completo com semente do jogador, deploy público e proteção operacional adicional contra bots distribuídos. O saldo de visitante depende do cookie; limpar cookies perde a sessão, e criar várias sessões não é impedido.

## M8 — Proteções e auditabilidade parcial

- Rate limiting do Worker para cadastro, autenticação, API, salas e WebSockets; limites adicionais de sockets simultâneos e revogação de acesso ao sair de uma sala.
- Mesas multiplayer geram compromisso SHA-256 do sapato **antes das apostas**, revelam provas apenas após aposentadoria do baralho e oferecem verificação no navegador.
- O compromisso é **transparência parcial**, não certificação provably fair. Consultar `docs/ABUSE_PROTECTION.md` e `docs/SHOE_COMMITMENT.md`.

## Cloudflare — deploy protegido

- O plano gratuito Workers Free e o subdomínio Cloudflare foram conferidos externamente pelo proprietário. **Nenhum Worker foi publicado.**
- O CI tradicional verifica o projeto sem credenciais Cloudflare e sem deploy.
- O workflow `.github/workflows/deploy-production.yml` é manual e bloqueado por padrão: exige `main`, confirmação, SHA exato, a variável de aprovação `MESA21_RELEASE_APPROVED=true`, testes completos e ambiente `production` configurado com credenciais seguras.
- Enquanto os bloqueios de segurança e privacidade listados em `docs/DEPLOYMENT.md` não forem resolvidos, **não ative a variável de aprovação nem crie token de publicação**.

## Rodar localmente

Requisito: Node.js 22.12 ou superior.

1. Instale dependências reproduzíveis com npm ci.
2. Rode npm run check, npm test, npm run build e npm run smoke.
3. Em terminais separados, rode npm run dev:api e npm run dev.
4. Abra http://localhost:5173.

Wrangler mantém os Durable Objects no ambiente local.

## Organização

- src/domain: regras e tipos de blackjack.
- src/worker: endpoints, validação de origem e sessão.
- src/client: mesa solo, cartas acessíveis e chamadas à API.
- tests: suíte determinística do motor, autenticação e integração local real do Worker.
- docs/STITCH_AUDIT.md: inventário e achados do export Stitch.
- docs/ARCHITECTURE.md: arquitetura, limites de confiança e execução local.
- docs/IMPLEMENTATION_PLAN.md: marcos e critérios.
- docs/SOCIAL_ROOMS.md: contrato das salas de espera reais e limitações de lançamento.
- docs/ACCOUNTS.md: contrato de autenticação, recuperação, segurança e limites.
- docs/WALLET.md: economia fictícia, ledger, ranking e limites.
- docs/ABUSE_PROTECTION.md: controles de abuso e seus limites.
- docs/SHOE_COMMITMENT.md: formato verificável de compromissos e limitações da fairness.
- docs/BROWSER_QA.md: evidências de QA no Chromium.
- docs/DEPLOYMENT.md: gates de produção Cloudflare.
- docs/AUDIT_2026-10-17.md: auditoria de privacidade, limites operacionais e bloqueios de alpha fechada.

O repositório apresenta exclusivamente MESA/21. Leia a arquitetura, a auditoria Stitch e o plano para detalhes.
