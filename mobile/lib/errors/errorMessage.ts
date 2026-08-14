// Mensagem de erro que o usuário vê. O backend já responde em pt-BR e com o
// motivo exato ("E-mail já cadastrado", "aguardando aprovação do administrador"),
// e o apiRequest anexa `status`. A função preserva mensagens acionáveis quando
// são seguras para exibição e usa o fallback para falhas internas.
//
// Nem toda message do servidor serve pra tela, então há três exceções:
//   429 → o throttler responde "ThrottlerException: Too many requests" (inglês,
//         jargão). E os limites são baixos (5/min no cadastro, confirmação,
//         reenvio e recuperação), então é MUITO alcançável num teste real.
//   5xx → "Internal server error" não diz nada a quem está do outro lado;
//         o fallback da tela é mais útil.
//   rede → o fetch estoura antes de existir status ("Network request failed").
export function errorMessage(err: unknown, fallback: string): string {
  const status = typeof err === 'object' && err !== null ? (err as { status?: number }).status : undefined
  const raw = err instanceof Error ? err.message.trim() : ''

  if (status === 429) return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.'
  if (status !== undefined && status >= 500) return fallback
  if (status === undefined && isNetworkFailure(raw)) {
    return 'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.'
  }
  return raw.length > 0 ? raw : fallback
}

// Sem status = o request nem chegou a ter resposta. As mensagens variam por
// plataforma (RN: "Network request failed"; web: "Failed to fetch"; timeout de
// DNS/túnel: "Network error").
function isNetworkFailure(message: string): boolean {
  return /network|fetch|timeout|conex/i.test(message)
}
