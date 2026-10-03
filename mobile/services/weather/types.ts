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
export interface WeatherHourly {
  at: string;                // ISO datetime da hora cheia
  tempC: number;
  condition: WeatherCondition;
  isDay?: boolean;
}
export type WeatherAlertKind = 'CHUVA_INTENSA' | 'TEMPESTADE' | 'SOL_INTENSO';
// ATENCAO pede cuidado; PERIGO pede interromper a atividade exposta.
export type WeatherAlertSeverity = 'ATENCAO' | 'PERIGO';
export interface WeatherAlert {
  id: string;
  // kind e severity são opcionais aqui (no backend são obrigatórios): backend
  // antigo e o mock podem não mandar, e a tela precisa seguir de pé.
  kind?: WeatherAlertKind;
  severity?: WeatherAlertSeverity;
  event: string;             // título curto, pronto pra tela: "Tempestade"
  description: string;
  startsAt: string;          // ISO datetime
  endsAt: string;            // ISO datetime
}
export interface WeatherSnapshot {
  current: WeatherCurrent;
  daily: WeatherDaily;
  hourly?: WeatherHourly[];
  alerts: WeatherAlert[];    // vazio = sem alerta ativo
  fetchedAt: string;         // ISO datetime
  // A fonte falhou agora e a resposta repete a última leitura boa.
  stale?: boolean;
  // A fonte falhou e não há leitura boa: current/daily/hourly são valores de
  // reserva, que a tela NÃO mostra como medição.
  unavailable?: boolean;
  // Há alerta de demonstração na resposta. Nunca verdadeiro em produção.
  demo?: boolean;
}

export interface WeatherBackend {
  // sem args: usa a constante SITE_LOCATION (clima do local fixo da obra).
  getWeather(): Promise<WeatherSnapshot>;
}

// Centroide do site (piloto SP) — objeto { lat, lng }, mesmo centroide do
// USER_LOCATION (tupla [lng, lat]) que o mapa usa. Fonte da verdade de "onde é
// a obra" pro clima.
export const SITE_LOCATION: { lat: number; lng: number } = { lat: -23.55, lng: -46.63 };
