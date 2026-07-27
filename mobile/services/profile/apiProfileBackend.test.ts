import { apiProfileBackend, brToIso, isoToBr } from './apiProfileBackend';
import { apiRequest, hasToken } from '../api/http';
import { stashPendingProfile } from './pendingProfile';

jest.mock('../api/http', () => ({ apiRequest: jest.fn(), hasToken: jest.fn() }));
jest.mock('./pendingProfile', () => ({ stashPendingProfile: jest.fn() }));

const mockApiRequest = apiRequest as jest.Mock;
const mockHasToken = hasToken as jest.Mock;
const mockStash = stashPendingProfile as jest.Mock;

describe('apiProfileBackend', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockStash.mockReset();
    // Default: COM sessão (o caminho normal das telas autenticadas).
    mockHasToken.mockReset();
    mockHasToken.mockResolvedValue(true);
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

  it('get propaga o erro quando não é 404 (ex. 500 — não engole como perfil vazio)', async () => {
    const err = new Error('Internal Server Error');
    (err as any).status = 500;
    mockApiRequest.mockRejectedValue(err);
    await expect(apiProfileBackend.get()).rejects.toThrow('Internal Server Error');
  });

  it('save SEM sessão vai pro stash local (wizard pré-aprovação) e não bate na API', async () => {
    mockHasToken.mockResolvedValue(false);
    mockStash.mockResolvedValue({ city: 'SP', birthDate: '1990-12-25' });
    const profile = await apiProfileBackend.save({ city: 'SP', birthDate: '25/12/1990' });
    // O stash guarda o body JÁ no formato da API (ISO) — o flush faz PUT cru.
    expect(mockStash).toHaveBeenCalledWith({ city: 'SP', birthDate: '1990-12-25' });
    expect(mockApiRequest).not.toHaveBeenCalled();
    // A tela vê o que digitou, re-convertido pro formato dela.
    expect(profile).toEqual({ city: 'SP', birthDate: '25/12/1990' });
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

// A ficha do "Joao Tester" chegou ao painel SEM data de nascimento — e por
// isso sem idade — enquanto telefone, CPF e o endereco inteiro passaram (QA
// 2026-07-27, verificado no banco).
//
// A causa: `save` montava o corpo como `{ ...patch, birthDate: brToIso(...) }`,
// entao a chave `birthDate` existia SEMPRE, valendo `undefined` quando o patch
// nao a trazia. No stash o merge e `{ ...prev, ...patch }` — o `undefined` do
// passo 2 (endereco) sobrescrevia a data guardada no passo 1, e o
// JSON.stringify apagava a chave de vez.
//
// O comentario do pendingProfile promete que "o merge nunca apaga um campo
// stashado por um step anterior". Isso so vale se a chave estiver AUSENTE.
describe('save sem sessao — o stash do wizard nao pode perder campo', () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
    mockStash.mockReset();
    mockStash.mockResolvedValue({});
    mockHasToken.mockReset();
    mockHasToken.mockResolvedValue(false); // wizard roda antes da conta existir
  });

  it('patch SEM birthDate nao manda a chave (senao apaga a do passo anterior)', async () => {
    await apiProfileBackend.save({ cep: '27280-080', street: 'Alameda Quatro' });
    const enviado = mockStash.mock.calls[0][0];
    expect('birthDate' in enviado).toBe(false);
  });

  it('patch COM birthDate manda em ISO', async () => {
    await apiProfileBackend.save({ fullName: 'Joao Tester', birthDate: '02/01/1999' });
    expect(mockStash).toHaveBeenCalledWith(
      expect.objectContaining({ birthDate: '1999-01-02' }),
    );
  });
});
