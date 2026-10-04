# Configurações e áudio automático — 3 de outubro de 2026

Evolução sobre a comunidade atual; não substitui a versão anterior do sistema nem altera codecs, bitrate, resolução travada, SFU, certificados ou limites existentes.

## Página de configurações

Abrir o nome do servidor ou Configurações do servidor mostra uma página com navegação Visão geral, Cargos e permissões, Membros, Canais e Convites. A seção é endereçável por `/app/{serverId}?settings=members`, por exemplo. Workspace e conexão de mídia continuam montados: abrir configurações não encerra a transmissão. A tela mantém confirmação para exclusão/remoção, feedback de sucesso/erro, restrições por permissão e navegação responsiva. Configurar canal e gerenciar convites reutilizam os respectivos editores existentes.

Cargos novos recebem posição disponível, não uma posição fixa que colide. Salvar mantém o ID e formulário selecionados, evitando criação acidental de outro cargo. Atribuição está na seção Membros, com confirmação visual e erro local. Hierarquia e autorização continuam validadas no backend. Um cargo por membro permanece a regra vigente.

## Compartilhamento

Início apresenta apenas Janela ou Tela inteira. A seleção definitiva e consentimento continuam no seletor nativo do sistema/navegador. Áudio é solicitado automaticamente (`audio: true`), sem opt-in ou mute do emissor na interface. Cada espectador controla seu mute e volume independentemente, inclusive ao mudar de grade para destaque.

Desktop mantém o helper de captura atual: tela captura PC com exclusão do processo Discord; janela captura o aplicativo selecionado. Exclusão não aparece nos rótulos. Mudança dos textos do seletor nativo exige instalador Velun Gx 0.2.4; a página web atualiza sem reinstalar. Não houve mudança no algoritmo de captura nativa.

No navegador, áudio de tela inteira é oferecido quando suportado, e áudio de janela é solicitado por aplicativo. Não se pode obrigar o navegador a entregar áudio nem contornar consentimento do usuário. Se não vier track de áudio, vídeo continua funcionando e a interface informa ausência de áudio. Exclusão seletiva de Discord continua exclusiva da captura nativa do desktop.

## Correções de layout

Menu de transmissão usa portal fora do recorte da miniatura, posição limitada ao viewport, rolagem em altura pequena e fechamento por Escape/clique externo. Em tela cheia, o portal fica dentro do elemento fullscreen. Contador do canal possui coluna própria, separada do botão de configurações. Não altera seleção de streams, assinaturas ou parâmetros de transmissão.

## Validação

Testes unitários cobrem posição livre, preservação do ID ao salvar, erros locais e opções de áudio. Testes E2E usam navegadores, áudio sintético e WebRTC/SFU reais: mute/volume do espectador, edição/atribuição/moderação, menu da miniatura, múltiplas telas, qualidade ao vivo e layouts desktop/mobile. Captura nativa continua precisando de teste humano com janela/jogo e som real no computador.
