# M3/M4 — Salas sociais e blackjack compartilhado

## Implementado nesta entrega
- Endpoint `GET /api/rooms` lista somente salas **públicas**.
- `POST /api/rooms` cria uma sala casual pública ou privada e ocupa a cadeira do anfitrião (HTTP 201).
- `GET /api/rooms/:code` consulta uma sala por código/convite de 12 caracteres.
- `POST /api/rooms/:code/join` inclui participantes: máximo cinco jogadores, depois até vinte espectadores.
- `POST /api/rooms/:code/leave` sai e transfere host ao primeiro participante restante; sala vazia é removida.
- `GET /api/rooms/:code/stream` entrega notificações WebSocket em tempo real para quem já entrou na sala.
- Página `/salas.html` utiliza estes endpoints, permite criar, procurar, entrar, sair e copiar convites; em falha de socket, usa polling leve como fallback.
- Todas as mudanças persistem em um singleton Cloudflare Durable Object (`RoomLobby`), com serialização das mutações.

## M4 — Blackjack casual multiplayer
- Um dealer e sapato de seis baralhos compartilhados, até cinco participantes por rodada e regra S17.
- Anfitrião inicia apostas: `POST /api/rooms/:code/start`.
- Cada jogador aposta: `POST /api/rooms/:code/bet`; após todas as apostas, inicia automaticamente. O host pode distribuir antecipadamente com `POST /api/rooms/:code/deal` quando pelo menos um apostou.
- Prazo do servidor: 2 minutos para registrar apostas; 45 segundos por mão ativa. Expiração da aposta distribui para quem apostou ou cancela a rodada vazia. Expiração do turno executa parada automática sem creditar resultados duas vezes.
- Ações pedir, parar, dobrar e dividir: `POST /api/rooms/:code/action`, com validação do turno no servidor.
- Créditos casuais separados por sala, sem vínculo com solo, rankings ou dinheiro real; recarga gratuita ao esgotar fora de rodada.
- Carta fechada e sapato ocultos nas projeções; mãos/resultados/turnos por WebSocket, com polling de fallback.
- Testes do motor cobrem turnos, naturals, split, DAS e pagamentos independentes.

## Escopo e bloqueios
**Ainda não é produto pronto para uso público**: faltam login, contas, histórico, ranking, ledger, bônus diários, chat e deploy. O jogo casual em grupo precisa de QA real de WebSocket/browser e reconexão robusta. O servidor usa alarmes para concluir turnos abandonados. Não habilitar modo classificatório antes da segurança/ledger.

## Segurança atual
- Sessões visitantes dependem de cookie HttpOnly com 256 bits de entropia; o Worker substitui qualquer `x-mesa21-session` enviado pelo cliente.
- Mutações exigem JSON, limite de 4 KB e origem permitida (defesa CSRF).
- Upgrade WebSocket exige sessão existente, origem permitida e participação na sala; cabeçalho interno não é exposto no JSON.
- Códigos de sala de 12 caracteres hexadecimais são gerados via `crypto.getRandomValues`.
- A sala privada não aparece no lobby, e somente pessoas com seu código podem encontrá-la.
- Nome de sala e apelido têm limites e não podem conter controles/HTML; frontend insere texto via `textContent`.

## Limitações operacionais / bloqueios de lançamento
1. **Abuso de sessões:** usuário anônimo pode limpar cookies e criar outras identidades. Adicionar rate limiting/abuse controls antes da publicação.
2. **Capacidade:** um único DO central limita escalabilidade; aceitável como experimento para grupos pequenos, mas migrar para um DO por mesa antes de altas cargas.
3. **Presença:** participantes desconectados permanecem na sala até saírem ou até expiração de 24h; faltam heartbeat, reserva temporária da cadeira e expulsão segura.
4. **Durabilidade:** expiração de 24h sem atualização por evento remove a sala; não há alarme nem log de alterações.
5. **Chat:** indisponível; futura moderação e controles contra abuso são necessários.
6. **Jogo:** timeout automático implementado com Durable Object alarms (2 min para apostas; 45 s por turno, com parada automática). Ainda faltam reconexão e testes concorrentes e2e em runtime Cloudflare.
7. **Qualidade:** faltam testes de ponta a ponta num navegador real, carga WebSocket/DO real, WCAG e visual QA do Stitch.
8. **Custos/deploy:** limites gratuitos Cloudflare e bindings por ambiente devem ser conferidos antes de publicar.

## Próximo marco — multiplayer pronto para lançamento
- Substituir ou dividir o singleton por DO por sala com directory confiável.
- Modelar round com sapato e dealer compartilhados, mãos e apostas individuais server-side.
- Validar turnos, ações de split/double, deadlines, reconexão e liquidações sem duplicar saldos.
- Integrar UI dos assentos e cartas à mesa existente, sem dados fictícios simulando jogadores.
- Testes de concorrência, ocultação de cartas, isolamento de salas, replay e conflitos de sessão.
- Depois implementar contas, ledger e ranking, de forma que bônus nunca sejam computados como lucro.
