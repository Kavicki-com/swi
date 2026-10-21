import { withTimeout } from './withTimeout';

// Os leitores do app Saúde e do Health Connect esperam respostas nativas que
// podem nunca chegar; o prazo é o que impede o envio de ficar preso nelas.

describe('withTimeout', () => {
  it('resolve com o valor da promessa que responde no prazo', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
  });

  it('repassa a rejeição da promessa como ela veio', async () => {
    await expect(withTimeout(Promise.reject(new Error('negado')), 50)).rejects.toThrow('negado');
  });

  it('rejeita quando a promessa não responde no prazo', async () => {
    await expect(withTimeout(new Promise(() => undefined), 10)).rejects.toThrow(
      'sem resposta em 10 ms',
    );
  });
});
