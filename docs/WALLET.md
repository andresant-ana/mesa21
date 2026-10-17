# M6 — Economia persistente e ranking fictício (primeira fatia funcional)

## Contrato implementado
- Cada conta autenticada possui uma carteira de créditos **exclusivamente fictícios**, inicializada com 2.000 créditos.
- Bônus diário de 500 créditos, uma vez por dia no calendário `America/Sao_Paulo` (virada à meia-noite de Brasília).
- A carteira persiste no mesmo Durable Object SQLite `AccountDirectory`, que serializa as mutações de conta, saldo, apostas e resultados.
- `GET /api/wallet` retorna saldo, resgate disponível, movimentações, rounds recentes e lucro histórico, sem dados de senha ou tokens.
- `POST /api/wallet/claim` concede bônus uma única vez por dia. Durante mão classificatória ativa é bloqueado para evitar inconsistência entre saldo reservado e jogo.
- `GET /api/ranked/session`, `POST /api/ranked/start` e `POST /api/ranked/action` controlam o blackjack solo classificatório, com cartas, baralho, apostas e pagamentos **exclusivamente no servidor**.
- `GET /api/ranking?period=weekly|monthly|historical` calcula top 100 a partir de partidas classificatórias **liquidadas**. Bônus diário, saldo inicial e créditos casuais não geram lucro de ranking.
- `/classificatoria.html`, `/carteira.html` e `/ranking.html` compartilham o Playful Minimalism existente, sem imagens raster, com conteúdo verdadeiro (ranking inicialmente vazio).
- Por segurança, salas multiplayer continuam casuais e isoladas, sem créditos classificatórios.

## Invariantes
1. Toda alteração de crédito autenticado é registrada em `wallet.ledger` com ID de evento, horário, motivo, valor e saldo após a operação.
2. ID duplicado de evento é rejeitado; cada partida tem `roundId`, índice próprio de ação e resultado registrado uma única vez.
3. Start e action só podem ser executados por sessão autenticada válida. Ações fora de fase, apostas fora dos limites, saldo insuficiente, hit/double/split inválidos e replay são rejeitados.
4. Na abertura a aposta é debitada; cartas são embaralhadas com `crypto.getRandomValues`, seis baralhos, dealer S17, natural 3:2; pagamentos seguem o motor testado.
5. O lucro é diferença de saldo antes/depois da rodada **concluída**; bônus e concessões não contam. As janelas semanal e mensal seguem datas de São Paulo.
6. Não há dinheiro real, depósitos, saques, transferências ou resgate.

## Limitações e próximos passos
- **M6 multiplayer classificatório ainda não implementado:** para executar várias apostas classificatórias com segurança é necessária uma reserva/escrow transacional vinculada a ledger e conclusão idempotente entre Durable Objects. Não converter os créditos casuais de sala em saldo classificatório.
- O ledger atual está integrado ao mesmo snapshot da conta; para maior escala, particionar por conta e arquivar movimentos antigos com verificação/auditoria.
- O ranking ainda não possui detecção de conluio, multi-contas ou identidades abusivas; preservar limites modestos e exigir autenticação no modo classificatório.
- O resultado agregado de mão dividida conta como uma rodada na métrica atual, e o lucro somado reflete todas as mãos corretamente.
- Falta histórico completo navegável, perfil público, QA visual em navegador e fairness verificável externamente.
- Antes de produção: teste de carga do Durable Object singleton, abuse controls e retenção de dados. O uso gratuito está condicionado a cotas Cloudflare; sem conta conectada não houve publicação.

## Validação esperada
`npm run check`, `npm test`, `npm run build`, `npm run smoke` no CI. Smoke local testará login real, bônus, partida e ranking, além do multiplayer casual.
