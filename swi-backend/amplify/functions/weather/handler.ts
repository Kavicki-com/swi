// Deploy-gated. Busca OpenWeather One Call 3.0 e mapeia → o shape devolvido
// pela custom query getWeather (ver data/resource.ts). NUNCA roda agora (sem
// conta AWS); existe pra o backend ser código real + typechecked.

interface OneCallAlert { event?: string; description?: string; start?: number; end?: number; }
interface OneCall {
  current?: { temp?: number; humidity?: number; wind_speed?: number; weather?: { main?: string }[] };
  daily?: { temp?: { min?: number; max?: number } }[];
  alerts?: OneCallAlert[];
}

// Mapeia o `weather[0].main` da OpenWeather → o enum WeatherCondition do app.
function mapCondition(main: string | undefined): string {
  switch ((main ?? '').toLowerCase()) {
    case 'thunderstorm': return 'storm';
    case 'rain': case 'drizzle': return 'rain';
    case 'snow': return 'snow';
    case 'clouds': return 'clouds';
    case 'mist': case 'fog': case 'haze': return 'fog';
    default: return 'clear';
  }
}

export const handler = async (event: { arguments: { lat: number; lng: number } }) => {
  const key = process.env.OPENWEATHER_API_KEY;
  const { lat, lng } = event.arguments;
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lng}&units=metric&exclude=minutely,hourly&appid=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenWeather ${res.status}`);
  const data = (await res.json()) as OneCall;

  const today = data.daily?.[0]?.temp;
  const nowIso = new Date().toISOString();
  return {
    tempC: data.current?.temp ?? 0,
    condition: mapCondition(data.current?.weather?.[0]?.main),
    humidityPct: data.current?.humidity ?? 0,
    windKmh: Math.round((data.current?.wind_speed ?? 0) * 3.6), // m/s → km/h
    minC: today?.min ?? 0,
    maxC: today?.max ?? 0,
    alerts: (data.alerts ?? []).map((a, i) => ({
      id: `wx-${i}`,
      event: a.event ?? 'Alerta meteorológico',
      description: a.description ?? '',
      startsAt: a.start ? new Date(a.start * 1000).toISOString() : nowIso,
      endsAt: a.end ? new Date(a.end * 1000).toISOString() : nowIso,
    })),
    fetchedAt: nowIso,
  };
};
