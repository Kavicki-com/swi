// Como a câmera selecionada aparece no painel, pelo esquema do endereço.
//
// - https: dentro do painel, num quadro isolado, e também em nova aba.
// - http: só em nova aba. O painel roda em https e o navegador bloqueia
//   conteúdo http embutido; é o caso típico de câmera num IP da rede da obra.
// - https na origem do painel ou da API: só em nova aba (ver protectedOrigins).
// - qualquer outro esquema: nada. O backend já recusa, isto é a segunda trava,
//   porque um `javascript:` aberto aqui rodaria no navegador do administrador.
import { getApiUrl } from '@/services/api/apiConfig'

export type CameraView =
  | { kind: 'none' }
  | { kind: 'embed'; url: string }
  // O motivo escolhe o aviso da tela: http bloqueado pelo navegador, ou
  // endereço do próprio SWI, que não entra no quadro.
  | { kind: 'link'; url: string; reason: 'http' | 'protected-origin' }

// Origens que nunca entram no quadro: com allow-same-origin, uma página do
// próprio painel ou da API leria a sessão e poderia desfazer o isolamento.
function protectedOrigins(): string[] {
  const origins = [window.location.origin]
  try {
    origins.push(new URL(getApiUrl()).origin)
  } catch {
    // Sem endereço de API configurado não há segunda origem a proteger.
  }
  return origins
}

export function cameraViewOf(
  url: string | null,
  blockedOrigins: ReadonlyArray<string> = protectedOrigins(),
): CameraView {
  if (!url) return { kind: 'none' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: 'none' }
  }
  const { protocol, origin } = parsed
  if (protocol !== 'https:' && protocol !== 'http:') return { kind: 'none' }
  if (protocol === 'http:') return { kind: 'link', url, reason: 'http' }
  if (blockedOrigins.includes(origin)) return { kind: 'link', url, reason: 'protected-origin' }
  return { kind: 'embed', url }
}
