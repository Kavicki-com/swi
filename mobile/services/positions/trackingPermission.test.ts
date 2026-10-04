import { PermissionsAndroid } from 'react-native';
import * as Location from 'expo-location';
import { requestAlwaysPermission, requestTrackingPermission } from './trackingPermission';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
}));

const foreground = Location.requestForegroundPermissionsAsync as jest.Mock;
const background = Location.requestBackgroundPermissionsAsync as jest.Mock;
let notifications: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  foreground.mockResolvedValue({ status: 'granted' });
  background.mockResolvedValue({ status: 'granted' });
  notifications = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue('granted');
});
afterEach(() => notifications.mockRestore());

describe('requestTrackingPermission', () => {
  it('iPhone: pede só a permissão de uso, e o "Sempre" fica para depois', async () => {
    await expect(requestTrackingPermission('ios')).resolves.toBe('granted');
    expect(background).not.toHaveBeenCalled();
    expect(notifications).not.toHaveBeenCalled();
  });

  it('uso negado: negado', async () => {
    foreground.mockResolvedValue({ status: 'denied' });
    await expect(requestTrackingPermission('ios')).resolves.toBe('denied');
    await expect(requestTrackingPermission('android', 34)).resolves.toBe('denied');
    expect(notifications).not.toHaveBeenCalled();
  });

  // Sem ela o serviço roda, mas a notificação fixa não aparece na barra.
  it('Android 13 ou mais novo: pede também a permissão de notificação', async () => {
    await expect(requestTrackingPermission('android', 33)).resolves.toBe('granted');
    expect(notifications).toHaveBeenCalledWith('android.permission.POST_NOTIFICATIONS');
    expect(background).not.toHaveBeenCalled();
  });

  it('Android antes do 13: a notificação não depende de permissão', async () => {
    await expect(requestTrackingPermission('android', 32)).resolves.toBe('granted');
    expect(notifications).not.toHaveBeenCalled();
  });

  it('notificação negada ou com falha não impede o rastreio', async () => {
    notifications.mockResolvedValueOnce('denied');
    await expect(requestTrackingPermission('android', 34)).resolves.toBe('granted');
    notifications.mockRejectedValueOnce(new Error('sem activity'));
    await expect(requestTrackingPermission('android', 34)).resolves.toBe('granted');
  });

  it('web: sem rastreio em segundo plano, nada a pedir', async () => {
    await expect(requestTrackingPermission('web')).resolves.toBe('unsupported');
    expect(foreground).not.toHaveBeenCalled();
  });

  it('falha do sistema ao pedir conta como negado', async () => {
    foreground.mockRejectedValue(new Error('missing usage description'));
    await expect(requestTrackingPermission('ios')).resolves.toBe('denied');
  });
});

describe('requestAlwaysPermission', () => {
  it('iPhone: pede o "Sempre"', async () => {
    await requestAlwaysPermission('ios');
    expect(background).toHaveBeenCalledTimes(1);
  });

  it('Android e web: o serviço em primeiro plano dispensa, nada é pedido', async () => {
    await requestAlwaysPermission('android');
    await requestAlwaysPermission('web');
    expect(background).not.toHaveBeenCalled();
  });

  it('falha ao pedir não rejeita', async () => {
    background.mockRejectedValue(new Error('x'));
    await expect(requestAlwaysPermission('ios')).resolves.toBeUndefined();
  });
});
