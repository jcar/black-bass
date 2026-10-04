import type { Conditions } from '../sim/types';

/** Dock-talk for the briefing: the GDD's tackle-matching rules, phrased for the day's conditions. */
export function conditionsAdvice(c: Conditions, secchiFt: number): string[] {
  const tips: string[] = [];
  const clear = secchiFt >= 8;
  tips.push(
    clear
      ? 'Clear water: natural, translucent colours (green pumpkin, ghost minnow, smoke) look most real.'
      : 'Stained water: high-visibility colours (chartreuse, black & blue) and lures that vibrate get noticed.',
  );
  if (c.waterTempF >= 60 && (c.weather === 'Overcast' || c.weather === 'Rain')) tips.push('Low light all day: topwater can keep producing well past sunrise.');
  else if (c.waterTempF >= 60) tips.push('Throw topwater at first light, then slow down as the sun climbs.');
  if (c.weather === 'Windy') tips.push('Wind pushes bait onto windblown banks. Moving baits like squarebills and bladed jigs shine.');
  if (c.weather === 'Bluebird') tips.push('Bluebird skies push bass tight to cover and deeper. Finesse on the bottom midday.');
  if (c.postFront) tips.push('Post-front: the big ones have lockjaw. Slow down and fish tight to cover.');
  if (c.pressureTrend === 'falling') tips.push('Falling barometer: fish are feeding. Cover water.');
  if (c.waterTempF < 55) tips.push('Cold water: a suspending jerkbait with long pauses (4-8 s) is the classic.');
  switch (c.season) {
    case 'Prespawn':
      tips.push('Prespawn: big females stage on the first drops outside spawning flats. They are heavy.');
      break;
    case 'Spawn':
      tips.push('Spawn: fish are shallow and protective. Pitch soft plastics to them; reaction strikes happen.');
      break;
    case 'Postspawn':
      tips.push('Postspawn: fish are worn out and scattered. Be patient.');
      break;
    case 'Summer':
      tips.push('Summer: smallmouth slide out to offshore rock and reefs; largemouth hold in grass and shade.');
      break;
    case 'Fall':
      tips.push('Fall: bass chase bait. Cover water with moving baits.');
      break;
    case 'Turnover':
      tips.push('Turnover: tough fishing. Look for the clearest water you can find.');
      break;
    case 'Winter':
      tips.push('Winter: slow and deep. Bottom baits and jerkbaits.');
      break;
  }
  return tips;
}

export const WEATHER_LABEL = { Bluebird: '☀️ Bluebird', Overcast: '☁️ Overcast', Windy: '💨 Windy', Rain: '🌧️ Rain' } as const;
