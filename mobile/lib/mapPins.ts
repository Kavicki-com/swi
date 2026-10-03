import type { LocationPinStatus } from '@kavicki/swi-design-system';

// Estado de saúde do domínio para o status do LocationPin do DS. good/alert/low
// passam direto; 'unknown' (sem leitura) vira 'offline', que o DS já desenha.
export function toPinStatus(status: 'good' | 'alert' | 'low' | 'unknown'): LocationPinStatus {
  return status === 'unknown' ? 'offline' : status;
}
