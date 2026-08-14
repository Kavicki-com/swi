import { createServer, type Server } from 'node:http'
import { httpGetJson } from './httpGet'

// Por que este helper existe: o fetch() do Node é o undici, que instancia um
// parser HTTP em WebAssembly na primeira chamada. No servidor de produção, com
// 1 GB de RAM, essa alocação falha sob pressão de memória e DERRUBA o processo
// inteiro, toda vez que o painel pede /weather. node:https não tem Wasm nenhum.
describe('httpGetJson', () => {
  let server: Server
  let base: string

  beforeAll((done) => {
    server = createServer((req, res) => {
      if (req.url === '/ok') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ hello: 'world' }))
      } else if (req.url === '/erro') {
        res.writeHead(503)
        res.end('indisponivel')
      } else if (req.url === '/lento') {
        // nunca responde — deixa o timeout agir
      } else {
        res.writeHead(404)
        res.end()
      }
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

  it('200: ok=true, status e json() com o corpo', async () => {
    const res = await httpGetJson(`${base}/ok`)
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hello: 'world' })
  })

  it('não-2xx: ok=false com o status (não lança — o caller decide)', async () => {
    const res = await httpGetJson(`${base}/erro`)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(503)
  })

  it('timeout: rejeita em vez de pendurar', async () => {
    await expect(httpGetJson(`${base}/lento`, 300)).rejects.toThrow(/timeout/i)
  }, 5000)
})
