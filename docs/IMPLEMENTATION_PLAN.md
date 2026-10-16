# Plano de desenvolvimento por marcos

Cada marco terá PR próprio, CI verde, revisão do diff e evidência de comportamento. Só itens indicados como entregues são implementados.

## M1 — Fundação e blackjack solo autoritativo

**Entregas**
- Aplicação TypeScript com build estático e Worker API.
- Sessão visitante anônima; saldo casual persistido no Durable Object.
- Partida solo com aposta, hit, stand, double (incluindo bust na dobra), natural 3:2, empate e dealer em soft 17.
- Sapato persistente de seis baralhos entre rodadas, reembaralhado após 75% de penetração; créditos iniciais casuais de 2.000 e recarga sem efeito classificatório quando saldo se esgota.
- Clarice em SVG inline; cartas em CSS; layout responsivo.
- Testes do motor, pipeline CI, auditoria Stitch e documentação arquitetural.

**Critérios verificáveis**
- npm install, npm run check, npm test e npm run build passam.
- Testes determinísticos cobrem ases, natural, pagamentos, empate, bust, stand, double e bust em double, validação, S17, sigilo da carta fechada, reuso/reembaralhamento de sapato, recarga casual e rejeição de ações pós-rodada.
- A API pública não serializa sapato/carta fechada nem aceita saldo, cartas ou resultado enviados pelo cliente.
- Saldo casual é gravado no servidor antes da resposta; sessão usa cookie HttpOnly same-site.
- Nenhum chat, multiplayer, ranking ou crédito competitivo é alegado como funcional.

## M2 — Regras e experiência da mesa

- Implementado: split previsto no PRD v1.0, no máximo duas mãos, pagamentos individuais, split de ases com uma carta por mão, DAS permitido, re-split proibido, naipes mistos de valor 10 aceitos. Cobertura determinística no motor e API.
- Pendente: QA visual da mesa dividida e teste manual/automatizado nos principais navegadores.
- Adicionar testes de propriedades e regressões para transições/pagamentos.
- Revisar contraste, teclado/leitor de tela, 320px–desktop e movimento reduzido.
- Critério: regras documentadas, suíte abrangente, avaliação responsiva e acessibilidade sem bloqueios conhecidos.

## M3 — Identidade e economia casual

- Definir autenticação, persistência de conta, recuperação e expiração de sessão.
- Formalizar bônus, limites de aposta, histórico, idempotência e rate limiting.
- Critério: conta/saldo e operações auditáveis no servidor; nenhum saldo gravável pelo cliente; teste de repetição e concorrência.

## M4 — Salas sociais reais

**Implementação parcial:** criação/listagem de salas públicas, salas privadas por código, presença de até cinco participantes com espectadores, saída/troca de host, snapshots e eventos WebSocket via Durable Object. Interface própria em `/salas.html`; detalhes em `docs/SOCIAL_ROOMS.md`. O jogo coletivo casual foi codificado, mas ainda não houve QA real de WebSockets/navegadores; não existe classificação.

- Conectar engine e dealer compartilhados a rodadas multiplayer; garantir turnos, reconexão, apostas/credit ledger individual e encerramento. Transporte e salas de espera básicos já materializados.
- Chat/moderação só após segurança e controles de abuso.
- Critério: testes multi-cliente para ordem de turnos, sigilo e ciclo de vida; reconexão sem duplicar aposta.

## M5 — Competitivo e integridade verificável

- Separar créditos casuais de qualquer classificação, sem transferência entre eles.
- Especificar fairness verificável, prevenção a replay/automação, rate limits, logs e regras do ranking.
- Critério: threat model e protocolo revisados, testes de adulteração/replay/concorrência, auditoria operacional e UI que distingue unidades.

O PRD v1.0 foi posteriormente disponibilizado na conversa e revisado na auditoria de 16/10/2026. Regras omitidas no texto foram fixadas reversivelmente nesta implementação: um split por rodada, split de ases com uma carta e parada automática, DAS permitido, dez-valores mistos tratados como pares. Revisar com testes de produto antes do lançamento.
