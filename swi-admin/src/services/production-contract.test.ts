// Guarda de entrega: o grafo de produção do admin fala REST e nada mais.
//
// O painel nasceu com um eixo de seleção de backend (mock in-memory vs provider
// legado) que hoje não existe mais. Estas asserções travam o estado final: as
// fachadas de serviço apontam para a API real, `authApi` não reaproveita nenhuma
// implementação simulada, e nenhum módulo do caminho de produção importa VALOR
// de `mockApi` — só tipo (contratos como MockResponse); os tipos de view que
// as telas consomem vivem em módulos neutros (`services/chat/types`).
//
// Se alguém reintroduzir um seam de simulação, isto quebra no `npm test`, que é
// o momento barato de descobrir. Descobrir em produção custa um incidente.
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..')

// Arquivos que PODEM falar com o mock: as próprias simulações, as suítes que as
// exercitam e as histórias do Storybook. Nada disso entra no bundle de produção.
const isOutsideProductionGraph = (file: string): boolean =>
  /[\\/]services[\\/]mockApi[\\/]/.test(file) ||
  /\.test\.[cm]?[jt]sx?$/.test(file) ||
  /\.stories\.[cm]?[jt]sx?$/.test(file) ||
  /[\\/]test-setup\.ts$/.test(file)

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [full] : []
  })

// Casa a instrução inteira (import ou export, com ou sem quebra de linha) para
// poder distinguir `import type { X } from '.../mockApi/x'` — que só existe em
// tempo de compilação — de um import de valor, que vai para o bundle.
//
// A cláusula de bindings não pode conter aspas: sem isso o `[\s\S]*?` preguiçoso
// atravessa o `from '...'` da instrução ANTERIOR e atribui a este import o
// cabeçalho do outro, perdendo o `type` e acusando falso positivo.
const MOCK_IMPORT =
  /(?:^|\n)\s*(import|export)\s+(type\s+)?([^'"]*?)from\s+['"]([^'"]*mockApi[^'"]*)['"]/g

describe('contrato de produção do admin', () => {
  it('expõe chat e admins vindos da API REST', async () => {
    expect((await import('./chats')).chatsApi).toBe((await import('./api/chats')).chatsApi)
    expect((await import('./admins')).adminsApi).toBe((await import('./api/users')).adminsApi)
  })

  // Checagem de arquivo, não de `import`: um import que lança pode lançar por
  // dependência transitiva ausente e passar falso-verde mesmo com o arquivo no
  // lugar. `existsSync` só responde à pergunta que interessa.
  it('não tem mais os módulos do provider legado', () => {
    for (const morto of ['amplifyApi', 'dataBackend.ts']) {
      expect(fs.existsSync(path.join(SRC, 'services', morto)), `${morto} voltou`).toBe(false)
    }
  })

  it('authApi não reaproveita nenhuma implementação simulada', async () => {
    const { authApi } = await import('./auth')
    const { authApi: mockAuthApi } = await import('./mockApi/auth')
    const simuladas = new Set<unknown>(Object.values(mockAuthApi))

    for (const [nome, impl] of Object.entries(authApi)) {
      expect(simuladas.has(impl), `authApi.${nome} ainda aponta para o mock`).toBe(false)
    }
  })

  it('nenhum módulo do caminho de produção importa valor de mockApi', () => {
    const infratores: string[] = []

    for (const file of sourceFiles(SRC)) {
      if (isOutsideProductionGraph(file)) continue
      const code = fs.readFileSync(file, 'utf8')

      for (const m of code.matchAll(MOCK_IMPORT)) {
        const [, , typeKeyword, clause, spec] = m
        // `import type {...}` e `export type {...}` somem na compilação.
        if (typeKeyword) continue
        // `import { type A, type B }` também: todo binding marcado como tipo.
        const bindings = (clause ?? '')
          .replace(/[{}]/g, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        if (bindings.length > 0 && bindings.every((b) => b.startsWith('type '))) continue

        infratores.push(`${path.relative(SRC, file).replace(/\\/g, '/')} → ${spec}`)
      }
    }

    expect(infratores, `imports de valor vindos de mockApi:\n${infratores.join('\n')}`).toEqual([])
  })
})
