# Plano de desenvolvimento por marcos

Cada marco terá PR próprio, CI verde, revisão do diff e evidência de comportamento. Só itens indicados como entregues são implementados.

## M1 — Fundação e blackjack solo autoritativo

**Entregas**
- Aplicação TypeScript com build estático e Worker API.
- Sessão visitante anônima; saldo casual persistido no Durable Object.
- Partida solo com aposta, hit, stand, double, natural 3:2, empate e dealer em soft 17.
- Clarice em SVG inline; cartas em CSS; layout responsivo.
- Testes do motor, pipeline CI, auditoria Stitch e documentação arquitetural.

**Critérios verificáveis**
- npm install, npm run check, npm test e npm run build passam.
- Testes determinísticos cobrem ases, natural, pagamentos, empate, bust, stand, double, validação, S17, sigilo da carta fechada e rejeição de ações pós-rodada.
- A API pública não serializa sapato/carta fechada nem aceita saldo, cartas ou resultado enviados pelo cliente.
- Saldo casual é gravado no servidor antes da resposta; sessão usa cookie HttpOnly same-site.
- Nenhum chat, multiplayer, ranking ou crédito competitivo é alegado como funcional.

## M2 — Regras e experiência da mesa

- Reconciliar regras restantes com o PRD; acrescentar split/limites se previstos nele.
- Adicionar testes de propriedades e regressões para transições/pagamentos.
- Revisar contraste, teclado/leitor de tela, 320px–desktop e movimento reduzido.
- Critério: regras documentadas, suíte abrangente, avaliação responsiva e acessibilidade sem bloqueios conhecidos.

## M3 — Identidade e economia casual

- Definir autenticação, persistência de conta, recuperação e expiração de sessão.
- Formalizar bônus, limites de aposta, histórico, idempotência e rate limiting.
- Critério: conta/saldo e operações auditáveis no servidor; nenhum saldo gravável pelo cliente; teste de repetição e concorrência.

## M4 — Salas sociais reais

- Implementar transporte em tempo real, salas públicas/privadas, ocupação, turnos, reconexão e encerramento.
- Chat/moderação só após segurança e controles de abuso.
- Critério: testes multi-cliente para ordem de turnos, sigilo e ciclo de vida; reconexão sem duplicar aposta.

## M5 — Competitivo e integridade verificável

- Separar créditos casuais de qualquer classificação, sem transferência entre eles.
- Especificar fairness verificável, prevenção a replay/automação, rate limits, logs e regras do ranking.
- Critério: threat model e protocolo revisados, testes de adulteração/replay/concorrência, auditoria operacional e UI que distingue unidades.

O PRD v1.0 mencionado na solicitação não apareceu entre os arquivos disponíveis no início do trabalho. Os critérios funcionais finais devem ser conferidos contra esse texto antes de M2.
