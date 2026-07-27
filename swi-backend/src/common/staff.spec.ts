import { isStaffJobTitle } from './staff'

// Quem pode ser atribuído como RESPONSÁVEL por um relatório ("eles revisarão e
// farão comentários"). O app oferecia o diretório de chat inteiro, então o
// worker via os 10 colegas de operação como revisores — nenhum deles revisa
// nada (QA no aparelho, 2026-07-27).
//
// O campo certo pra isso seria User.companyRole (owner/partner/manager/safety),
// que o schema já prevê — mas está NULO nos 16 usuários. Enquanto não for
// populado, a classificação sai do jobTitle, que é texto livre do cadastro.
//
// ALLOWLIST, não blocklist: lista-se o que é comprovadamente staff. Listar o
// que excluir quebra no primeiro cargo novo — foi exatamente assim que o
// sanitizador de id de SVG quebrou no React 19 (DS v0.1.125).
describe('isStaffJobTitle', () => {
  it.each(['Supervisor', 'Administrador', 'Analista de Segurança'])(
    'aceita %s — cargo de staff presente no quadro real',
    (cargo) => {
      expect(isStaffJobTitle(cargo)).toBe(true)
    },
  )

  it.each(['Gerente de Operações', 'Coordenador de Turno', 'Encarregado', 'Engenheiro de Minas'])(
    'aceita %s — staff que ainda não existe no banco mas o cliente vai cadastrar',
    (cargo) => {
      expect(isStaffJobTitle(cargo)).toBe(true)
    },
  )

  it.each(['Operador', 'Operadora', 'Operador de escavadeira', 'Técnico de Manutenção'])(
    'recusa %s — quem executa não revisa o próprio relatório',
    (cargo) => {
      expect(isStaffJobTitle(cargo)).toBe(false)
    },
  )

  // Cadastro incompleto é a regra, não a exceção: 2 dos 12 aprovados estão sem
  // cargo. Sem cargo declarado não dá pra afirmar que a pessoa é staff.
  it.each([null, undefined, '', '   '])('recusa cargo ausente (%p)', (cargo) => {
    expect(isStaffJobTitle(cargo)).toBe(false)
  })

  // O cadastro é digitado à mão: acento e caixa não podem decidir quem revisa.
  it('ignora acento e caixa', () => {
    expect(isStaffJobTitle('SUPERVISORA DE SEGURANÇA')).toBe(true)
    expect(isStaffJobTitle('coordenacao de frota')).toBe(true)
    expect(isStaffJobTitle('Analista')).toBe(true)
  })

  // "Operador" contém "or", "Supervisor" contém "visor" — a checagem tem que
  // casar o TERMO, não um pedaço solto que apareça em qualquer palavra.
  it('não confunde cargo operacional que contém trecho de termo de staff', () => {
    expect(isStaffJobTitle('Operador de Ponte Rolante')).toBe(false)
    expect(isStaffJobTitle('Auxiliar de Produção')).toBe(false)
  })
})
