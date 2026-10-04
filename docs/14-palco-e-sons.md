# 14 — Palco das transmissões e sons da call

## Palco (Grade / Destaque)

`StreamStage` (`frontend/src/features/workspace/StreamGrid.tsx`) recebe `streams[]`, `viewMode = grid | focus` e `focusedStreamId`. A posição e o tamanho de cada transmissão vêm de `computeStageLayout` (`stageLayout.ts`, função pura e testada):

- **Grade:** 1 → `[1]`; 2 → `[1][2]`; 3 → `[1][2] / [3]` (centralizada); 4 → `[1][2] / [3][4]`. Acima de 4, ou em área em pé (celular), escolhe colunas/linhas que deixam cada vídeo maior. Sempre 16:9, sem cortar e sem ultrapassar a área.
- **Destaque:** a principal ocupa o maior retângulo possível com a **proporção real** do vídeo (ultrawide não fica com faixas); as demais viram miniaturas 16:9 numa fileira logo abaixo, que diminuem para caber em vez de rolar. `focusedStreamId` não afeta a grade.
- **Sua transmissão** participa como qualquer outra, marcada "(Você)". Não existe mais a prévia arrastável "Sua transmissão".
- Interações: clique na miniatura troca o destaque; duplo clique na grade destaca; duplo clique na principal = tela cheia; botão "Destacar" e item "Colocar em destaque" no menu.

**Nada de WebRTC muda ao trocar modo ou destaque:** todos os tiles ficam no mesmo container e só recebem novas coordenadas, então o `<video>` não é desmontado nem re-anexado (há teste unitário e e2e verificando o mesmo elemento). O tamanho exibido continua definindo a camada de simulcast (miniatura pede a baixa, principal a alta).

Controles: nome e AO VIVO sempre visíveis; volume, mudo, tela cheia, janela flutuante, menu, ping e qualidade aparecem sobre o vídeo ao passar o mouse (no toque, ao tocar). Em tela cheia, somem após 2,5 s parado. A animação de deslizar acontece só ao trocar modo/destaque ou quando alguém começa/para de transmitir — redimensionar a janela reposiciona na hora.

## Sons da call

`frontend/public/sounds/` — `join.ogg` (entrar na call), `leave.ogg` (sair), `stream-start.ogg` (começar transmissão), `stream-stop.ogg` (parar). Tocam como no Discord, para você e para quem está no mesmo canal: alguém entra/sai, alguém começa/para de transmitir. A lista inicial de quem já estava no canal e as reconexões não tocam som. Em "Sua conta" → Sons da call: ligar/desligar, volume e Testar (preferência guardada no navegador).
