declare const __APP_BUILD__: string | undefined

/** Identificação da versão publicada (data/hora do build). Aparece no diagnóstico de quem transmite. */
export const APP_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'
