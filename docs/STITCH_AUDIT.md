# Auditoria do export do Stitch

Data: 16/10/2026. Fonte: stitch_mesa_21_social_blackjack_experience(1).zip.

## Inventário auditado

| Caminho | Tamanho | Observação |
| --- | ---: | --- |
| mesa_21_lobby_principal/code.html | 33.608 bytes | Lobby com cartões de sala, busca, filtros, convite e bônus. |
| mesa_21_lobby_principal/screen.png | 28 bytes | Não renderizável como captura PNG; cabeçalho presente, conteúdo insuficiente. |
| mesa_21_mesa_de_jogo_ao_vivo/code.html | 36.993 bytes | Mesa com dealer, mão de jogador, controles, timer e painel social. |
| mesa_21_mesa_de_jogo_ao_vivo/screen.png | 470.390 bytes | Captura de referência incluída no ZIP. |
| mesa_21_sala_de_espera/code.html | 28.260 bytes | Sala de espera com conteúdo social e controles de sala. |
| mesa_21_sala_de_espera/screen.png | 285.644 bytes | Captura de referência incluída no ZIP. |
| mesa_21/DESIGN.md | 10.865 bytes | Tokens e diretrizes visuais. |

O inventário cobre todos os arquivos do ZIP. As duas capturas válidas são referências de revisão; não entram na aplicação.

## Qualidade e estrutura

- As três telas HTML repetem o mesmo bloco de configuração Tailwind e estilos/tokens. As telas têm documentos extensos com estilos e classes inline, sem módulos ou componentes reutilizáveis.
- Tailwind é carregado pelo CDN de runtime; fontes Google e Material Symbols são dependências externas. Isso aumenta dependência de terceiros e torna a apresentação dependente de serviços externos.
- As telas são maquetes: entrada de código de sala usa alert em vez de conectar; busca e filtros só alteram cartões locais; o bônus só troca rótulos. Pedir, parar e dobrar mostram toast. O timer avança com setInterval. Não existe motor de regras nem fonte de cartas.
- Chat, avatares e jogadores aparecem na referência, mas não há integração multiplayer. Não entram na primeira fatia funcional.
- DESIGN.md descreve feltro verde, fundo creme, cartões foscos, sombras suaves, formas arredondadas, Coral, Butter Yellow, Mint, Plus Jakarta Sans e DM Sans, com tom acolhedor e sem estética de cassino de alto risco.
- A paleta YAML do DESIGN.md diverge da seção narrativa: tokens frios e secundário vermelho no YAML, fundo creme e coral na narrativa. A implementação segue a narrativa creme/coral/feltro.
- A captura do lobby está truncada/corrompida (28 bytes); não foi possível validá-la visualmente. O HTML e as demais referências visuais estão disponíveis.

## Decisões de aproveitamento

O primeiro marco reaproveita os princípios, não o HTML exportado: logo textual MESA/21, feltro verde, fundo quente, controles em cápsula, cartas DOM/CSS e Dealer Clarice em SVG inline. Não entram imagens raster, Material Symbols, Tailwind CDN, chat, timer falso ou componentes com jogadores fictícios.

O ZIP permanece referência de design, não código pronto para produção.
