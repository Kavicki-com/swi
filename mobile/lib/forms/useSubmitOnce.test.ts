import { act, create } from 'react-test-renderer';
import { createElement } from 'react';
import { useSubmitOnce } from './useSubmitOnce';

// O relato do QA (2026-07-27): no fim do cadastro apareceu "E-mail já
// cadastrado" E, ao mesmo tempo, a tela do código abriu, com o código
// chegando por e-mail e funcionando.
//
// Não eram dois bugs: era UM toque a mais. `disabled={!canSubmit}` é a única
// trava das telas de auth, e `canSubmit` continua verdadeiro enquanto a
// requisição está no ar. O 1º toque criou a conta (201) e navegou; o 2º, ainda
// em voo, recebeu 409 e disparou o alerta por cima. Pela rede do QA (túnel
// ngrok) a janela entre os dois é larga.
//
// A trava vive aqui, e não em cada tela, porque a lacuna é sistêmica: nenhuma
// das telas de (auth) tinha guarda de reentrância.

// Monta o hook num componente de verdade, o comportamento depende de estado
// do React, então testar a função isolada não provaria nada.
function montar(fn: () => Promise<void>) {
  const capturado: { run?: () => Promise<void>; busy?: boolean } = {};
  function Sonda() {
    const { run, busy } = useSubmitOnce(fn);
    capturado.run = run;
    capturado.busy = busy;
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(createElement(Sonda)); });
  return { capturado, tree };
}

describe('useSubmitOnce', () => {
  it('o segundo toque durante a requisição é ignorado', async () => {
    let liberar!: () => void;
    const emVoo = new Promise<void>((r) => { liberar = r; });
    const fn = jest.fn(() => emVoo);
    const { capturado } = montar(fn);

    // Dois toques antes de a primeira chamada terminar, exatamente o caso do
    // cadastro, onde o 2º recebia 409 de e-mail já existente.
    await act(async () => {
      void capturado.run!();
      void capturado.run!();
    });
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => { liberar(); await emVoo; });
  });

  it('libera para um novo envio depois que termina', async () => {
    const fn = jest.fn(async () => {});
    const { capturado } = montar(fn);

    await act(async () => { await capturado.run!(); });
    await act(async () => { await capturado.run!(); });

    expect(fn).toHaveBeenCalledTimes(2);
  });

  // Se a falha travasse o botão, o cadastro morreria de vez no primeiro erro
  // de rede, a pessoa ficaria sem como tentar de novo.
  it('libera também quando a chamada falha', async () => {
    const fn = jest.fn(async () => { throw new Error('rede caiu'); });
    const { capturado } = montar(fn);

    await act(async () => { await capturado.run!().catch(() => {}); });
    expect(capturado.busy).toBe(false);

    await act(async () => { await capturado.run!().catch(() => {}); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // O erro tem que continuar chegando em quem chamou: as telas dependem dele
  // pra mostrar o motivo real do servidor e pra NÃO navegar.
  it('não engole o erro', async () => {
    const fn = jest.fn(async () => { throw new Error('E-mail já cadastrado'); });
    const { capturado } = montar(fn);

    let capturadoErro: unknown;
    await act(async () => {
      try { await capturado.run!(); } catch (e) { capturadoErro = e; }
    });
    expect((capturadoErro as Error)?.message).toBe('E-mail já cadastrado');
  });

  it('expõe busy pra tela desabilitar o botão e mostrar progresso', async () => {
    let liberar!: () => void;
    const emVoo = new Promise<void>((r) => { liberar = r; });
    const { capturado } = montar(() => emVoo);

    expect(capturado.busy).toBe(false);
    await act(async () => { void capturado.run!(); });
    expect(capturado.busy).toBe(true);

    await act(async () => { liberar(); await emVoo; });
    expect(capturado.busy).toBe(false);
  });
});
