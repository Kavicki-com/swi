import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import {
  endedEvacuation,
  reportActiveEvacuation,
  reportEvacuationEnded,
  resetEvacuationEnd,
  useEvacuationEnded,
} from './evacuationEnd';

// O fim da evacuação visto por qualquer caminho (consulta do rastreio, socket,
// tarefa de localização, rota que volta 404). "Encerrada" só depois de uma
// ativa vista nesta sessão: o backend de demonstração nunca tem evacuação
// disparada, e a tela não pode sair sozinha por isso.

afterEach(() => resetEvacuationEnd());

describe('evacuationEnd', () => {
  it('ativa vista e depois nenhuma: encerrada', () => {
    reportActiveEvacuation('e1');
    expect(endedEvacuation()).toBeNull();
    reportActiveEvacuation(null);
    expect(endedEvacuation()).toBe('e1');
  });

  it('nenhuma sem ativa vista antes não encerra nada', () => {
    reportActiveEvacuation(null);
    expect(endedEvacuation()).toBeNull();
  });

  it('uma evacuação nova depois do fim limpa o encerramento', () => {
    reportActiveEvacuation('e1');
    reportActiveEvacuation(null);
    reportActiveEvacuation('e2');
    expect(endedEvacuation()).toBeNull();
  });

  it('o aviso do socket encerra só a evacuação conhecida', () => {
    reportActiveEvacuation('e2');
    reportEvacuationEnded('e1');
    expect(endedEvacuation()).toBeNull();
    reportEvacuationEnded('e2');
    expect(endedEvacuation()).toBe('e2');
  });

  it('o hook acompanha o fim e a evacuação nova', async () => {
    let visto: boolean | null = null;
    function Harness() {
      visto = useEvacuationEnded();
      return null;
    }
    await act(async () => {
      create(createElement(Harness));
    });
    expect(visto).toBe(false);
    await act(async () => {
      reportActiveEvacuation('e1');
      reportActiveEvacuation(null);
    });
    expect(visto).toBe(true);
    await act(async () => {
      reportActiveEvacuation('e2');
    });
    expect(visto).toBe(false);
  });
});
