import type { LakeDef } from '../data/lakes/types';
import { TUNING } from '../data/tuning';
import type { Rng } from './rng';
import type { Conditions, PressureTrend, Season, Weather } from './types';

const WEATHERS: Weather[] = ['Bluebird', 'Overcast', 'Windy', 'Rain'];

/** Water temp (F) for a month/day, interpolated between mid-month climate values. */
export function climateTempF(lake: LakeDef, month: number, day: number): number {
  const temps = lake.climate.waterTempFByMonth;
  const t = month - 1 + (day - 15) / 30;
  const i0 = ((Math.floor(t) % 12) + 12) % 12;
  const i1 = (i0 + 1) % 12;
  const f = t - Math.floor(t);
  return temps[i0] * (1 - f) + temps[i1] * f;
}

/**
 * Seasonal phase from temperature and its trend. Bass respond to the trend more than the
 * absolute number (In-Fisherman calendar periods), so warming 60F water is Spawn while
 * cooling 60F water is Fall.
 */
export function seasonFor(tempF: number, trendFPerDay: number, turnoverRoll: number): Season {
  if (tempF < 48) return 'Winter';
  if (trendFPerDay >= 0) {
    if (tempF < 58) return 'Prespawn';
    if (tempF < 67) return 'Spawn';
    if (tempF < 72) return 'Postspawn';
    return 'Summer';
  }
  if (tempF >= 72) return 'Summer';
  if (tempF >= 54 && tempF < 59 && turnoverRoll < 0.3) return 'Turnover';
  return 'Fall';
}

function rollPressure(rng: Rng, weather: Weather): { pressureTrend: PressureTrend; postFront: boolean } {
  const r = rng.next();
  switch (weather) {
    case 'Rain':
      return { pressureTrend: r < 0.7 ? 'falling' : 'steady', postFront: false };
    case 'Bluebird': {
      const rising = r < 0.5;
      return { pressureTrend: rising ? 'rising' : 'steady', postFront: rising && rng.chance(0.5) };
    }
    case 'Overcast':
      return { pressureTrend: r < 0.4 ? 'falling' : 'steady', postFront: false };
    case 'Windy':
      return { pressureTrend: r < 0.4 ? 'falling' : r < 0.8 ? 'steady' : 'rising', postFront: false };
  }
}

function rollWeather(rng: Rng, lake: LakeDef, previous?: Weather): Weather {
  // Some day-to-day persistence for multi-day events.
  if (previous && rng.chance(0.45)) return previous;
  return rng.weighted(WEATHERS, (w) => lake.climate.weatherOdds[w]);
}

export function generateConditions(lake: LakeDef, rng: Rng, opts?: { month?: number; day?: number; weather?: Weather }): Conditions {
  const month = opts?.month ?? rng.pick(lake.climate.tournamentMonths);
  const day = opts?.day ?? rng.int(1, 28);
  const weather = opts?.weather ?? rollWeather(rng, lake);
  const base = climateTempF(lake, month, day);
  const climateTrend = (climateTempF(lake, month, day + 3) - climateTempF(lake, month, day - 3)) / 6;
  const { pressureTrend, postFront } = rollPressure(rng, weather);
  const frontChill = postFront ? -1.5 : 0;
  const waterTempF = Math.round((base + rng.normal(0, 1.5) + frontChill) * 10) / 10;
  const tempTrendFPerDay = Math.round((climateTrend + (postFront ? -0.8 : 0) + rng.normal(0, 0.2)) * 100) / 100;
  const windMph = Math.round(weather === 'Windy' ? rng.range(12, 22) : weather === 'Rain' ? rng.range(5, 14) : rng.range(1, 9));
  const date = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    date,
    month,
    season: seasonFor(waterTempF, tempTrendFPerDay, rng.next()),
    waterTempF,
    tempTrendFPerDay,
    weather,
    windMph,
    windDir: rng.range(0, Math.PI * 2),
    pressureTrend,
    postFront,
  };
}

/** Next tournament day: same season, new (persistent-ish) weather. */
export function nextDayConditions(lake: LakeDef, rng: Rng, prev: Conditions): Conditions {
  const weather = rollWeather(rng, lake, prev.weather);
  const { pressureTrend, postFront } = rollPressure(rng, weather);
  const waterTempF = Math.round((prev.waterTempF + prev.tempTrendFPerDay + rng.normal(0, 0.6)) * 10) / 10;
  return {
    ...prev,
    weather,
    pressureTrend,
    postFront,
    waterTempF,
    windMph: Math.round(weather === 'Windy' ? rng.range(12, 22) : rng.range(1, 10)),
    windDir: prev.windDir + rng.normal(0, 0.6),
  };
}

/** 0..1 light level from sun angle and cloud cover. */
export function lightLevel(clockMin: number, weather: Weather): number {
  const h = clockMin / 60;
  const sun = Math.max(0, Math.sin((Math.PI * (h - 5.5)) / 14));
  const cloud = { Bluebird: 1, Overcast: 0.55, Windy: 0.8, Rain: 0.45 }[weather];
  return sun * cloud;
}

/** Dawn/dusk feeding windows (2026 accelerometer telemetry: activity peaks at dawn). */
export function timeOfDayFactor(clockMin: number): number {
  const h = clockMin / 60;
  return 0.7 + 0.4 * Math.exp(-(((h - 6.5) / 1.6) ** 2)) + 0.25 * Math.exp(-(((h - 18.5) / 1.6) ** 2));
}

export function formatClock(clockMin: number): string {
  const total = Math.floor(clockMin);
  let h = Math.floor(total / 60);
  const m = total % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

export const dayLengthMin = () => TUNING.clock.dayEndMin - TUNING.clock.dayStartMin;
