# 11 — App desktop Velun Gx (Windows)

App Electron que abre o sistema (`https://discordmeet.ddns.net:8443/app`) e transmite a tela com o **som do PC sem a call do Discord**.

## Como funciona

| Parte | Onde | O que faz |
|---|---|---|
| Componente de áudio | `desktop/native/VelunAudio` (.NET, `VelunAudio.exe`) | Captura por processo do Windows 11 (build 20348+). Padrão: todo o som do PC **excluindo a árvore de processos do Discord** (Discord, PTB, Canary); acompanha o Discord abrir/fechar. `--include-hwnd N`: só o programa de uma janela. Saída: PCM 16 bits/48 kHz/estéreo no stdout, estado em JSON no stderr. |
| App | `desktop/src` (Electron) | Seletor de tela/janela próprio, certificado do servidor fixado por SHA-256 (`desktop/src/config.ts`), ponte `window.velun`, atualização automática. |
| Página | `frontend/src/desktop/velun.ts` | Só ativa dentro do app. Converte o PCM em faixa de áudio (AudioWorklet, ~40 ms de folga) publicada como `screen_share_audio`. |

**Eco:** o som do PC inclui o som que o próprio app toca. Enquanto alguém transmite o som do PC (modo sem Discord), o som das transmissões dos outros fica pausado só no PC dessa pessoa.

## Publicar uma versão nova

1. Aumente `version` em `desktop/package.json`.
2. `cd desktop && npm run dist` → gera `desktop/release/VelunGx-Setup.exe`, `.blockmap` e `latest.yml`.
3. Copie os três arquivos para `/opt/tela/infra/downloads/` no servidor (servidos em `/downloads/`, fora da imagem do site).
4. Apps instalados baixam a versão nova sozinhos (a cada 4 h e ao abrir) e instalam ao fechar. O site mostra o link **Baixar app** quando existe `latest.yml`.

## Certificado do servidor

O app só aceita o certificado cuja impressão digital está em `desktop/src/config.ts` (o atual vence em 03/11/2027).
Ao trocar o certificado: **primeiro** inclua a nova impressão digital, publique uma versão do app e espere os apps atualizarem; **só depois** troque o certificado no servidor. Na ordem inversa, os apps instalados deixam de conectar e precisam ser reinstalados.

## Testes

- `VELUN_SMOKE=1 npx electron .` (em `desktop/`): abre o servidor, confere seletor, ponte e som sem o Discord e encerra. No executável instalado, use também `VELUN_SMOKE_OUT=<arquivo>`.
- Página nova sem publicar: `STACK_URL=https://discordmeet.ddns.net:8443 npx vite` (em `frontend/`) e `VELUN_URL=http://localhost:5173 npx electron .`.

## Limites

- Windows 11. No Windows 10 a tela vai sem som e o app explica o motivo.
- Instalador sem assinatura digital: o Windows mostra "O Windows protegeu o computador" na primeira instalação (Mais informações → Executar assim mesmo).
