import { Linking, PermissionsAndroid } from 'react-native';
import { createBluetoothPermissions } from './bluetoothPermissions';

const SCAN = 'android.permission.BLUETOOTH_SCAN';
const CONNECT = 'android.permission.BLUETOOTH_CONNECT';
const LOCATION = 'android.permission.ACCESS_FINE_LOCATION';
const { GRANTED, DENIED, NEVER_ASK_AGAIN } = PermissionsAndroid.RESULTS;

afterEach(() => jest.restoreAllMocks());

const pedido = (respostas: Record<string, string>) =>
  jest
    .spyOn(PermissionsAndroid, 'requestMultiple')
    .mockResolvedValue(respostas as Awaited<ReturnType<typeof PermissionsAndroid.requestMultiple>>);

describe('createBluetoothPermissions', () => {
  it('no Android 12 ou mais pede a varredura e a conexão', async () => {
    const spy = pedido({ [SCAN]: GRANTED, [CONNECT]: GRANTED });
    expect(await createBluetoothPermissions(31).request()).toBe('granted');
    expect(spy).toHaveBeenCalledWith([SCAN, CONNECT]);
  });

  it('do Android 8 ao 11 pede a localização precisa', async () => {
    const spy = pedido({ [LOCATION]: GRANTED });
    expect(await createBluetoothPermissions(30).request()).toBe('granted');
    expect(spy).toHaveBeenCalledWith([LOCATION]);
  });

  it('uma negada basta para negar', async () => {
    pedido({ [SCAN]: GRANTED, [CONNECT]: DENIED });
    expect(await createBluetoothPermissions(34).request()).toBe('denied');
  });

  it('"não perguntar de novo" em qualquer uma leva aos ajustes', async () => {
    pedido({ [SCAN]: NEVER_ASK_AGAIN, [CONNECT]: DENIED });
    expect(await createBluetoothPermissions(34).request()).toBe('blocked');
  });

  it('resposta ausente ou pedido que rejeita conta como negada', async () => {
    pedido({ [SCAN]: GRANTED });
    expect(await createBluetoothPermissions(34).request()).toBe('denied');
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockRejectedValue(new Error('sem atividade'));
    expect(await createBluetoothPermissions(34).request()).toBe('denied');
  });

  it('abre os ajustes do app', () => {
    const spy = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    createBluetoothPermissions(34).openSettings();
    expect(spy).toHaveBeenCalled();
  });
});
