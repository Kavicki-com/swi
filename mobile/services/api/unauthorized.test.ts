import { notifyUnauthorized, onUnauthorized } from './unauthorized';

describe('aviso de 401', () => {
  it('chama quem está ouvindo', () => {
    const ouvinte = jest.fn();
    const parar = onUnauthorized(ouvinte);

    notifyUnauthorized();

    expect(ouvinte).toHaveBeenCalledTimes(1);
    parar();
  });

  it('para de chamar depois de cancelar', () => {
    const ouvinte = jest.fn();
    const parar = onUnauthorized(ouvinte);

    parar();
    notifyUnauthorized();

    expect(ouvinte).not.toHaveBeenCalled();
  });

  it('um ouvinte que cancela durante o aviso não impede os outros', () => {
    const segundo = jest.fn();
    const parar = onUnauthorized(() => parar());
    const pararSegundo = onUnauthorized(segundo);

    notifyUnauthorized();

    expect(segundo).toHaveBeenCalledTimes(1);
    pararSegundo();
  });
});
