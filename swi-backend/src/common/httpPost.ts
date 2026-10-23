import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { JsonResponse } from './httpGet'

// POST JSON sem o fetch() global, pelo mesmo motivo do httpGetJson: o fetch do
// Node é o undici, que instancia o parser HTTP em WebAssembly na primeira
// chamada, e no servidor de 1 GB essa alocação derruba o processo inteiro.
// node:https usa o parser nativo. A superfície imita o fetch ({ ok, status,
// json() }) para o consumidor (envio de push) ler como leria um fetch.
export function httpPostJson(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 10_000,
): Promise<JsonResponse> {
  const parsed = new URL(url)
  const requestFn = parsed.protocol === 'http:' ? httpRequest : httpsRequest
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  return new Promise((resolve, reject) => {
    const req = requestFn(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          // Em bytes: corpo com acento tem mais bytes que caracteres.
          'Content-Length': String(payload.length),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(JSON.parse(text)),
          })
        })
        res.on('error', reject)
      },
    )
    req.setTimeout(timeoutMs, () => {
      // Erro explícito: sem ele o socket morre mudo e a Promise fica pendurada.
      req.destroy(new Error(`httpPostJson: timeout de ${timeoutMs}ms em ${parsed.host}`))
    })
    req.on('error', reject)
    req.end(payload)
  })
}
