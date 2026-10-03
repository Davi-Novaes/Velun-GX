# Reformulação: contas, servidores e canais

## Auditoria da implementação existente (antes da reformulação)

Frontend: React 19, TypeScript, Vite, React Router, Zustand. `RoomSession` separa estado da interface do contrato `RoomClient`; `LiveKitRoomClient` implementa o contrato real. `LiveKitScreenShare` captura com getDisplayMedia, aplica constraints proporcionais e publica VP8 com simulcast. Áudio atual é opcional e separado. Players possuem volume local, mute e fullscreen.

Backend: ASP.NET Core/.NET 10 em Domain/Application/Infrastructure/Api, EF Core e PostgreSQL. Redis implementa locks distribuídos e rate limiting. Cookie HttpOnly/SameSite Strict contém JWT de convidado com renovação; NÃO existe cadastro de conta/senha. Existe validação de origem, mas a comparação atual precisa incluir esquema e os endpoints de conta devem exigir defesa CSRF apropriada.

Mídia: LiveKit já é SFU. O navegador conversa diretamente com seu signaling WebSocket e transmite/recebe WebRTC via ICE/STUN/TURN; a API emite tokens e chama a API administrativa do SFU. Não existe SignalR no projeto atual. O cliente não cria uma conexão por espectador: o SDK gerencia transporte de publicação/assinatura com o SFU. Assinaturas explícitas realmente interrompem recebimento de tracks não escolhidas. `adaptiveStream` e `dynacast` já estão habilitados; não garantem sozinhos que FPS/captura se adaptem à CPU.

Persistência: guests, rooms, participants e stream_sessions. As salas atuais expiram por inatividade; canais permanentes NÃO podem depender dessa expiração. Webhooks autenticados atualizam participantes/tracks; eventos têm proteção contra duplicidade e sessões antigas. Manutenção limpa reservas de entrada antigas e salas inativas, mas não reconcilia todos os conectados com o SFU. UI depende dos eventos LiveKit no canal atual.

Qualidade: é configurada só ao iniciar. `start()` para a captura anterior, portanto NÃO deve ser usado para simples alteração de qualidade. Criar operação independente, aplicando constraints à captura e parâmetros às encodings existentes, inclusive camadas simulcast; preservar publicação/canal. Troca de fonte pede novo seletor e replaceTrack, mantendo a captura antiga até sucesso. Cancelamento mantém transmissão antiga.

## Arquitetura alvo e decisões

```
Navegador — React/Zustand
  ├─ HTTPS API: conta, membership, canais, convites, tokens
  ├─ WSS SignalR: snapshots/deltas de presença dos canais do servidor
  └─ WSS + WebRTC: LiveKit (tracks apenas das telas desejadas)
             │
ASP.NET Core ├─ PostgreSQL: contas e recursos permanentes
             ├─ Redis: locks, limites e presença temporária/TTL
             └─ LiveKit: mídia, webhooks e reconciliação
```

Preservar mídia, SDK, captura, RoomClient, SFU, Redis, PostgreSQL e infraestrutura Docker/Traefik/TURN. Introduzir camada de produto por cima, sem reescrever WebRTC. Servidor aqui significa comunidade, não máquina/SFU.

Conta terá UUID, username normalizado e único, hash pelo PasswordHasher do ASP.NET Core Identity, security stamp, datas e avatar opcional. Usar autenticação cookie de conta separada da sessão convidada; cookie HttpOnly, Secure em produção, sessão persistente com expiração, logout/invalidação e rate limiting de login. Persistir chaves Data Protection fora do container. Sem e-mail/SSO/recuperação nesta etapa. Conta tem GuestId exclusivo interno para reaproveitar o domínio de mídia, nunca para conceder autorização de conta a um convidado.

Dados novos: users, community_servers, server_members, channels, server_invites. Membership única (server,user), role extensível string owner/member, permissões centralizadas no backend. Canal possui ordenação e vínculo opcional exclusivo à sala de transporte; sala pode ser criada/reativada sob lock quando necessário, sem apagar o canal. Excluir servidor é operação explícita/confirmada; inicialmente soft-delete e bloqueio imediato de entrada/tokens. Remover membro precisa invalidar acesso e expulsar do SFU/SignalR, não só remover uma linha. Ownership permanece fonte de verdade em Server.OwnerUserId; Owner não pode simplesmente sair sem transferir/excluir.

Invites: segredo aleatório criptográfico, somente SHA-256 armazenado, expiração, revogação e limite opcional de usos; consumo e membership transacionais, aceitação idempotente. GET público revela só nome/ícone/contagem/invitador necessários, nunca listagem privada de membros.

