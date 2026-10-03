const reason = new URLSearchParams(location.search).get('reason') ?? ''
document.getElementById('reason').textContent = reason.includes('CERT')
  ? 'O certificado do servidor não é o esperado. Atualize o Velun Gx ou fale com quem administra o servidor.'
  : `Verifique sua internet e tente de novo. Detalhe: ${reason}`
document.getElementById('retry').addEventListener('click', () => window.velun.retry())
// tenta sozinho a cada 15 s
setTimeout(() => window.velun.retry(), 15000)
