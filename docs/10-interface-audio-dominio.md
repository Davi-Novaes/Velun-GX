# Atualização de interface, áudio e diagnóstico

Endereço de teste: https://discordmeet.ddns.net:8443. O certificado permanece autoassinado: o domínio não elimina o aviso do navegador. Não se alteraram firewall, DNS externo ou portas de mídia.

## Interface e mídia

- Grade e destaque com controles separados, tela cheia por transmissão e layout mobile.
- Áudio opcional de aba/sistema, quando disponibilizado pelo navegador, sem captura de microfone. Selecionar áudio do sistema pode incluir a chamada do Discord; o site não consegue excluir um aplicativo dessa mistura.
- Um player de áudio por transmissão assistida, independente do modo de visualização. Volume/mute são individuais; parar de assistir remove a reprodução e assinatura.
- Qualidade configurada separada de resolução real recebida/capturada e FPS medidos. A resolução é limitada pela fonte e pelo navegador, sem prometer upscale.
- Ping da aplicação separado do RTT WebRTC até o SFU. Não representam latência visual ponta a ponta. Estatísticas remotas são informadas pelo emissor, não usadas para autorização.
- Priorização de resolução no encoder, camadas intermediárias de simulcast e debounce de troca de camada por tamanho do player. Controle de congestionamento permanece ativo; rede/CPU podem reduzir a qualidade.
- Canais existentes habilitam screen_share_audio no próximo ingresso, mantendo as restrições contra câmera/microfone e o limite de transmissores existente.

## Validação e implantação

Testes unitários frontend, backend e integração; teste WebRTC com dois navegadores cobrindo áudio, mute, volume, troca de fonte, alteração de qualidade e mobile. Captura sintética: disponibilidade real de áudio depende do sistema operacional/navegador.

Compilar imagens localmente. Implantar com infra/scripts/deploy-reformulation.sh, que salva banco, código e tags de rollback antes de substituir backend/frontend. Atualizar certificado com infra/scripts/enable-test-domain.sh, que preserva certificado/chave anteriores. Não recriar banco ou SFU.