Presença: reutilizar Participant/StreamSession vinculados ao usuário pelo GuestId, não duplicar tabelas de transmissão. Redis mantém leases temporários de conexão; LiveKit é autoridade de presença no canal. SignalR distribui estado somente a membros autorizados. Reconciliar com SFU e publicar snapshots versionados na reconexão. Heartbeat do app não pode declarar uma track ativa por si só. Troca de canal deve sair/parar tracks anteriores, confirmar nova entrada e descartar callbacks obsoletos.

Novo requisito substitui limite anterior: canais novos começam com 4 transmissores, 20 participantes; capacidade superior depende de medições. Limite deve ser validado no servidor, não apenas no botão React. Fluxo novo somente vídeo; manter suporte técnico separado para áudio futuro, sem indicador de áudio ausente. Salas legadas continuam temporariamente com comportamento atual.

Visualização: grade automática dos remotos por padrão; exceções de ocultação locais persistem durante a sessão, sem reativar tela explicitamente desabilitada. Modo foco é independente da seleção/assinatura. Prévia local pequena fora da grade por padrão. ResizeObserver mede palco; algoritmo testa colunas/linhas e maximiza área de vídeo proporcional considerando largura, altura, gaps e número de telas. Sem colunas fixas para qualquer quantidade. Metadados e ações discretos em hover/menu acessível por teclado. Cards parados/carregando têm estados explícitos.

## Contratos implementados

- POST /api/v1/auth/register, /login, /logout; GET /auth/me.
- GET /api/v1/auth/csrf emite token vinculado à identidade da conta; operações de escrita usam X-CSRF-Token.
- GET/POST /api/v1/servers; GET/PATCH/DELETE /servers/{id}; POST /servers/{id}/leave.
- POST /servers/{id}/channels; PATCH/DELETE /channels/{id}; PUT /servers/{id}/channels/order. Canais são listados em GET /servers/{id}.
- POST /servers/{id}/invites; GET /invites/{code}; POST /invites/{code}/accept; DELETE /servers/{id}/invites/{id}.
- Membros são listados em GET /servers/{id}; DELETE /servers/{id}/members/{userId} remove o membro e sua mídia. PUT /servers/{id}/icon atualiza PNG sanitizado no cliente e validado no backend.
- POST /channels/{id}/join retorna contrato SFU atual + channelId/identity/policy; POST /channels/{id}/leave.
- POST /channels/{id}/broadcast com {enabled:true|false}: concessão administrativa no SFU sob lock, máximo quatro publicadores; token inicial não permite publicar. Lease inicial de 45 segundos, renovada pela track real do SFU.
- Hub /api/v1/presence: Watch(serverId), Heartbeat; Presence inicial, Snapshot completo a cada reconciliação e AccessRemoved. Não existem deltas versionados nesta versão; snapshots completos, inscrição única por conexão e descarte de callbacks de efeitos antigos evitam depender de eventos perdidos. Nenhum vídeo passa pelo hub.

Toda operação consulta membership/ownership no backend. Nunca aceitar role/userId declarado pelo frontend como prova de permissão. Tokens de mídia restritos ao canal, sources permitidas e TTL. Rotas legadas não poderão contornar autorização de salas vinculadas a canais.

## Riscos e mitigação

- JWTs de convidado não são contas: não reaproveitar silenciosamente como login.
- SFU/RAM do servidor de teste limitado: builds já causaram indisponibilidade transitória; build fora do servidor, rollout controlado, sem prometer 4×1080p60 para todos antes de medir.
- Migração: schema aditivo, backup PostgreSQL antes do deploy, inspeção SQL, testes com banco real descartável; nunca limpar volumes.
- Eventos perdidos/fora de ordem: versões, snapshots, reconciliação SFU, expiração de leases; não confiar apenas em beforeunload.
- Revogação: tokens já emitidos e grupos SignalR requerem remoção ativa.
- Resolução original depende da fonte real, navegador e política; não inventar 1080p onde fonte não fornece. Mudanças podem ser recusadas: restaurar estado anterior e avisar sem encerrar canal.
- Sem recuperação por e-mail: perda de senha não tem fluxo automático; informar ao cadastrar.

## Fases e critérios de avanço

1. Auditoria/documento (este arquivo).
2. Modelo aditivo + migration + testes de invariantes e PostgreSQL real.
3. Cadastro/login/logout/me, hash, cookies, CSRF, sessão persistente e autorização testados.
4. Servidores/membership/convites reais e sidebar; testar duas contas, persistência após login e acessos negados.
5. CRUD/ordenação dos canais, owner/member, testes de isolamento.
6. SignalR, leases e reconciliação, testes de fechamento/reconexão.
7. Reusar SFU por canal, troca segura e limite de 4; bloquear bypass legado; teste navegadores reais.
8. UI discreta, vídeo-only, preview própria pequena e menus.
9. Grade adaptativa com 1/2/3/4/5+ telas, seleção automática e ocultação real.
10. Foco/voltar à grade/fullscreen, ESC e teclado sem múltiplos atalhos conflitantes.
11. Qualidade em andamento e troca de fonte, testar identidade da publicação/continuidade do vídeo.
12. Reconexão, refresh, canal/servidor removido, ausência de participantes fantasmas.
13. Medir banda/CPU/RAM/RTT/perda sob múltiplas salas; ajustar camadas/bitrate sem mascarar problemas.
14. Refinamento desktop/mobile e cenário de sucesso A/B/C/D ponta a ponta.

