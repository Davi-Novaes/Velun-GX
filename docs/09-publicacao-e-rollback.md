# Publicação do servidor de teste

Endereço atual: https://186.236.226.179:8443. Windows/WSL Ubuntu-24.04, projeto em `/opt/tela`. Acesso administrativo por VPN/SSH, não pela aplicação web. HTTPS ainda usa certificado de teste; DNS/certificado confiável permanecem pendentes para produção.

## Atualização realizada

Imagens compiladas localmente e transferidas por SSH; não construir no host com pouca RAM. `infra/scripts/deploy-reformulation.sh` valida o diretório de staging, gera backup PostgreSQL/custom format, guarda código/Compose anterior, cria tags rollback e carrega imagens antes de recriar somente backend/frontend. SFU, Redis, PostgreSQL, proxy e TURN não são reiniciados. `.env` e certificados não entram no pacote.

Backup desta publicação: `/opt/tela/backups/20261001T065059Z`, permissões restritas. Tags: `screenshare-backend:rollback-20261001T065059Z` e `screenshare-frontend:rollback-20261001T065059Z`. O schema novo é aditivo: não usar migrations Down nem restaurar banco automaticamente para voltar às imagens anteriores.

Correção adicional de timeout do SFU publicada em seguida: backup `/opt/tela/backups/20261001T070002Z`, que inclui as contas de teste criadas após o primeiro rollout. Tags correspondentes terminam em `rollback-20261001T070002Z`; representam a primeira versão da reformulação, anterior à correção. Preferir a versão final corrigida. A correção foi testada com timeout repetido e pausa real do SFU local, sem reiniciar a API.

## Operação no WSL

```bash
cd /opt/tela
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml logs --tail 100 backend
```

Não executar `down -v`: apagaria dados. Nunca usar a sobreposição `docker-compose.test.yml` no servidor público.

## Rollback manual se necessário

Pode interromper conexões; deve ser ação administrativa deliberada. Preserva schema/dados e reaproveita as imagens antigas:

```bash
cd /opt/tela
cp backups/20261001T065059Z/docker-compose.yml infra/docker-compose.yml
docker tag screenshare-backend:rollback-20261001T065059Z screenshare-backend:latest
docker tag screenshare-frontend:rollback-20261001T065059Z screenshare-frontend:latest
docker compose -f infra/docker-compose.yml -f infra/docker-compose.prod.yml up -d --no-build --no-deps backend frontend
```

Fonte anterior guardada em `source-before.tar.gz`. Recuperação de banco é procedimento separado e exige avaliar dados novos; o dump não deve sobrescrever silenciosamente cadastros posteriores. Proteger e guardar separadamente .env/certificados/volume accountkeys para recuperação completa do host.

## Para testar com amigos

Abrir o link HTTPS, aceitar o certificado de teste quando necessário, criar conta, criar servidor e canal, usar Convidar amigos → Gerar convite → copiar link. Amigos criam conta e aceitam o convite. Até 20 pessoas, quatro transmitindo por canal. A nova plataforma transmite somente imagem, não áudio do Discord. Não confundir servidor/comunidade da UI com servidor Windows.

UDP 7882 validada publicamente. TURN em redes restritas ainda exige liberação e validação das portas relay/fallback. Não prometer suporte universal a redes corporativas com apenas 7882 liberada.
