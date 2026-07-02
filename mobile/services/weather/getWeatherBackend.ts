import type { WeatherBackend } from './types';
import { mockWeatherBackend } from './mockWeatherBackend';

// Pinado em mock até a fatia Clima ligar o apiWeatherBackend
// (rodada: docs/plans/2026-07-02-swi-backend-dominios-nao-saude-design.md).
export function getWeatherBackend(): WeatherBackend {
  return mockWeatherBackend;
}
