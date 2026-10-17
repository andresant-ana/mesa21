# M5 — Autenticação e recuperação (entrega incremental)

## Disponível nesta implementação
- `/conta.html` em PT-BR: cadastro, login, recuperação, perfil conectado e logout.
- `POST /api/auth/register`: username único (case insensitive) e senha de 8–128 caracteres.
- `POST /api/auth/login`: verificação de senha e criação de sessão nova.
- `GET /api/auth/me`: perfil público mínimo da sessão.
- `POST /api/auth/logout`: revogação no servidor.
- `POST /api/auth/recover`: código de recuperação de uso único, nova senha, revogação de todas as sessões antigas, emissão de novo código.
- Conta e sessões armazenadas em Durable Object persistente `AccountDirectory`, singleton `accounts-v1`. Salts aleatórios, PBKDF2-SHA256 com 210.000 iterações, hash SHA-256 dos códigos de recuperação e tokens de sessão (não armazenamos senha, códigos ou tokens em claro).
- Cookies HttpOnly, SameSite=Strict e Secure em HTTPS, 30 dias; em login/recovery a sessão é rotacionada. O token nunca é exposto ao JavaScript nem devolvido na resposta HTTP.
- Todas as mutações exigem JSON e Origin permitido; o Worker remove headers de identidade forjados pelo navegador antes de chamar o DO.
- Bloqueio por username após cinco falhas, por 15 minutos; sessões expiradas removidas no acesso, até cinco sessões ativas por conta.

## Decisão de infraestrutura e escopo
O plano original discutiu Cloudflare D1; a implementação atual utiliza **SQLite-backed Durable Object** já disponível no plano gratuito e não exige criar/configurar um banco D1 antes de publicar. Essa escolha acelera o MVP de grupos pequenos, mas um diretório singleton não é arquitetura para uso em massa. Uma migração D1 só deve ser feita com migração testada e backup dos dados.

**IMPORTANTE:** este marco adiciona identidades persistentes; **as sessões de blackjack solo e as salas ainda usam identidade de visitante e créditos casuais temporários.** Os saldos, rankings e histórico por conta serão integrados no M6. A tela de perfil deixa isso claro. Não apresentar créditos por sala como carteira persistente.

## Limitações antes do lançamento público
1. Antifraude e rate limiting por IP/ASN/bot ainda não existem. O limite por username mitiga ataques dirigidos, mas não cadastro em massa ou spray com nomes diferentes; implantar Turnstile/rate limiting de borda antes de expor.
2. PBKDF2-WebCrypto foi escolhido por ser suportado em Workers. Revisar parâmetros e custo CPU real no plano Cloudflare e preferir Argon2id se houver suporte seguro na plataforma. Não usar SHA-256 direto em senhas.
3. Falta atualização voluntária de senha estando autenticado (a recuperação via código já permite redefinir), invalidação de todas as sessões por escolha do usuário e políticas finais de retenção/exclusão.
4. O limite de 1.000 contas é deliberado para evitar sobrecarga de um singleton e bloquear cadastro sem capacidade.
5. Falta auditoria de acessibilidade e testes visuais do formulário em navegadores/dispositivos reais.
6. Sem e-mail, quem perde **senha e código** não tem como provar a titularidade; explicar isso claramente.
7. Não habilitar ranking nem moeda classificatória até o ledger transacional e controle de abuso estarem validados.

## Validação
- `npm run check`, `npm test`, `npm run build` e `npm run smoke` no CI da PR.
- Testes adversariais: senhas inválidas, username duplicado, limitações de tentativas, segredo fora de storage e JSON público, recuperação single-use, sessões revogadas e cookies protegidos.
- Smoke em Worker/DO local real: registrar, recuperar e invalidar sessão antiga, logout.

Este documento descreve uma entrega incremental; a aprovação final de M5 depende da integração ao motor de partidas e da revisão de segurança pré-lançamento.
