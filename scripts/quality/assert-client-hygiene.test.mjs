import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./assert-client-hygiene.mjs', import.meta.url))

function withProject(files, callback) {
  const root = mkdtempSync(join(tmpdir(), 'client-hygiene-'))
  try {
    for (const [path, contents] of Object.entries(files)) {
      const destination = join(root, path)
      mkdirSync(dirname(destination), { recursive: true })
      writeFileSync(destination, contents, 'utf8')
    }
    callback(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function run(root, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2_000,
  })
}

const assistantName = ['Clau', 'de'].join('')

test('aprova codigo limpo e ignora documentacao, lockfiles, artefatos e midia', () => {
  withProject(
    {
      'src/index.ts': 'export const status = "ok"\n',
      'README.md': assistantName,
      'docs/audit.md': assistantName,
      'package-lock.json': JSON.stringify({ note: assistantName }),
      'assets/avatar.svg': `<!-- ${assistantName} -->`,
      'dist/generated.js': `// ${assistantName}`,
      'coverage/result.json': JSON.stringify({ tool: assistantName }),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Higiene aprovada:/)
    },
  )
})

test('detecta nome de assistente em qualquer texto executavel e informa caminho e linha', () => {
  withProject(
    {
      'src/app.ts': `const status = "ok"\nconst generator = "${assistantName}"\n`,
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /src\/app\.ts:2:/)
      assert.match(result.stderr, /ferramenta generativa/i)
    },
  )
})

test('detecta marcadores de processo e narrativas historicas somente em comentarios', () => {
  withProject(
    {
      'src/history.ts': [
        '// QA Web 12',
        '// Figma 123:456 em x=20 y=40',
        '// Validado em 2026-08-14',
        '// Bug antigo resolvido',
        '// workaround temporario',
        '// comportamento da versao anterior',
        '// Task 8',
        '// Fase 3',
        '// auditoria interna 4',
        '// TODO: remover depois',
        '// FIXME ajuste pendente',
        '// HACK necessario',
        '// XXX revisar',
        'export const ready = true',
      ].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 1)
      for (let line = 1; line <= 13; line += 1) {
        assert.match(result.stderr, new RegExp(`src/history\\.ts:${line}:`))
      }
    },
  )
})

test('nao acusa datas em strings, fixtures, migrations ou politica JSON nem todo minusculo', () => {
  withProject(
    {
      'src/app.ts': [
        'const release = "2026-08-14"',
        '// todo o conteudo e validado',
        'export { release }',
      ].join('\n'),
      'fixtures/events.ts': '// Registro criado em 2026-08-14\nexport const event = true\n',
      'prisma/migrations/20260814_init/migration.sql': '-- Criada em 2026-08-14\nSELECT 1;\n',
      'scripts/security/audit-policy.json': JSON.stringify({ expires: '2026-08-14' }),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 0, result.stderr)
    },
  )
})

test('--dir limita a varredura ao caminho informado', () => {
  withProject(
    {
      'mobile/index.ts': 'export const mobile = true\n',
      'admin/index.ts': `// QA\nexport const admin = true\n`,
    },
    (root) => {
      const result = run(root, '--dir', 'mobile')
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /1 arquivo\(s\)/)
    },
  )
})

test('rejeita --dir inexistente com mensagem objetiva', () => {
  withProject({ 'src/index.ts': 'export const ok = true\n' }, (root) => {
    const result = run(root, '--dir', 'missing')
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Diretorio inexistente: missing/)
  })
})

test('caminhos do diagnostico permanecem relativos ao diretorio de execucao', () => {
  withProject({ 'nested/app.ts': '// QA\n' }, (root) => {
    const result = run(root, '--dir', join(root, 'nested'))
    assert.equal(result.status, 1)
    const expectedPath = relative(root, join(root, 'nested', 'app.ts')).replaceAll('\\', '/')
    assert.match(result.stderr, new RegExp(`${expectedPath}:1:`))
  })
})

test('informa a linha exata de uma ocorrencia dentro de comentario multilinha', () => {
  withProject({ 'src/block.ts': '/*\n * contexto atual\n * TODO: remover\n */\n' }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /src\/block\.ts:3:/)
  })
})

test('detecta marcador em comentario SQL de bloco', () => {
  withProject({ 'database/query.sql': 'SELECT 1;\n/* TODO: revisar */\n' }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /database\/query\.sql:2: marcador pendente/)
  })
})

test('preserva a linha apos quebra escapada dentro de string JavaScript', () => {
  withProject({ 'src/continued.js': 'const value = "first\\\nsecond"\n// TODO: revisar\n' }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /src\/continued\.js:3: marcador pendente/)
  })
})

test('detecta REM de batch depois de separador de comando', () => {
  withProject({ 'scripts/start.cmd': 'echo ok & rem TODO: revisar\n' }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /scripts\/start\.cmd:1: marcador pendente/)
  })
})

test('detecta comentario de dois-pontos de batch depois de separador de comando', () => {
  withProject({ 'scripts/stop.bat': 'echo ok & :: FIXME revisar\n' }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /scripts\/stop\.bat:1: marcador pendente/)
  })
})

