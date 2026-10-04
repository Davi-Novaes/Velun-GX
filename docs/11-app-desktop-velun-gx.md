# 11 — App desktop Velun Gx (Windows)

App Electron que abre o sistema (`https://discordmeet.ddns.net:8443/app`) e transmite a tela com o **som do PC sem a call do Discord**.

## Como funciona

| Parte | Onde | O que faz |
|---|---|---|
| Componente de áudio | `desktop/native/VelunAudio` (.NET, `VelunAudio.exe`) | Captura por processo do Windows 11 (build 20348+). Padrão: todo o som do PC **excluindo a árvore de processos do Discord** (Discord, PTB, Canary); acompanha o Discord abrir/fechar. `--include-hwnd N`: só o programa de uma janela. Saída: PCM 16 bits/48 kHz/estéreo no stdout, estado em JSON no stderr. |
| App | `desktop/src` (Electron) | Seletor de tela/janela próprio, certificado do servidor fixado por SHA-256 (`desktop/src/config.ts`), ponte `window.velun`, atualização automática. |
| Página | `frontend/src/desktop/velun.ts` | Só ativa dentro do app. Converte o PCM em faixa de áudio (AudioWorklet, ~40 ms de folga) publicada como `screen_share_audio`. |

**Eco (0.2.6+):** o Windows só exclui UMA árvore de processos por captura. Para tirar ao mesmo tempo o Discord e o próprio Velun Gx (que toca o som das transmissões dos outros), o componente lista as sessões de áudio de todas as saídas de som, captura cada programa separadamente (modo "incluir") e mistura tudo, procurando programas novos a cada segundo (`--multi --exclude-tree-pid <pid do app>`). Assim você ouve os outros transmitindo enquanto transmite, sem eco. Sons de notificação do Windows ficam de fora. Se o Windows não deixar listar as sessões, o componente cai para o modo antigo (só sem o Discord) e a página silencia as outras transmissões enquanto você transmite.

## Publicar uma versão nova

1. Aumente `version` em `desktop/package.json`.
2. `cd desktop && npm run dist` → gera `desktop/release/VelunGx-Setup.exe`, `.blockmap` e `latest.yml`.
3. Copie os três arquivos para `/opt/tela/infra/downloads/` no servidor (servidos em `/downloads/`, fora da imagem do site).
4. Apps instalados baixam a versão nova sozinhos (a cada 4 h e ao abrir) e instalam ao fechar. O site mostra o link **Baixar app** quando existe `latest.yml`.

## Instalação de atualizações (0.2.5+)

- "Reiniciar e atualizar" espera o componente de áudio sair (ele roda de dentro da pasta do app) e abre o instalador **com janela de progresso**; ao terminar, o Velun Gx abre sozinho. Antes (0.2.0–0.2.4) a instalação era silenciosa: sem nada na tela, quem abria o app de novo no meio dela fazia a instalação falhar e o app antigo pedia a mesma atualização outra vez.
- Antes de instalar, o app grava `update-attempt.json` na pasta de dados. Se abrir de novo ainda na versão antiga, mostra "A atualização para a versão X não foi concluída" com **Tentar de novo** e **Baixar instalador**.
- Registro do atualizador: `%APPDATA%\Velun Gx\logs\updater.log` (peça esse arquivo para diagnosticar a falha de alguém).

## Certificado do servidor

O app só aceita o certificado cuja impressão digital está em `desktop/src/config.ts` (o atual vence em 03/11/2027).
Ao trocar o certificado: **primeiro** inclua a nova impressão digital, publique uma versão do app e espere os apps atualizarem; **só depois** troque o certificado no servidor. Na ordem inversa, os apps instalados deixam de conectar e precisam ser reinstalados.

## Testes

- Teste de atualização: sempre com `--user-data-dir=<pasta temporária>` e `VELUN_UPDATE_URL`; nesses modos o app **nunca instala**. Mesmo assim, o instalador e o cache (`%LOCALAPPDATA%\velun-gx-updater`) são compartilhados com o app instalado: compare a versão do app instalado antes e depois.
- `VELUN_SMOKE=1 npx electron .` (em `desktop/`): abre o servidor, confere seletor, ponte e som sem o Discord e encerra. No executável instalado, use também `VELUN_SMOKE_OUT=<arquivo>`.
- Página nova sem publicar: `STACK_URL=https://discordmeet.ddns.net:8443 npx vite` (em `frontend/`) e `VELUN_URL=http://localhost:5173 npx electron .`.

## Limites

- Windows 11. No Windows 10 a tela vai sem som e o app explica o motivo.
- Instalador sem assinatura digital: o Windows mostra "O Windows protegeu o computador" na primeira instalação (Mais informações → Executar assim mesmo).
