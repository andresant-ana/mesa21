# M8 — Mitigação inicial contra abuso (Cloudflare Workers)

## Implementação

O Worker consulta os bindings de **Rate Limiting** antes de efetuar chamadas a Durable Objects, derivar senhas (PBKDF2) ou criar sessões. Limites planejados por ator e por ponto de presença Cloudflare:

| Binding | Limite por 60 s | Recursos |
|---|---:|---|
| `ABUSE_API` | 360 | Requisições gerais `/api/*` |
| `ABUSE_AUTH` | 12 | POST de cadastro, login e recuperação |
| `ABUSE_SIGNUP` | 4 | POST de cadastro especificamente |
| `ABUSE_ROOMS` | 150 | Listagem, criação, convites, snapshots e ações de salas |
| `ABUSE_SOCKETS` | 20 | Handshakes WebSocket de sala |

- O ator é o IP de conexão **fornecido pelo edge Cloudflare**, não um valor enviado em JSON, query string ou `X-Forwarded-For` arbitrário. Nenhum IP é gravado na base do jogo.
- Os limites de autenticação são adicionais ao bloqueio já existente de cinco erros por username em 15 minutos.
- Em caso de limite excedido, o Worker devolve **HTTP 429**, JSON `RATE_LIMITED`, cabeçalho `Retry-After: 60`, e **não consulta o DO**.
- Em **produção**, a ausência de qualquer binding ou da identidade de conexão gera **HTTP 503** (falha fechada); falha de consulta aos limites também devolve 503. Não desabilitar tais controles para contornar um deploy malsucedido.
- Em desenvolvimento, controles ausentes são tolerados apenas para testes unitários locais. `wrangler.jsonc` declara bindings no ambiente padrão e no `production`.
- As interfaces apresentam mensagens de erro amigáveis para 429/503, sem alegar sucesso ou retentar automaticamente operações que modificam saldo.

## Proteção adicional de conexões ativas

O Durable Object `RoomLobby` também estabelece limites de conexão **simultânea**, independentemente das quotas de frequência:

- No máximo **2 WebSockets por sessão visitante em uma mesma sala**.
- No máximo **40 WebSockets por sala** (incluindo espectadores).
- No máximo **256 WebSockets simultâneos** no DO global (limite conservador para o MVP gratuito).
- Solicitações acima dos limites devolvem HTTP 429 `SOCKET_CAPACITY` sem criar WebSocketPair.
- Ao sair da sala, as conexões dessa sessão são fechadas com código 1008. Snapshots posteriores ignoram/revogam qualquer socket cuja sessão já não tenha vínculo com a sala, evitando vazamento do estado de uma mesa privada após a saída.
- A contagem utiliza `getWebSockets()`, preservando os controles durante hibernação do Durable Object, sem contador volátil.
- Usuário pode continuar acompanhando a mesa por requisições HTTP se não for possível manter WebSocket; a UI informa o estado da conexão.

Essas quotas são intencionais para grupos pequenos e não equivalem a rate limiting global nem garantem ausência de sobrecarga.

## Limites e riscos importantes

A Rate Limiting API da Cloudflare é **aproximada e local a cada ponto de presença**: não fornece quota global exata, nem protege contra ataques distribuídos por vários IPs ou pontos de presença. Pessoas que compartilham um mesmo IP (casas, escolas, CGNAT) podem atingir o mesmo limite — acompanhar false positives. Os limites devem ser ajustados com métricas reais.

Não é substituto para **Turnstile, WAF/Advanced Rate Limiting, verificação de sessão e limites duráveis por conta**. Em particular, o rate limiter não limita o número de WebSockets simultaneamente abertos e não evita milhões de contas por múltiplos IPs. Exigir controle adicional de conexões simultâneas e proteção de cadastro antes de crescimento público.

O rate limiting não é seguro como controle transacional de créditos, pagamentos ou quotas de bônus. Manter validação server-side e ledger idempotente nesses fluxos.

Requisitos: Wrangler >= 4.36.0. Os IDs de namespace de Rate Limiting são identificadores inteiros escolhidos no arquivo, não recursos que precisem de criação no Dashboard. Nenhum serviço pago foi contratado.

## Verificação

- Testes isolados: edge ausente ou bindings ausentes na produção retornam 503, autenticação e cadastro em burst retornam 429, IP diferente passa, limite de WebSocket é separado, falha do limiter não libera acesso, Worker não chama o DO quando bloqueado.
- CI: `npm run check`, `npm test`, `npm run build`, `npm run deploy:check`, `npm run smoke`, `npm run ui-smoke`.
- Em deploy futuro, acompanhar respostas 429 e 503 no Cloudflare Workers Observability, sem armazenar IPs em logs de aplicação.

Referência oficial: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
