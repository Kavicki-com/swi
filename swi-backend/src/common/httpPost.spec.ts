import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { httpPostJson } from './httpPost'

// Mesmo motivo do httpGetJson: o fetch() global é o undici, que derrubava o
// processo no servidor de 1 GB ao instanciar o parser em WebAssembly. O POST
// do push vai pelo node:http(s), sem dependência nova.
describe('httpPostJson', () => {
  let server: Server
  let base: string
  let lastBody = ''
  let lastHeaders: IncomingHttpHeaders = {}
  let lastMethod = ''

  beforeAll((done) => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf8')
        lastHeaders = req.headers
        lastMethod = req.method ?? ''
        if (req.url === '/ok') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ data: [{ status: 'ok', id: 'r1' }] }))
        } else if (req.url === '/erro') {
          res.writeHead(500)
          res.end('{"errors":[{"code":"INTERNAL"}]}')
        } else if (req.url === '/lento') {
          // nunca responde: deixa o timeout agir
        } else {
          res.writeHead(404)
          res.end()
        }
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      base = `http://127.0.0.1:${addr.port}`
      done()
    })
  })

  afterAll((done) => {
    server.close(() => done())
  })

  it('manda POST com o corpo em JSON e os headers pedidos', async () => {
    const res = await httpPostJson(`${base}/ok`, [{ to: 'a', título: 'Evacuação' }], { Authorization: 'Bearer x' })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: [{ status: 'ok', id: 'r1' }] })
    expect(lastMethod).toBe('POST')
    expect(JSON.parse(lastBody)).toEqual([{ to: 'a', título: 'Evacuação' }])
    expect(lastHeaders['content-type']).toBe('application/json')
    expect(lastHeaders.accept).toBe('application/json')
    expect(lastHeaders.authorization).toBe('Bearer x')
    // Content-Length em bytes, não em caracteres: o corpo tem acento.
    expect(Number(lastHeaders['content-length'])).toBe(Buffer.byteLength(lastBody))
  })

  it('não-2xx: ok=false com o status (não lança, quem chama decide)', async () => {
    const res = await httpPostJson(`${base}/erro`, {})
    expect(res.ok).toBe(false)
    expect(res.status).toBe(500)
  })

  it('timeout: rejeita em vez de pendurar', async () => {
    await expect(httpPostJson(`${base}/lento`, {}, {}, 300)).rejects.toThrow(/timeout/i)
  }, 5000)

  it('conexão recusada: rejeita', async () => {
    await expect(httpPostJson('http://127.0.0.1:1/nada', {})).rejects.toThrow()
  })
})
