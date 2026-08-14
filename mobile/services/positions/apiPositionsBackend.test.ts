import { apiRequest } from '../api/http';
import { apiPositionsBackend } from './apiPositionsBackend';
jest.mock('../api/http', () => ({ apiRequest: jest.fn() }));

afterEach(() => jest.clearAllMocks());

describe('apiPositionsBackend', () => {
  it('heartbeat → POST /positions/heartbeat autenticado com {lat, lng} NA ORDEM CERTA', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({});
    await apiPositionsBackend.heartbeat(-23.55, -46.63);
    // A ordem dos args é o que este teste protege: lat é o ~-23.5, lng o ~-46.6.
    expect(apiRequest).toHaveBeenCalledWith('/positions/heartbeat', {
      method: 'POST',
      auth: true,
      body: { lat: -23.55, lng: -46.63 },
    });
  });
});
