import { apiProfileBackend, brToIso, isoToBr } from './apiProfileBackend';
import { apiRequest } from '../api/http';

jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));

const mockApiRequest = apiRequest as jest.Mock;

// Todo save roda AUTENTICADO: o wizard de complimentary-data é pós-login, e
// não existe stash local pré-conta. É isso que impede um token esquecido de
// outro usuário de receber o PUT.
describe('apiProfileBackend', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it('get chama /profile/me com auth e converte birthDate ISO→BR', async () => {
    mockApiRequest.mockResolvedValue({ fullName: 'Ana', birthDate: '1990-12-25T00:00:00.000Z', city: 'SP' });
    const profile = await apiProfileBackend.get();
    expect(mockApiRequest).toHaveBeenCalledWith('/profile/me', { auth: true });
    expect(profile).toEqual({ fullName: 'Ana', birthDate: '25/12/1990', city: 'SP' });
  });

  it('get devolve null quando o backend dá 404 (erro com .status 404)', async () => {
    const err = new Error('Not Found');
    (err as any).status = 404;
    mockApiRequest.mockRejectedValue(err);
    expect(await apiProfileBackend.get()).toBeNull();
  });

  it('get propaga o erro quando não é 404 (ex. 500, não engole como perfil vazio)', async () => {
    const err = new Error('Internal Server Error');
    (err as any).status = 500;
    mockApiRequest.mockRejectedValue(err);
    await expect(apiProfileBackend.get()).rejects.toThrow('Internal Server Error');
  });

  it('save envia PUT com birthDate BR→ISO e devolve o profile em BR', async () => {
    mockApiRequest.mockResolvedValue({ city: 'SP', birthDate: '1990-12-25T00:00:00.000Z' });
    const profile = await apiProfileBackend.save({ city: 'SP', birthDate: '25/12/1990' });
    expect(mockApiRequest).toHaveBeenCalledWith('/profile/me', {
      method: 'PUT',
      body: { city: 'SP', birthDate: '1990-12-25' },
      auth: true,
    });
    expect(profile).toEqual({ city: 'SP', birthDate: '25/12/1990' });
  });

  // Montar o corpo como `{ ...patch, birthDate: brToIso(...) }` faz a chave
  // existir SEMPRE, valendo `undefined` quando o patch não a traz, e isso apaga
  // a data salva pelo passo anterior. A ficha chega ao painel sem data de
  // nascimento e sem idade. A chave só pode entrar quando o patch a traz.
  it('patch SEM birthDate não manda a chave (senão apaga a do passo anterior)', async () => {
    mockApiRequest.mockResolvedValue({});
    await apiProfileBackend.save({ cep: '27280-080', street: 'Alameda Quatro' });
    const body = mockApiRequest.mock.calls[0][1].body;
    expect('birthDate' in body).toBe(false);
  });

  describe('helpers de data', () => {
    it('brToIso converte DD/MM/YYYY → YYYY-MM-DD', () => {
      expect(brToIso('25/12/1990')).toBe('1990-12-25');
    });
    it('isoToBr converte ISO datetime → DD/MM/YYYY (fatia os 10 chars)', () => {
      expect(isoToBr('1990-12-25T00:00:00.000Z')).toBe('25/12/1990');
    });
    it('ambos toleram undefined', () => {
      expect(brToIso(undefined)).toBeUndefined();
      expect(isoToBr(undefined)).toBeUndefined();
    });
  });
});
