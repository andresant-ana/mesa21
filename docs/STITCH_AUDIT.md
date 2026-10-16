# Auditoria inicial — Stitch / MESA/21

Data: 16/10/2026. Material: `stitch_mesa_21_social_blackjack_experience.zip`.

## Inventário

1. `mesa_21_lobby_principal/code.html` (33.608 bytes no ZIP): lobby visual com estrutura Tailwind; screenshot `screen.png` tem 28 bytes e não é PNG utilizável.
2. `mesa_21_sala_de_espera/code.html` (28.260 bytes): estado de espera, convite e demonstração de chat; screenshot PNG presente.
3. `mesa_21_mesa_de_jogo_ao_vivo/code.html` (36.993 bytes): mesa com botões ilustrativos e cartas estáticas; screenshot PNG presente.
4. `mesa_21/DESIGN.md` (10.865 bytes): design tokens e diretrizes do Stitch.

## Diagnóstico

- HTML exportado de cada tela isoladamente, com `tailwindcss.com` via CDN, fontes externas e Material Symbols; não é app modular pronto para produção.
- Botões e scripts de demonstração não constituem lógica de blackjack válida, autenticação ou sincronização multiplayer.
- A mesa exportada inclui estatísticas/estados de jogadores fictícios e não implementa consistência real de turnos.
- Identidade visual aprovada: Plus Jakarta Sans, superfícies claras, verde feltro #1D3F36, acento coral #FF6B57, formas arredondadas, cartas e dealer em SVG/CSS.

## Decisões

- Código exportado mantido apenas como **referência de design**, na pasta `design/stitch/`.
- Implementação funcional isolada do motor; interface independente de Tailwind-CDN.
- Não inventar salas online ou contas; indicadores explicitamente rotulados como futuro trabalho.
- Não enviar arquivos raster do ZIP como assets da aplicação; o screenshot danificado foi descartado.

## QA pendente

Comparação visual lado a lado com as telas originais em browser desktop, revisão mobile em 390px e 320px, navegação por teclado, contraste, performance e smoke E2E (há falha ambiental no Chromium disponível nesta execução).
