# Arquitetura técnica inicial

## Visão

MESA/21 começa como uma aplicação de uma página, com TypeScript no cliente e no Worker. O cliente mostra controles e renderiza uma projeção pública do estado. Um Durable Object por sessão visitante mantém a partida, o sapato, a mão da dealer e o saldo casual em armazenamento persistente do servidor.

Navegador (HTML + CSS + TS) chama a API same-origin. O Worker entrega os assets estáticos e direciona chamadas de jogo ao Durable Object de sessão. As regras, o sapato, cartas fechadas e saldo permanecem no servidor.

## Stack escolhida

- TypeScript com checagem estrita.
- HTML/CSS/TypeScript sem framework de UI na primeira fatia; mantém baixo custo de runtime.
- Vite para desenvolvimento e build.
- Cloudflare Worker para API e entrega de assets.
- Durable Objects com armazenamento SQLite para estado de sessão serializado.
- Node.js test runner para testes determinísticos do motor, sem framework de testes adicional.
- GitHub Actions para checagem de tipos, testes e build em pull requests.

Cloudflare é uma decisão reversível: os assets estáticos têm cobrança/limites distintos das chamadas do Worker, e Durable Objects oferecem uma fronteira de estado no servidor. Quotas e condições gratuitas precisam ser verificadas antes do lançamento; a faixa gratuita não garante custo zero em qualquer escala. Consulte os limites oficiais no final.

## Limites de confiança

- O cliente não envia cartas, saldo, total, prêmio ou resultado. Envia apenas aposta ao iniciar e ação hit/stand/double durante a rodada.
- O Worker valida método, origem, tipo de conteúdo e tamanho do corpo. A sessão usa identificador aleatório de 256 bits num cookie HttpOnly, SameSite=Strict e Path=/; Secure é aplicado em produção.
- O identificador de visitante seleciona o Durable Object. Não é autenticação de conta; a versão inicial não promete proteção contra limpeza de cookies, automação ou criação de várias sessões.
- O Durable Object valida aposta e fase, embaralha seis baralhos com crypto.getRandomValues, aplica as ações, resolve a dealer e persiste o saldo casual antes de responder.
- A projeção da API omite carta fechada, sapato e estado interno. Não existe campo de escrita para créditos classificatórios; rankedPoints é sempre null.
- Créditos são fictícios, sem compra, saque, conversão monetária ou uso competitivo. Cada sessão inicia com 1.000 créditos casuais; não há ranking.
- O estado tem persistência do lado servidor, mas ainda não há conta, recuperação entre dispositivos, mitigação contra abuso ou compromisso criptográfico de fairness publicamente verificável.
- Respostas da API usam Cache-Control: no-store; não há CORS.
- O resultado não deve ser apresentado como RNG competitivo auditado. Ranking exigirá identidade, rate limits, anti-abuso, logs, fairness verificável e auditoria operacional.

## Domínio implementado

O motor puro em src/domain/blackjack.ts implementa sapato de seis baralhos, Fisher–Yates com fonte criptográfica, ases suaves, natural 3:2, empate, hit, stand, double, bust e dealer que para em 17 (incluindo soft 17). O sapato e a carta fechada permanecem no servidor.

Nesta fatia: apostas casuais de 10 a 100 créditos em múltiplos de 10; 1.000 créditos fictícios iniciais; natural 3:2. Splits, seguro, side bets e regras configuráveis não fazem parte da tela.

## Estrutura

- src/domain: lógica pura e tipos do jogo.
- src/worker: HTTP, sessão visitante e Durable Object.
- src/client: acessibilidade, API same-origin e interface leve.
- tests: casos determinísticos do motor.
- docs: decisões, auditoria do Stitch e marcos.
- .github/workflows: validação contínua.

## Execução local

Terminal 1: npm run dev:api (Worker em 8787, estado local do Durable Object).
Terminal 2: npm run dev (Vite em 5173 com proxy de /api).

## Fontes oficiais

- Cloudflare Workers — Static Assets billing and limitations: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Cloudflare Durable Objects — Limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare Workers — Pricing: https://developers.cloudflare.com/workers/platform/pricing/
