export type NetworkLevel = 'good' | 'fair' | 'poor' | 'unknown'

/**
 * Qualidade da conexão para o indicador (estilo Discord).
 * Ping até o servidor de mídia: verde abaixo de 50 ms, amarelo a partir de 50 ms, vermelho a partir de 150 ms.
 * Perda de pacotes só piora o nível quando é relevante (≥ 5% amarelo, ≥ 15% vermelho).
 */
export function networkLevel(pingMs: number | undefined, lossPercent: number | undefined): NetworkLevel {
  if (pingMs === undefined) return 'unknown'
  const loss = lossPercent ?? 0
  if (pingMs >= 150 || loss >= 15) return 'poor'
  if (pingMs >= 50 || loss >= 5) return 'fair'
  return 'good'
}

export const NETWORK_LABEL: Record<NetworkLevel, string> = {
  good: 'Conexão boa',
  fair: 'Rede instável',
  poor: 'Rede ruim',
  unknown: 'Diagnóstico',
}
