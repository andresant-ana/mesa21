# MESA/21 — Plano interno de implementação

**Estágio 1, em execução:** referência visual incorporada, motor de regras puro, testes, mesa de treino solo, lobby honesto, perfil/histórico e bônus local. Sem auth e sem contas reais; recurso temporário.

**Estágio 2 — Serviços confiáveis:** Cloudflare Workers + D1 (contas, autenticação username/senha com Argon2id ou outro KDF robusto compatível, cookies HttpOnly/SameSite/Secure, sessões rotacionáveis e recuperação por códigos); ledger idempotente com transações atômicas, bônus diário baseado em tempo de servidor, limites de aposta e resgate. Validar capacidade real dos serviços/gratuidade antes de contratar; não presumir cota infinita.

**Estágio 3 — Multiplayer autoritativo:** um Durable Object por sala mantendo estado e WebSockets; entrada e reconexão; jogadores/assentos até cinco, espectadores, prazos de ação e abandono; criação pública/privada; convites protegidos por token opaco; integridade das fichas via ledger; snapshots e recuperação. Clientes enviam somente intenções e recebem snapshots sem cartas ocultas. Salas privadas não aparecem no lobby público.

**Estágio 4 — Competição:** regras padronizadas em salas classificatórias, lucro líquido por mãos liquidadas independente de bônus, intervalos semanal/mensal/histórico, critérios mínimos de participação, replay e auditoria de mão. Modo casual sem efeito no ranking e com saldo separado/ilimitado; nenhuma recarga instantânea deve contaminar o ranking.

**Estágio 5 — Segurança e publicação:** testes de concorrência, ataques de duplicação/replay, CSRF/XSS, rate limiting, antiabuso de contas/bônus, auditoria de aleatoriedade, compromisso pré-rodada e revelação pós-rodada adaptados ao sapato contínuo, política de idade e enquadramento jurídico, WCAG AA, web vitals, política de privacidade, deploy estático gratuito e rollback.

**Especificações a fechar antes do multiplayer:** split exato vs mesmo valor de 10 (atualmente mesmo valor), split após split (atualmente apenas uma divisão), double after split (permitido), dealer blackjack peek, surrender/insurance (não suportados), timezone e frequência de bonus. Registrar os valores públicos por sala e garantir testes. O motor atual serve de base, mas a migração para servidor deve eliminar autoridade do client.

**Critérios para declarar versão pública funcional:** `npm test` em CI, testes E2E browser, fluxo multiusuário real em 2 dispositivos, persistência servidor e integridade transacional, responsividade, segurança de sessão e evidência de deploy. Nenhum deles pode ser inferido do ZIP do Stitch.
