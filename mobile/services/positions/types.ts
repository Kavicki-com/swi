// Posições realtime: o app é a FONTE do sinal em produção, posta a própria
// posição GPS no backend, que upserta e empurra pros admins via WS. Em dev, o
// simulador server-side alimenta o mesmo caminho.

import type { QueuedPoint } from './positionOutbox';

// Estado de saúde do colega, pela régua única do backend. Só o estado chega
// ao app; nenhum número de saúde de um funcionário chega a outro.
export type ColleagueStatus = 'good' | 'alert' | 'low' | 'unknown';

// Colega no mapa: última posição recente de outro funcionário da mesma empresa.
export interface Colleague {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sector: string | null;
  avatar: string;             // URL assinada; vazio quando não há foto
  recordedAt: string;         // ISO datetime
  status: ColleagueStatus;
}

export interface HeatCell {
  lat: number;
  lng: number;
  weight: number;             // minutos distintos de funcionário na célula
}

// Mapa de calor da empresa: células agregadas, nunca trilhas individuais.
export interface PositionHeat {
  cellSizeM: number;
  from: string;               // ISO datetime da janela consultada
  to: string;
  cells: HeatCell[];          // mais quentes primeiro
}

// Resposta de POST /positions/batch: quantos viraram amostra na trilha e
// quantos o backend ignorou (hora adiantada ou velha demais).
export interface PositionBatchResult {
  recorded: number;
  ignored: number;
}

export interface PositionsBackend {
  // (lat, lng) — mesma ordem do POST /positions/heartbeat do swi-backend.
  heartbeat(lat: number, lng: number): Promise<void>;
  // Posições guardadas pelo rastreio, cada uma com a hora em que foi medida.
  // Repetir o mesmo lote não duplica nada no backend.
  sendBatch(points: readonly QueuedPoint[]): Promise<PositionBatchResult>;
  listColleagues(): Promise<Colleague[]>;
  // Sem janela: o servidor usa as últimas 24 horas.
  heat(): Promise<PositionHeat>;
}
