import type {
  ProviderConfig,
  ProviderContext,
  WeatherQueryParams,
  WeatherSnapshot
} from '../types';

interface OpenMeteoResponse {
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max?: number[];
  };
}

function addDays(start: string, days: number): string {
  const date = new Date(start);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().substring(0, 10);
}

function buildMockWeather(params: WeatherQueryParams): WeatherSnapshot {
  const start = new Date(params.startDate);
  const days = Array.from({ length: params.days }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    const baseHi = 30 - index;
    return {
      date: date.toISOString().substring(0, 10),
      hiC: baseHi,
      loC: baseHi - 6,
      precipProb: 20 + index * 5
    };
  });

  return { daily: days };
}

export async function weatherProvider(
  params: WeatherQueryParams,
  context: ProviderContext,
  _config: ProviderConfig
): Promise<WeatherSnapshot> {
  const cacheKey = `weather:${JSON.stringify(params)}`;
  const cached = context.cache.get<WeatherSnapshot>(cacheKey);
  if (cached) {
    context.providersUsed.add('cache:open-meteo');
    return cached;
  }

  try {
    const endDate = addDays(params.startDate, params.days - 1);
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', params.lat.toString());
    url.searchParams.set('longitude', params.lon.toString());
    url.searchParams.set('start_date', params.startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set(
      'daily',
      'temperature_2m_max,temperature_2m_min,precipitation_probability_max'
    );
    url.searchParams.set('timezone', 'auto');

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.warn(
        `[providers/weather] Open-Meteo request failed ${response.status}, using mock weather.`
      );
      const mock = buildMockWeather(params);
      context.providersUsed.add('weather:mock');
      context.cache.set(cacheKey, mock);
      return mock;
    }

    const data = (await response.json()) as OpenMeteoResponse;
    const { daily } = data;
    if (!daily?.time?.length) {
      const mock = buildMockWeather(params);
      context.providersUsed.add('weather:mock');
      context.cache.set(cacheKey, mock);
      return mock;
    }

    const days = daily.time.map((time, index) => ({
      date: time,
      hiC: Number(daily.temperature_2m_max[index]?.toFixed(1)),
      loC: Number(daily.temperature_2m_min[index]?.toFixed(1)),
      precipProb: daily.precipitation_probability_max?.[index]
    }));

    const snapshot: WeatherSnapshot = { daily: days };
    context.providersUsed.add('open-meteo');
    context.cache.set(cacheKey, snapshot);
    return snapshot;
  } catch (error) {
    console.error(
      '[providers/weather] Weather lookup error',
      (error as Error).message
    );
    const mock = buildMockWeather(params);
    context.providersUsed.add('weather:mock');
    context.cache.set(cacheKey, mock);
    return mock;
  }
}
