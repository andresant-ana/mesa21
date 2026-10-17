# MESA/21 — Auditoria inicial do baralho multiplayer

## Estado: compromisso criptográfico parcial, NÃO provably fair completo

O motor de mesas sociais agora cria um compromisso **SHA-256** com a ordem integral de cada sapato de 6 baralhos (312 cartas) **antes de aceitar apostas naquela rodada**.

Durante a utilização, expõe apenas:
- `protocol: "mesa21-shoe-commit-v1"`
- `commitment`: digest SHA-256 em hexadecimal (64 caracteres).
- `committedAt`: horário do compromisso.
- `revealedCount`: quantidade de sapatos anteriores já aposentados.

O segredo aleatório `nonce` (32 bytes) e a sequência integral do sapato **não aparecem em nenhum snapshot, WebSocket ou consulta pública enquanto o sapato está ativo**.

A cada troca, após 75% de penetração, o sapato anterior é permanentemente aposentado, e só então se publica a prova. A troca também ocorre quando um antigo sapato não está disponível ou é descartado antes de receber apostas. Nenhuma carta daquele sapato aposentado volta a ser distribuída.

## Verificação independente

Endpoint `GET /api/rooms/:code/audit` devolve `current` somente com metadados do sapato ativo e `revealed` com até três provas aposentadas. Cada prova inclui:
- protocolo, compromisso publicado, nonce e 312 cartas na sequência original;
- quantidade de cartas consumidas, horários do compromisso e revelação.

Algoritmo público:

```
payload = "mesa21-shoe-commit-v1" + "\n" + nonceHex + "\n" +
          cartas.map(carta => carta.rank + "/" + carta.suit).join(",")
commitment = hex(SHA256(UTF8(payload)))
```

O verificador `verifyRevealedShoe` confere digest, formato da prova, quantidade/validade das 312 cartas e contagem de consumo. A interface da sala inclui painel discreto para conferir provas aposentadas no próprio navegador.

## Histórico verificável de distribuição (etapa incremental)

Cada saque feito pelo motor multiplayer registra, no estado privado da rodada:
- índice absoluto da carta no sapato comprometido, começando em zero;
- carta efetivamente retirada;
- destinatário (`dealer` ou identificador de assento);
- índice da mão do jogador (0 ou 1 em caso de divisão).

As ações `deal`, `hit`, `double`, `split` e os pedidos automáticos do dealer usam a mesma função de retirada instrumentada. O registro NÃO aparece durante o sapato ativo e é arquivado ao iniciar a próxima rodada, quando a rodada anterior está encerrada. Na aposentadoria do sapato, o campo `draws` da prova contém os saques ordenados de todas as rodadas daquele sapato.

O verificador `verifyShoeDrawTrace` exige que `draws.length === consumed`, que cada índice seja sequencial e que cada carta corresponda à posição comprometida. Alteração, omissão ou reordenação de eventos invalida a verificação de distribuição. O painel do navegador confere **ambos**, compromisso SHA-256 e sequência registrada.

**Importante:** os destinatários e eventos ainda são relatos produzidos pelo próprio servidor; falta vincular cada snapshot visto pelo usuário a um recibo imutável, confrontar todas as ações/regras num replay reproduzível e introduzir semente dos jogadores. Uma prova de saques íntegra NÃO demonstra, sozinha, que o jogador viu exatamente essas cartas.

## Replay determinístico das rodadas (incremento v1)

Quando uma rodada multiplayer termina, o motor preserva internamente a situação inicial dos créditos, **cada aposta e ação efetivamente aceita** (`bet`, `deal`, `hit`, `stand`, `double`, `split`, incluindo eventos automáticos por timeout), o resultado final das mãos e o saldo final dos participantes. Esses dados permanecem privados enquanto o sapato está em uso.

Quando o sapato é aposentado, a prova inclui o campo `rounds` (recibos das rodadas encerradas). O verificador `verifyShoeRoundReplay` recria cada rodada usando a sequência original comprometida, reexecuta apostas e ações sob as regras do motor e compara:
- legitimidade dos turnos e ações;
- mãos, dealer S17, naturais, splits, doubles e desfechos;
- todas as cartas efetivamente consumidas na posição comprometida;
- crédito final de cada jogador, incluindo participantes que deixaram a sala depois do término;
- eventos aceitos, respeitando ordem e estado.

Uma alteração em apostas, ações, resultados, créditos ou dealer invalida o replay. O painel de auditoria na interface verifica três etapas: compromisso SHA-256, histórico de distribuição e replay dos resultados.

**Correção operacional:** uma fase de apostas cancelada por timeout sem nenhuma aposta não descarta mais a contagem de cartas das rodadas anteriores ao aposentar o sapato.

**Limites:** a verificação é retrospectiva, condicionada à disponibilidade da prova aposentada (atualmente até três sapatos por sala). Nenhuma parte do protocolo impede um operador de escolher unilateralmente a ordem inicial do sapato; tampouco vincula de forma imutável cada snapshot visto pelo jogador. Não afirmar fairness completa.

## Limites explícitos (bloqueio de lançamento de fairness)

A prova original atesta que a ordem revelada corresponde ao compromisso anterior. O novo histórico permite conferir que **os saques registrados pelo servidor** seguem essa ordem e não possuem lacunas. **Não atesta por si só aleatoriedade imparcial**, nem vincula criptograficamente todos os snapshots que os jogadores viram, nem oferece escolha de semente pelo jogador. O operador pode preparar baralhos antes do compromisso. O protocolo ainda não cobre solo ou classificatórias.

Para oferecer fairness verificável de ponta a ponta, será necessário:
1. Definir protocolo de semente do servidor pré-comprometida mais contribuição de jogador(es), que não possam ser escolhidas unilateralmente após o compromisso; usar shuffle determinístico verificável sem viés (rejection sampling).
2. Ancorar criptograficamente os recibos e snapshots vistos pelos jogadores durante cada rodada, com retenção consultável, e integrar ledger classificatório idempotente; o replay determinístico de eventos do multiplayer casual já está implementado.
3. Publicar recibos verificáveis assinados ou ancorados em cadeia, retidos além do TTL das salas, e fornecer um verificador independente do código de produção.
4. Estender o protocolo a solo e classificatórias, suportar recuperação e rotação consistente após falhas e submeter à revisão adversarial.
5. Definir política de disponibilidade de provas após fechamento de salas, pois os registros atuais são efêmeros (TTL) e armazenam somente os três últimos sapatos aposentados.

**Não anunciar o site como provably fair neste estágio.** A transparência parcial não é certificação externa.

## Testes

- Replay de dois rounds reais sobre o mesmo sapato reproduz dealer e saldos; alteração de aposta, saldo final, cartas ou sequência de eventos invalida prova.
- Expiração de fase vazia preserva o consumo e o replay de partidas anteriores.
- A aposentadoria após múltiplas rodadas é exercitada por API real de sala, sem manipular artificialmente os dados do baralho.

- Saques efetivos da engine em duas rodadas seguidas correspondem a índices sequenciais do sapato original; qualquer alteração de carta, índice, destinatário ou omissão é rejeitada.
- Retenção evita arquivamento duplo da mesma distribuição.

- Compromisso presente antes da primeira aposta.
- Nenhum nonce nem ordem do baralho atual nas respostas.
- Hash e estrutura de prova aposentada verificam corretamente.
- Mudança em cartas, nonce, contagem ou horário invalida o resultado.
- Troca de sapato gera novo compromisso e expõe exclusivamente o anterior.
- Verificação no navegador/Node usando WebCrypto nativa.

NENHUM deploy foi efetuado.
