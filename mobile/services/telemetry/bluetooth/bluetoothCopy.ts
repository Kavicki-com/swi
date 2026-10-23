import type { BleHeartRateState, BleScanResult } from '../../../modules/swi-ble-heart-rate/src';
import type { BluetoothStartProblem } from './useBluetoothHeartRate';

// Os textos da pulseira no Bluetooth em Configurações > Monitoramento. O
// termo para a pessoa é sempre "pulseira", seja cinta peitoral, pulseira ou
// relógio transmitindo pelo perfil padrão de batimento. Quem liga e desliga
// o monitoramento é a pessoa (escolher e Encerrar); nenhum texto diz que a
// jornada liga ou desliga alguma coisa.

export const BLUETOOTH_MONITORING_COPY = {
  titulo: 'Pulseira por Bluetooth',
  corpo:
    'Escolher a pulseira liga o monitoramento na hora: o batimento chega ao painel sem esperar o Health Connect. Ele segue ligado, também fora do expediente, até você tocar em Encerrar.',
  nenhuma: 'Nenhuma pulseira escolhida',
  procurar: 'Procurar pulseira',
  trocar: 'Trocar pulseira',
  pararDeProcurar: 'Parar de procurar',
  encerrar: 'Encerrar',
  falhaEncerrar: 'Não foi possível encerrar. Tente de novo.',
  procurando: 'Procurando pulseiras por perto',
  listaTitulo: 'Pulseiras encontradas',
  nadaEncontrado: 'Nenhuma pulseira encontrada. Confira se ela está ligada e perto do celular.',
  falhaGuardar: 'Não foi possível guardar a pulseira. Tente de novo.',
  abrirAjustes: 'Abrir ajustes',
  bluetoothDesligado: 'Bluetooth do celular desligado',
} as const;

/** Faixas do RSSI em dBm; mais perto de zero é mais perto. */
export function signalCopy(rssi: number): string {
  if (rssi >= -65) return 'sinal forte';
  if (rssi >= -80) return 'sinal médio';
  return 'sinal fraco';
}

/** O nome anunciado, ou o fim do endereço para distinguir as sem nome. */
export function bandNameCopy(name: string | null, deviceId: string): string {
  return name ?? `Pulseira sem nome (${deviceId.slice(-5)})`;
}

export function scanOptionCopy(result: BleScanResult): string {
  return `${bandNameCopy(result.name, result.deviceId)} · ${signalCopy(result.rssi)}`;
}

export type LinkTagStatus = 'accept' | 'pending' | 'info' | 'canceled';

/** A etiqueta da pulseira escolhida, pelo estado do serviço. */
export function linkTagCopy(
  state: BleHeartRateState,
  bandName: string,
): { status: LinkTagStatus; label: string } {
  switch (state) {
    case 'connected':
      return { status: 'accept', label: `${bandName} conectada` };
    case 'searching':
      return { status: 'pending', label: `Procurando ${bandName}` };
    case 'bluetoothOff':
      return { status: 'canceled', label: BLUETOOTH_MONITORING_COPY.bluetoothDesligado };
    default:
      return { status: 'info', label: `${bandName} escolhida` };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

export function lastReadingCopy(receivedAtMs: number): string {
  const d = new Date(receivedAtMs);
  return `Último batimento recebido às ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export type ScanProblem = 'denied' | 'blocked' | 'bluetoothOff' | 'unavailable' | 'failed';

export function scanProblemCopy(problem: ScanProblem): string {
  switch (problem) {
    case 'denied':
      return 'Sem a permissão de Bluetooth não é possível procurar a pulseira.';
    case 'blocked':
      return 'Sem a permissão de Bluetooth não é possível procurar a pulseira. Libere o Bluetooth nos ajustes do app.';
    case 'bluetoothOff':
      return 'Ligue o Bluetooth do celular e procure de novo.';
    case 'unavailable':
      return 'Este celular não tem Bluetooth de baixa energia.';
    default:
      return 'Não foi possível procurar a pulseira. Tente de novo.';
  }
}

export function startProblemCopy(problem: BluetoothStartProblem): string {
  switch (problem) {
    case 'E_PERMISSION_DENIED':
      return 'A pulseira não liga sem a permissão de Bluetooth. Libere nos ajustes do app.';
    case 'E_BLUETOOTH_UNAVAILABLE':
      return 'Este celular não tem Bluetooth de baixa energia.';
    default:
      return 'Não foi possível ligar a pulseira. Ela tenta de novo quando o app abrir.';
  }
}
