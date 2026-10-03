# Validação da plataforma — 01/10/2026

## Escopo e ambiente

Aplicação real em Docker Desktop: PostgreSQL, Redis, LiveKit, Coturn e Traefik. Testes de navegador usam contextos independentes, cookies próprios, signaling e WebRTC reais. A captura é sintética; não representa jogo pesado, monitor 4K real ou rede doméstica degradada. Nenhum número abaixo é uma medição de latência ponta a ponta (glass-to-glass).

81 testes unitários de backend, 49 de integração com PostgreSQL/Redis descartáveis e 81 testes frontend passaram. A integração substitui somente o SFU por fake; Playwright complementa usando LiveKit real. Suíte ponta a ponta final: 13 testes passaram, 1 carga opt-in pulada nessa execução (carga executada separadamente nos dois cenários abaixo). Regressão legada passou com Chrome, Edge e Firefox, captura com/sem áudio, parada nativa, volume/mute, fullscreen, HTTPS e TURN forçado local. Novos testes validam contas, servidor, convite, presença, quatro transmissores, grade, ocultação, foco, fullscreen, alteração de qualidade preservando captura e participantes, troca de fonte, saída e responsividade. Teste adicional verificou reconexão de sinalização, remoção de membro do SFU e exclusão de canal ativo. Refresh confirmou retorno ao canal/recepção sem recapturar tela. Alternância rápida de assinaturas confirmou vídeo em movimento.

Na inspeção pós-publicação foi identificado timeout HTTP do SFU provocando encerramento do worker/host: TaskCanceledException foi confundida com shutdown. Corrigidos PresenceWorker e RoomMaintenanceService para tratar cancelamento como shutdown somente quando o token do host está cancelado. Teste de regressão induz repetidos timeouts e confirma worker/API vivos, sem ApplicationStopping. Também foi pausado o container SFU local por 11 segundos: API continuou respondendo 401 em auth/me, StartedAt do backend permaneceu igual e o worker registrou timeout recuperável. SFU foi despausado em finally; os testes de resiliência e mídia direta passaram depois. Isso não significa que mídia continue disponível quando o SFU está parado; a API permanece ativa e a reconciliação pode voltar depois.

## Publicação e teste pelo endereço público

Publicado em https://186.236.226.179:8443 após backup PostgreSQL, código anterior, Compose e tags rollback das imagens. Backup inicial: `/opt/tela/backups/20261001T065059Z`; correção de timeout publicada com segundo backup `/opt/tela/backups/20261001T070002Z`. `.env`, proxy, certificados, SFU e TURN preservados; backend/frontend foram recriados no primeiro rollout e só backend na correção. Chaves de conta usam novo volume persistente.

Dois testes ponta a ponta passaram contra esse endereço: transmissão direta com candidato remoto público 186.236.226.179/UDP 7882 (sem TURN) e cenário completo da plataforma com quatro contas/transmissores, convite, grade, foco, ocultação, qualidade ao vivo, fonte, saída e refresh. Executados da máquina de desenvolvimento com contextos independentes, não de quatro redes físicas distintas. A exceção de verificação do certificado foi aplicada somente ao processo de teste; o certificado público ainda é autoassinado.

Cadastro em produção limita cinco contas por hora por IP. O teste público utilizou quatro desse IP; contas de amigos em outros IPs têm limites próprios. Caso vários usuários compartilhem o mesmo IP/NAT, planejar a quantidade de cadastros sem desabilitar os controles.

## Carga real medida localmente

| Cenário | Publicadores / espectadores | Janela medida | RX agregado nos espectadores | Maior RTT observado | Perda reportada |
|---|---|---|---|---|---|
| 1 canal × 20 pessoas | 1 / 19 | 20 s | 9,26 Mbps | 5 ms | 0% |
| 5 canais × 20 pessoas | 5 / 95 | 20 s | 16,24 Mbps | 35 ms | 0% |

Todos os espectadores apresentaram incremento de quadros e bytes recebidos. Fonte 720p/30 sintética; camadas adaptativas, janelas fora do primeiro plano e conteúdo de baixa complexidade influenciam bitrate. O RX agregado não é a banda total da infraestrutura. Perda vem dos contadores disponíveis do navegador e não prova ausência de perdas em todos os saltos.

No cenário de 100 pessoas, LiveKit passou de 294,1 para 295,6 MiB; CPU em duas amostras foi 24% e 104,55% (Docker: aproximadamente um núcleo no último ponto, não 104% da máquina inteira). Backend: 181→184,5 MiB, CPU 1,82→80,37%; PostgreSQL: 46,39→47,14 MiB, CPU 0,33→50,03%. Amostras não são médias nem picos garantidos. O host local disponibilizou 15,57 GiB; o servidor público dispõe de muito menos memória. Não extrapolar capacidade para ele.

## Reproduzir

Somente para testes locais, a sobreposição relaxa rate limits para cadastros saindo do mesmo IP. **Não publicar docker-compose.test.yml no servidor.**

```powershell
docker compose -f infra/docker-compose.yml -f infra/docker-compose.test.yml up -d --build
npm --prefix frontend test
npm --prefix frontend run test:e2e -- workspace.spec.ts community-resilience.spec.ts
$env:E2E_LOAD = '1'
$env:LOAD_ROOMS = '5'
$env:LOAD_USERS = '20'
$env:LOAD_SECONDS = '20'
npm --prefix frontend run test:e2e -- load.spec.ts
```

O teste gera relatório JSON anexado ao relatório Playwright e imprime amostras de docker stats. Para 10 canais/200 pessoas, use LOAD_ROOMS=10: cenário preparado, **não executado nesta validação**. Realizar teste sustentado de pelo menos 30 minutos em hardware de destino antes de ampliar o serviço. Não desabilitar segurança para facilitar medições públicas.

## Limitações importantes

- 20 pessoas inclui o transmissor; 1 transmissor + 20 espectadores excede a política.
- 4K/1440p não têm presets dedicados novos; Original respeita fonte, navegador e teto da política. Não aumenta artificialmente uma captura quadrada para 1920×1080.
- Bitrate/FPS/resolução são tetos e intenções, não garantias. Navegador e congestionamento podem reduzi-los. Não há transcoding/gravação/buffer de streaming tradicional.
- Captura em celular e Safari depende das APIs disponíveis. Visualização responsiva não significa captura garantida nesses dispositivos.
- Rede offline no contexto Playwright testa sinalização/presença, não perda de UDP no roteador. Perda total e degradação controlada precisam de ensaio de rede dedicado.
- TURN forçado foi validado localmente. Porta pública UDP 7882 permite mídia direta, mas não basta para garantir redes corporativas/UDP bloqueado. Relay público e fallback precisam das respectivas portas liberadas e teste externo.
- HTTPS por IP usa certificado de teste autoassinado. Para produção, configurar DNS e certificado confiável.
- Presença reconciliada a cada 3 segundos, heartbeat a cada 20 segundos e lease de UI de 60 segundos. Sem prometer remoção instantânea após corte físico abrupto.
- SignalR usa uma instância backend; Redis protege locks e leases, mas não distribui o registry/hub entre instâncias. Escalar backend requer backplane e coordenação do reconciliador. Escalar LiveKit requer planejar roteamento Redis, banda e alocação de salas.