test('migration aplicada fica fora de todas as regras, nao so da data', () => {
  withProject(
    {
      'prisma/migrations/20260731110000_message_edit/migration.sql': [
        '-- QA Web #4: coluna criada em 2026-07-31 para corrigir um bug de exclusao',
        'ALTER TABLE "Message" ADD COLUMN "deletedAt" TIMESTAMP;',
      ].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 0, result.stderr)
    },
  )
})

test('palavra acentuada nao vira marcador pendente', () => {
  withProject(
    {
      'src/roles.spec.ts': ['// metadata no METODO ainda resolve'.replace('METODO', 'MÉTODO'), 'export const ok = true'].join(
        '\n',
      ),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 0, result.stderr)
    },
  )
})

test('determinante portugues em maiuscula nao vira marcador pendente', () => {
  withProject(
    {
      'src/seed.ts': [
        '// TODO usuario semeado pertence a empresa demo',
        '// re-ancora TODO o conjunto de demonstracao em volta do usuario',
        'export const seeded = true',
      ].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 0, result.stderr)
    },
  )
})

test('marcador pendente declarado acusa com dois-pontos e com parenteses', () => {
  withProject(
    {
      'src/pending.ts': ['// TODO: revisar isso', '// TODO(followup): sem superficie de erro'].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /src\/pending\.ts:1: marcador pendente/)
      assert.match(result.stderr, /src\/pending\.ts:2: marcador pendente/)
    },
  )
})

test('modulo dentro de pasta chamada media e varrido', () => {
  withProject({ 'src/media/upload.ts': '// FIXME ajustar limite\nexport const limit = 1\n' }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /src\/media\/upload\.ts:1: marcador pendente/)
  })
})

test('aspas dentro de expressao regular nao escondem o comentario seguinte', () => {
  withProject(
    {
      'src/svg.ts': ['const ids = /id="([^"]+)"/g', 'export { ids }', '// FIXME ajustar depois'].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /src\/svg\.ts:3: marcador pendente/)
    },
  )
})

test('crase de escape do PowerShell nao esconde o comentario seguinte', () => {
  withProject(
    {
      'scripts/start.ps1': ['docker compose -f `"$Compose`" logs', '# FIXME revisar o caminho'].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /scripts\/start\.ps1:2: marcador pendente/)
    },
  )
})

test('apostrofo em script shell nao esconde o comentario seguinte', () => {
  withProject(
    {
      'scripts/deploy.sh': ["# nao e' possivel seguir sem a variavel", '# FIXME validar antes'].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /scripts\/deploy\.sh:2: marcador pendente/)
    },
  )
})

test('apostrofo em texto JSX nao esconde o comentario seguinte', () => {
  withProject(
    {
      'src/View.tsx': [
        "export const View = () => <Text>copo d'agua</Text>",
        '// FIXME trocar o rotulo',
      ].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /src\/View\.tsx:2: marcador pendente/)
    },
  )
})

test('URL sem aspas no CSS nao vira comentario fantasma', () => {
  withProject(
    {
      'src/theme.scss': '.hero { background: url(https://cdn.example.com/QA-2026-08-14.png); }\n',
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 0, result.stderr)
    },
  )
})

test('literal de template aberto ate o fim interrompe a varredura com erro claro', () => {
  withProject({ 'src/broken.ts': 'const a = `sem fim\nexport const b = 1\n' }, (root) => {
    const result = run(root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /src\/broken\.ts/)
    assert.match(result.stderr, /inconsistente/iu)
  })
})

test('data de exemplo entre aspas e sequencia invalida nao viram data historica', () => {
  withProject(
    {
      'src/contract.ts': [
        "// validUntil chega em ISO-8601, exemplo: '2026-01-31'",
        '// ids legados vinham no formato 1234-56-78 e nao sao datas',
        '// as boundaries estao em docs/plans/2026-05-15-breakpoints.md',
        'export const contract = true',
      ].join('\n'),
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 0, result.stderr)
    },
  )
})

test('mencao a ferramenta de design passa, referencia de node reprova', () => {
  withProject(
    {
      'src/ground-truth.ts': '// 360x800 e o frame mobile do Figma, ground truth do projeto\nexport const width = 360\n',
      'src/history.ts': '// ordem do historico conforme o Figma (342:9907)\nexport const order = 1\n',
    },
    (root) => {
      const result = run(root)
      assert.equal(result.status, 1)
      assert.doesNotMatch(result.stderr, /ground-truth\.ts/)
      assert.match(result.stderr, /src\/history\.ts:1: referencia de node do design/)
    },
  )
})

test('termina a varredura de batch realista com linhas vazias', () => {
  const batch = [
    '@echo off',
    'REM Inicia a aplicacao local.',
    '',
    'title Aplicacao',
    'powershell -NoProfile -File "%~dp0scripts\\start.ps1"',
    '',
    'exit /b',
    '',
  ].join('\n')
  withProject({ 'START.cmd': batch }, (root) => {
    const result = run(root)
    assert.equal(result.status, 0, result.error?.message ?? result.stderr)
  })
})
