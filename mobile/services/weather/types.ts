// Local mirror do shape devolvido pelo endpoint de clima do swi-backend.
// Siblings isolados → NÃO importamos os tipos do backend: este arquivo é a
// fronteira do contrato REST e precisa ser conferido à mão quando ele mudar.
// Mirrors services/<domínio>/types.ts. Datas ISO.

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

// Centroide do site (piloto SP) — objeto { lat, lng }, mesmo centroide do
// USER_LOCATION (tupla [lng, lat]) que o mapa usa. Fonte da verdade de "onde é
// a obra" pro clima.
export const SITE_LOCATION: { lat: number; lng: number } = { lat: -23.55, lng: -46.63 };