Compilar, testar e corrigir após cada fase. Não publicar plataforma parcialmente migrada como produto concluído. Esta fase não altera o servidor público.

## Estado final da implementação

Fases 1–14 implementadas e verificadas localmente. Plataforma em `/app`, com contas, servidores permanentes, ícones, convites, canais, controle owner/member, presença real, quatro transmissores por canal e grade responsiva. Salas legadas preservadas em `/legacy` e `/room/{codigo}`. Canais não podem ser acessados pelos endpoints convidados.

Migrations: CommunityFoundation (contas/servidores/membros/canais/convites), AccountSessions (sessões revogáveis), ChannelMedia (salas persistentes e lease de publicação), ServerIcons (ampliação do campo de ícone) e ChannelAccountBinding (sessão/security stamp da autorização de mídia). Up aditivos, sem limpeza de volumes; rollback de imagens antigas não exige apagar o schema. Não executar Down de ServerIcons sobre ícones maiores.

Modelo: users 1:N account_sessions; users N:N community_servers via server_members; community_servers 1:N channels e server_invites; channels 0:1 rooms; rooms 1:N participants/stream_sessions. FK de participants para account_sessions nullable mantém legado. Conta possui GuestId exclusivo para integração com mídia, sem conceder autorização entre cookies diferentes. Senhas têm hash PasswordHasher (210.000 iterações); sessões persistem sete dias e logout revoga apenas a sessão atual. Sem recuperação automática/alteração pública de senha. Convites têm código aleatório de 128 bits, SHA-256 no banco e expiração de sete dias.

Fluxo de entrada: autenticar cookie HttpOnly → validar CSRF/membership/canal → lock e reserva até 20 → garantir sala SFU → token curto restrito e sem publish → SDK conecta → webhooks/reconciliação confirmam. Para compartilhar: clique direto chama getDisplayMedia(video, audio:false) → backend concede publicação sob lock de quatro vagas → SDK publica VP8/simulcast. Falha libera concessão e para captura. Parada despublica track e revoga concessão.

Qualidade muda constraints e limites das encodings existentes, preservando captura/publicação. Falha tenta restaurar configuração anterior e avisa. Troca de fonte usa novo seletor nativo e replaceTrack; cancelar mantém a anterior. Voz futura permanece possível com tracks separadas, porém não há microfone nem áudio no produto novo.

Presença: SFU é autoridade; worker a cada três segundos reconcilia salas ativas e reservas, valida conta/sessão/membership e remove tokens revogados. Heartbeat de interface não cria participantes nem telas. Reconexão nativa do SDK e SignalR; refresh lembra apenas o ID do canal em sessionStorage (sem credenciais), volta com novo token, mas não recaptura tela. Inscrições ocultadas param efetivamente o recebimento de vídeo.

Data Protection usa volume accountkeys com UID não-root 1654; proteger host e backups porque não há criptografia extra das chaves em repouso. Produção exige cookie Secure. API possui CSRF, comparação de Origin e rate limits; credenciais SFU/TURN nunca são expostas no bundle. Monitoramento diagnóstico utiliza getStats real e identifica RTT corretamente como ida/volta.

Build backend/frontend passou; há um aviso de tamanho do chunk de mídia (~517 kB antes de gzip), não um erro de compilação. Dependências React/mídia/presença estão separadas e Nginx entrega conteúdo comprimido. Resultados de testes, carga e limitações estão em [08-validacao-reformulacao.md](08-validacao-reformulacao.md).

Escalabilidade futura: LiveKit pode distribuir salas em nós via Redis; backend ainda usa registry SignalR em memória. Antes de múltiplas instâncias backend, adicionar backplane e coordenar reconciliadores. Não apresentar o registry atual como presença distribuída completa.

## Referências verificadas

- LiveKit, protocolo e transports: https://docs.livekit.io/reference/internals/client-protocol/
- LiveKit, adaptiveStream/dynacast: https://docs.livekit.io/reference/client-sdk-js/interfaces/RoomOptions.html
- ASP.NET Core Identity, hashing e cookies: https://learn.microsoft.com/en-us/aspnet/core/security/authentication/identity-configuration?view=aspnetcore-10.0
