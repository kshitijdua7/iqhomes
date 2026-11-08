/**
 * Real weather from Open-Meteo (free, no API key). Defaults to Oakville, Ontario.
 * Also provides today's sunrise/sunset, used by schedules ("porch light on at sunset").
 */

export interface Weather {
  place: string;
  temp: number;          // °C now
  feelsLike: number;
  condition: string;     // "Light rain"
  icon: string;          // emoji
  high: number;
  low: number;
  rainChance: number;    // % today
  wind: number;          // km/h
  sunrise: number;       // ms
  sunset: number;        // ms
  hourly: { time: number; temp: number; icon: string }[]; // next 12 hours
  updated: number;
}

const LAT = Number(process.env.WEATHER_LAT ?? 43.4675);
const LON = Number(process.env.WEATHER_LON ?? -79.6877);
const PLACE = process.env.WEATHER_PLACE ?? 'Oakville';

/** WMO weather codes → words + emoji. */
function describe(code: number, isDay = true): [string, string] {
  if (code === 0) return ['Clear', isDay ? '☀️' : '🌙'];
  if (code <= 2) return ['Partly cloudy', isDay ? '⛅' : '☁️'];
  if (code === 3) return ['Cloudy', '☁️'];
  if (code <= 48) return ['Foggy', '🌫️'];
  if (code <= 57) return ['Drizzle', '🌦️'];
  if (code <= 67) return [code >= 65 ? 'Heavy rain' : 'Rain', '🌧️'];
  if (code <= 77) return ['Snow', '🌨️'];
  if (code <= 82) return ['Rain showers', '🌦️'];
  if (code <= 86) return ['Snow showers', '🌨️'];
  return ['Thunderstorms', '⛈️'];
}

let cache: Weather | undefined;
let inflight: Promise<Weather | undefined> | undefined;

export async function getWeather(maxAgeMs = 10 * 60_000): Promise<Weather | undefined> {
  if (cache && Date.now() - cache.updated < maxAgeMs) return cache;
  inflight ??= fetchWeather().finally(() => { inflight = undefined; });
  return inflight;
}

export const cachedWeather = () => cache;

async function fetchWeather(): Promise<Weather | undefined> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(LAT), longitude: String(LON), timezone: 'auto', forecast_days: '2', timeformat: 'unixtime',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
    hourly: 'temperature_2m,weather_code',
  }).toString();
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return cache;
    const d = await r.json() as any;
    const [condition, icon] = describe(d.current.weather_code, d.current.is_day === 1);
    const now = Date.now() / 1000;
    const start = d.hourly.time.findIndex((t: number) => t >= now - 1800);
    cache = {
      place: PLACE,
      temp: Math.round(d.current.temperature_2m),
      feelsLike: Math.round(d.current.apparent_temperature),
      condition, icon,
      high: Math.round(d.daily.temperature_2m_max[0]),
      low: Math.round(d.daily.temperature_2m_min[0]),
      rainChance: d.daily.precipitation_probability_max[0] ?? 0,
      wind: Math.round(d.current.wind_speed_10m),
      sunrise: d.daily.sunrise[0] * 1000,
      sunset: d.daily.sunset[0] * 1000,
      hourly: d.hourly.time.slice(Math.max(start, 0), Math.max(start, 0) + 12).map((t: number, i: number) => ({
        time: t * 1000, temp: Math.round(d.hourly.temperature_2m[Math.max(start, 0) + i]), icon: describe(d.hourly.weather_code[Math.max(start, 0) + i])[1],
      })),
      updated: Date.now(),
    };
    return cache;
  } catch {
    return cache; // offline: keep the last good forecast
  }
}

export function weatherSentence(w: Weather): string {
  const rain = w.rainChance >= 40 ? ` There's a ${w.rainChance}% chance of rain, so grab an umbrella.` : '';
  return `In ${w.place} it's ${w.temp}° and ${w.condition.toLowerCase()}${w.feelsLike !== w.temp ? `, feels like ${w.feelsLike}°` : ''}. Today's high is ${w.high}° with a low of ${w.low}°.${rain}`;
}
