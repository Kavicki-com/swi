import { listReportAssignees } from './assignees';
import { apiRequest } from '../api/http';
import { getChatBackend } from '../chat/getChatBackend';

jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));
jest.mock('../chat/getChatBackend', () => ({ getChatBackend: jest.fn() }));
jest.mock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'api' }));

const mockApiRequest = apiRequest as jest.Mock;
const mockGetChatBackend = getChatBackend as jest.Mock;

const CONTATO = {
  workerId: 'w1',
  name: 'Antonio Carlos',
  sector: 'Segurança',
  role: 'Supervisor',
  avatarUri: '',
  bloodType: 'AB+',
  birthDate: '1971-09-08T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApiRequest.mockResolvedValue([CONTATO]);
  mockGetChatBackend.mockReturnValue({ listDirectory: jest.fn(async () => [CONTATO]) });
});

describe('listReportAssignees', () => {
  // O modal pedia /chat/directory, que devolve a empresa INTEIRA de propósito
  // (sem os admins ali o worker não consegue abrir conversa com o painel).
  // Resultado no aparelho: o seletor de responsáveis oferecia os 10 operadores
  // como revisores (QA 2026-07-27). A régua de quem revisa vive no backend.
  it('no modo api busca a lista de responsáveis, não o diretório de chat', async () => {
    const out = await listReportAssignees();
    expect(mockApiRequest).toHaveBeenCalledWith('/reports/assignees', { auth: true });
    expect(mockGetChatBackend).not.toHaveBeenCalled();
    expect(out).toEqual([CONTATO]);
  });
});

describe('listReportAssignees — modo mock', () => {
  // O backend mock não tem quadro de staff; sem o fallback o dev local (onde
  // DATA_BACKEND é 'mock' por padrão) abriria o modal vazio.
  it('cai no diretório de chat quando não há backend real', async () => {
    jest.resetModules();
    const listDirectory = jest.fn(async () => [CONTATO]);
    jest.doMock('../../lib/featureFlags', () => ({ DATA_BACKEND: 'mock' }));
    jest.doMock('../chat/getChatBackend', () => ({
      getChatBackend: () => ({ listDirectory }),
    }));
    const apiRequestMock = jest.fn();
    jest.doMock('../api/http', () => ({ apiRequest: apiRequestMock }));
    // require, não import(): o preset roda em CJS e o import dinâmico exige
    // --experimental-vm-modules. É a forma de reimportar depois do resetModules.

    const { listReportAssignees: comMock } = require('./assignees') as typeof import('./assignees');

    const out = await comMock();

    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(apiRequestMock).not.toHaveBeenCalled();
    expect(out).toEqual([CONTATO]);
  });
});
