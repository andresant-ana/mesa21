# M7 — QA de interface no Chromium

O CI executa, além dos testes de domínio e do smoke Worker/DO, o script `npm run ui-smoke`.

## Verificações automatizadas
- Carrega páginas solo, lobby, ranking, conta e carteira com Chromium real nos viewports **1440, 1024, 390 e 320 pixels**.
- Confirma que nenhum desses documentos ultrapassa a largura útil do viewport.
- Testa cadastro e apresentação do código de recuperação em formulário verdadeiro.
- Usa cookie da conta no navegador para verificar resgate diário, saldo persistido, mesa solo classificatória e ranking gerado a partir da partida.
- Salva capturas em `artifacts/ui`; o código de recuperação é **mascarado** na imagem de teste.
- Os artefatos ficam disponíveis no run do GitHub Actions (não são capturados códigos de recuperação em claro).

## Preservação de identidade
- Fundo creme, feltro verde, coral suave, amarelo amanteigado, tipografia humanizada.
- Cartas HTML/CSS e dealer Clarice inline SVG, sem imagens geradas por IA ou dependências WebGL.
- Cantos arredondados e controles contextuais do blackjack.
- Cabeçalho responsivo com menu horizontal rolável em telas pequenas, evitando botões comprimidos.

## Limites desta validação
- As screenshots são evidência de renderização, **não um atestado de fidelidade pixel-a-pixel** ao Stitch.
- Acesso por teclado, leitores de tela, contraste WCAG AA e desempenho em celulares de entrada exigem auditoria específica adicional.
- A CI usa Chromium; Safari/Firefox e dispositivos físicos ainda não foram verificados.
- Páginas e testes existem, mas o site **não foi publicado**.
