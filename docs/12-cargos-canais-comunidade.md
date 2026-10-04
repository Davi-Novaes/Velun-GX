# Evolução da comunidade — 3 de outubro de 2026

Implementação sobre a versão atual do Velun Gx 0.2.3. Mantidos áudio do PC sem Discord, seletor nativo do desktop, PiP, apelidos, convites sem prazo, qualidade de captura, controles de tela cheia e reprodução independente de áudio. O desktop carrega o site publicado: essas mudanças não exigem um instalador novo nem alteração do certificado fixado.

## Navegação e visual

Superfícies mais pretas, participantes dentro dos canais e selo vermelho AO VIVO clicável. Botão direito sobre um usuário abre informações e ações autorizadas; o mesmo painel abre por clique para mobile. Membros do servidor aparecem em um painel opcional, agrupados por cargo e com busca. Ping próprio fica no painel inferior de conexão; ping alheio aparece nas informações do membro quando há amostra no canal atual.

Destaque usa um quadro dimensionado para vídeo mais controles, sem distorção. Miniaturas ficam ao lado em telas largas e abaixo nas estreitas. O selo AO VIVO deixa de herdar largura/altura de 9px da classe antiga de pontos de status. A lista de espectadores abre fora do recorte do cartão; atualizações idênticas não reiniciam indefinidamente o envio da lista. Reentrada limpa seu estado de publicação.

## Cargos por servidor

Migração aditiva ServerRoles: tabela server_roles e server_members.server_role_id anulável. Todos os membros antigos continuam membros; proprietário mantém controle total. Um cargo por membro, com nome, cor, posição de 1 a 1000 e permissões explícitas. Posição maior significa cargo superior. Sem cargo equivale a posição zero. Proprietário está acima de todos.

Permissões: gerenciar canais (1), convites (2), mover membros (4), desconectar membros (8), remover membros (16), gerenciar cargos inferiores (32), editar nome/ícone (64). Exclusão do servidor continua exclusiva do proprietário.

O backend verifica associação, servidor do cargo, direitos do ator e hierarquia. Não é permitido moderar a si próprio, cargo igual/superior ou proprietário; criar/editar/atribuir cargo acima de si; conceder direitos que o ator não possui. Excluir cargo devolve seus membros ao cargo padrão. Locks de servidor coordenam alterações de cargos e moderação.

APIs autenticadas com CSRF:

- POST /servers/{id}/roles e PUT /servers/{id}/roles/{role}: name, color, position, permissions.
- DELETE /servers/{id}/roles/{role}.
- PUT /servers/{id}/members/{user}/role: roleId ou null.
- POST /servers/{id}/members/{user}/move: channelId ou null para desconectar.
- DELETE /servers/{id}/members/{user}: remoção sujeita a permissão e hierarquia.

Mover verifica destino no mesmo servidor e capacidade, encerra a conexão SFU anterior e avisa o app autorizado por SignalR para ingressar no destino. A transmissão ativa do usuário movido encerra; a captura pode ser iniciada novamente no canal de destino. Em rede instável, a entrada pode precisar de nova tentativa. Não modifica a transmissão dos demais participantes.

## Verificação

Integração sobre PostgreSQL/Redis reais verifica hierarquia, negação de escalada, escopo entre servidores, delegação e remoção de cargos. Navegadores com WebRTC real verificam cargos pela interface, atribuição, movimento via menu e arraste, desconexão, proteção do proprietário, espectadores, resolução/áudio e responsividade. Captura é sintética nos testes. Qualidade visual depende de banda/CPU/fonte; não se promete qualidade perfeita em qualquer rede.
