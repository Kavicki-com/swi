import { telemetryCopy } from './telemetryCopy';
import type { TelemetryAvailability } from './telemetryAvailability';

// Fonte unica da copy: as duas superficies precisam dizer a mesma coisa sobre o
// mesmo estado. Titulo diferente para o mesmo estado faria o funcionario achar
// que sao dois problemas.

const TODOS: TelemetryAvailability[] = [
  { kind: 'unsupported' },
  { kind: 'unavailable' },
  { kind: 'awaiting' },
  { kind: 'stale', bpm: 70, measuredAt: '2026-09-02T13:00:00.000Z' },
  { kind: 'current', bpm: 70, measuredAt: '2026-09-02T13:00:00.000Z' },
];

describe('telemetryCopy', () => {
  it('o titulo de um estado nao muda entre o primeiro uso e Configuracoes', () => {
    for (const estado of TODOS) {
      expect(telemetryCopy(estado, 'primeiro-uso').titulo).toBe(
        telemetryCopy(estado, 'configuracoes').titulo,
      );
    }
  });

  it('cada estado tem titulo proprio: nenhum se confunde com outro', () => {
    const titulos = TODOS.map((e) => telemetryCopy(e, 'configuracoes').titulo);
    expect(new Set(titulos).size).toBe(TODOS.length);
  });

  // CONTEXT.md: "indisponivel" nomeia o estado COM suporte e sem leitura. Usar
  // a mesma palavra para sem suporte daria o conselho errado.
  it('sem suporte nao usa a palavra reservada ao estado indisponivel', () => {
    expect(telemetryCopy({ kind: 'unsupported' }, 'configuracoes').titulo).not.toMatch(
      /indisponível/i,
    );
    expect(telemetryCopy({ kind: 'unsupported' }, 'configuracoes').corpo).toMatch(
      /iPhone e Apple Watch/,
    );
  });

  it('aguardando manda ajustar o pulso; indisponivel manda ao sistema', () => {
    expect(telemetryCopy({ kind: 'awaiting' }, 'configuracoes').corpo).toMatch(/pulso/);
    expect(telemetryCopy({ kind: 'awaiting' }, 'configuracoes').corpo).not.toMatch(/Ajustes/);
    expect(telemetryCopy({ kind: 'unavailable' }, 'configuracoes').corpo).toMatch(/Ajustes/);
  });

  it('a acao muda com o contexto: uma aponta Configuracoes, a outra o botao', () => {
    expect(telemetryCopy({ kind: 'unavailable' }, 'primeiro-uso').corpo).toMatch(/Configurações/);
    expect(telemetryCopy({ kind: 'unavailable' }, 'configuracoes').corpo).toMatch(
      /Ativar monitoramento/,
    );
  });

  // ADR-0004 e CONTEXT.md.
  it('nenhum estado acusa negacao nem cita smartband', () => {
    for (const estado of TODOS) {
      for (const contexto of ['primeiro-uso', 'configuracoes'] as const) {
        const { titulo, corpo } = telemetryCopy(estado, contexto);
        const t = `${titulo} ${corpo}`.toLowerCase();
        expect(t).not.toContain('negad');
        expect(t).not.toContain('negou');
        expect(t).not.toContain('smartband');
      }
    }
  });
});
