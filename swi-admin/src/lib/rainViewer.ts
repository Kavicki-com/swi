// Manifest da RainViewer indica host de tile cache + lista de timestamps
// de radar. Usamos o PATH (nao timestamp) do ultimo "past" frame. Manifesto
// e leve (~1 KB) mas o usuario pode togglar a layer varias vezes; cache de
// 10 min evita N requests redundantes.

const CACHE_TTL_MS = 10 * 60 * 1000

type ManifestCache = {
  fetchedAt: number
  data: { host: string; path: string } | null
}

let cache: ManifestCache | null = null

export function __resetCache(): void {
  cache = null
}

export async function getRainViewerLatestRadar(): Promise<{
  host: string
  path: string
} | null> {
  const now = Date.now()
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data
  }
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json')
    const data = await res.json()
    const host = data?.host as string | undefined
    const past = data?.radar?.past
    if (!host || !Array.isArray(past) || past.length === 0) {
      cache = { fetchedAt: now, data: null }
      return null
    }
    const path = past[past.length - 1].path as string
    cache = { fetchedAt: now, data: { host, path } }
    return cache.data
  } catch {
    cache = { fetchedAt: now, data: null }
    return null
  }
}
