export type LocationPermission = 'granted' | 'denied' | 'undetermined';
export interface LocationState {
  // [lng, lat] do GPS do aparelho. null enquanto não há leitura (permissão
  // negada, sem sinal, primeira leitura ainda não chegou): não existe posição
  // de reserva, quem consome decide o que mostrar sem ela.
  coords: [number, number] | null;
  permission: LocationPermission;
}
