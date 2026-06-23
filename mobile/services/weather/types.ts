// Local mirror do shape devolvido pela custom query getWeather do swi-backend.
// Siblings isolados → NÃO importamos o Schema; após deploy, `ampx generate` pode
// substituir. Mirrors services/<domínio>/types.ts. Datas ISO.

export type WeatherCondition = 'clear' | 'clouds' | 'rain' | 'storm' | 'snow' | 'fog';

export interface WeatherCurrent {
  tempC: number;
  condition: WeatherCondition;
  humidityPct: number;
  windKmh: number;
}
export interface WeatherDaily { minC: number; maxC: number; }
export interface WeatherAlert {
  id: string;
  event: string;             // "Tempestade severa"
  description: string;
  startsAt: string;          // ISO datetime
  endsAt: string;            // ISO datetime
}
export interface WeatherSnapshot {
  current: WeatherCurrent;
  daily: WeatherDaily;
  alerts: WeatherAlert[];    // vazio = sem alerta ativo
  fetchedAt: string;         // ISO datetime
}

export interface WeatherBackend {
  // sem args: usa a constante SITE_LOCATION (clima do local fixo da obra).
  getWeather(): Promise<WeatherSnapshot>;
}

// Centroide do site (piloto SP) — mesmo valor do USER_LOCATION que o mapa
// centraliza. Fonte da verdade de "onde é a obra" pro clima. [lng, lat].
export const SITE_LOCATION: { lat: number; lng: number } = { lat: -23.55, lng: -46.63 };
