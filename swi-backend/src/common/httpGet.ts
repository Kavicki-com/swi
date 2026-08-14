import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'

// GET JSON sem o fetch() global. Motivo: o fetch do Node é o undici, que
// instancia o parser HTTP em WebAssembly na PRIMEIRA chamada. No servidor de
// produção, com 1 GB de RAM, essa alocação falha sob pressão de memória e
// derruba o processo inteiro, o que acontece toda vez que alguém abre o
// dashboard e o painel pede /weather. node:https usa o parser nativo em C, sem
// Wasm e sem pico de alocação.
//
// A superfície imita o fetch de propósito ({ ok, status, json() }): os dois
// consumidores (Open-Meteo e Mapbox Directions) migraram com diff mínimo.
export interface JsonResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export function httpGetJson(url: string, timeoutMs = 5000): Promise<JsonResponse> {
  const parsed = new URL(url)
  const getFn = parsed.protocol === 'http:' ? httpGet : httpsGet
  return new Promise((resolve, reject) => {
    const req = getFn(url, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const status = res.statusCode ?? 0
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: status >= 200 && status < 300,
          status,
          json: () => Promise.resolve(JSON.parse(body)),
        })
      })
      res.on('error', reject)
    })
    req.setTimeout(timeoutMs, () => {
      // destroy com erro explícito: sem isto o socket morre mudo e a Promise
      // fica pendurada — exatamente o que o timeout existe pra impedir.
      req.destroy(new Error(`httpGetJson: timeout de ${timeoutMs}ms em ${parsed.host}`))
    })
    req.on('error', reject)
  })
}
