// Configuração do Velun Gx. Variáveis de ambiente só para desenvolvimento/testes.

/** Endereço do sistema (por enquanto só a porta 8443, sem Let's Encrypt). */
export const SERVER_URL = new URL(process.env.VELUN_URL ?? 'https://discordmeet.ddns.net:8443')

/** Servidores onde o certificado fixado é aceito (o próprio sistema; em testes, também quando o app aponta para localhost). */
export const PINNED_HOSTS = new Set(['discordmeet.ddns.net', SERVER_URL.hostname])

/**
 * Impressões digitais SHA-256 aceitas para o certificado autoassinado do servidor (infra/scripts/server-cert.sh).
 * Atual: CN=discordmeet.ddns.net, válido até 03/11/2027. Ao trocar o certificado, inclua o novo aqui ANTES
 * de trocar no servidor e publique uma versão do app; senão o app recusa a conexão (sem cair para "aceitar tudo").
 */
export const PINNED_CERTIFICATES = [
  '16:AE:11:EE:68:D2:DF:1C:F1:C3:4E:E7:0A:F4:39:3F:27:B1:7D:C6:BA:3C:B4:31:A4:B9:99:79:6E:2D:0A:B0',
  ...(process.env.VELUN_CERT_SHA256?.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean) ?? []),
]
