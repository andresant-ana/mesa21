# MESA/21

Blackjack solo, gratuito e leve, com créditos exclusivamente fictícios e identidade visual Playful Minimalism. Partida, cartas, resultado e saldo casual são autoritativos no servidor. Não há dinheiro real nem créditos classificatórios.

## M1 — Fundação e jogo solo

- Cliente HTML/CSS/TypeScript responsivo, sem framework de interface.
- Cloudflare Worker + Durable Object: sessão visitante e estado da partida no servidor.
- Motor de seis baralhos, cartas embaralhadas com fonte criptográfica, natural 3:2, hit, stand, double, split, empate e dealer para em soft 17.
- Créditos casuais separados; API não aceita cartas, saldo ou resultado informados pelo navegador.
- Clarice em SVG inline e cartas desenhadas com CSS; sem imagens raster ou CDN de ícones.
- Lobby social inicial em `/salas.html`: salas públicas/privadas, convites por URL, ocupação de cadeiras e WebSocket de participantes. **Partidas multiplayer ainda não implementadas.**
- Testes determinísticos e CI com checagem estrita de tipos.

### Ainda não implementado

Contas, autenticação, recuperação entre dispositivos, partidas multiplayer, chat, ranking global, créditos classificatórios, protocolo de fairness verificável, deploy público e proteção operacional contra abuso automatizado. O saldo de visitante depende do cookie; limpar cookies perde a sessão, e criar várias sessões não é impedido.

## Rodar localmente

Requisito: Node.js 22.12 ou superior.

1. Instale dependências com npm install.
2. Rode npm run check, npm test e npm run build.
3. Em terminais separados, rode npm run dev:api e npm run dev.
4. Abra http://localhost:5173.

Wrangler mantém os Durable Objects no ambiente local.

## Organização

- src/domain: regras e tipos de blackjack.
- src/worker: endpoints, validação de origem e sessão.
- src/client: mesa solo, cartas acessíveis e chamadas à API.
- tests: suíte determinística do motor.
- docs/STITCH_AUDIT.md: inventário e achados do export Stitch.
- docs/ARCHITECTURE.md: arquitetura, limites de confiança e execução local.
- docs/IMPLEMENTATION_PLAN.md: marcos e critérios.
- docs/SOCIAL_ROOMS.md: contrato das salas de espera reais e limitações de lançamento.

O repositório apresenta exclusivamente MESA/21. Leia a arquitetura, a auditoria Stitch e o plano para detalhes.
