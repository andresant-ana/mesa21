# MESA/21

Um jogo social de blackjack, gratuito, com **fichas exclusivamente fictícias**, interface leve e visual *Playful Minimalism*. **Esta revisão é um MVP de demonstração solo local, não um serviço multiplayer publicado.**

## Estado verificado

- ✅ Motor blackjack TypeScript isolado (6 baralhos; Fisher–Yates com gerador criptográfico; embaralhamento quando penetração >=75%; S17; natural 3:2; empate; dobrar; dividir uma vez; ases divididos recebem uma carta e param).
- ✅ Jogo solo com dealer Clarice em SVG, cartas CSS, apostas e controles contextuais, teclado H/S, resultados e nova rodada.
- ✅ Lobby de demonstração, página Como Jogar, perfil local, histórico local e bônus de demonstração.
- ✅ Testes unitários do motor (Node built-in test runner).
- ✅ Não depende de imagens raster, bibliotecas de UI ou de Tailwind em runtime.
- ⏳ **Não implementado:** contas, autenticação, saldos confiáveis do servidor, multiplayer, salas públicas/privadas reais, ranking global, chat, fairness verificável por terceiros, deploy.
- ⏳ Sem validação visual em navegador automatizado neste ambiente; recomenda-se QA antes do lançamento.

A prévia é explicitamente marcada como demonstração. Os dados em `localStorage` podem ser alterados pelo próprio usuário e **nunca deverão alimentar rankings ou saldos competitivos**.

## Executar

Requisitos: Node.js 22+ e TypeScript (localmente `npm install`; em CI `npm ci` após criar o lockfile).

```bash
npm install
npm run build
npm test
npm run serve
```

Abra http://localhost:8080 e acesse a mesa pela opção **Jogar sozinho**. É um site estático; não exige servidor de aplicação no MVP solo. Para testar mudanças, execute `npm run build` novamente e recarregue. A implantação futura deverá integrar um bundler ou um servidor de desenvolvimento com hot-reload, se necessário.

## Pastas

```
src/blackjack.ts         # Motor puro de regras/estado
src/main.ts              # Aplicação local de demonstração (HTML/SVG)
src/styles.css           # Design system e estilos responsivos
src/index.html           # Entrada web
tests/blackjack.test.mjs # Testes do motor
scripts/                 # Build estático
 design/stitch/           # Referência original exportada do Stitch
 docs/                    # Auditoria, regras e backlog
```

## Integridade e limitações

- Sem dinheiro real, pagamentos, saques ou itens conversíveis em valor monetário.
- A conta `Visitante` e os créditos locais não são contas autenticadas.
- Resultados solo calculados no navegador não são provas de justiça competitiva.
- Em multiplayer, **o servidor deverá deter e validar** baralho, jogadas, apostas, saldo, bônus e resultados; clients não poderão escrever no saldo nem enviar cartas arbitrárias.
- Salas privadas não devem aparecer no diretório público.

## Roadmap interno

Veja [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md). Qualquer extensão para outros jogos deve ficar fora da comunicação pública: o produto apresentado é exclusivamente MESA/21.