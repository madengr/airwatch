export const aircraftColorPalette = [
  { value: '#2d73f2', name: 'Dark Blue' },
  { value: '#00e5ff', name: 'Cyan' },
  { value: '#00e338', name: 'Green' },
  { value: '#ffef00', name: 'Yellow' },
  { value: '#ff3636', name: 'Red' },
  { value: '#ae4dff', name: 'Violet' },
  { value: '#a5afa6', name: 'Gray' },
  { value: '#4d90ff', name: 'Blue' },
  { value: '#b7c0b6', name: 'Light Gray' },
];

const allowedColors = new Set(aircraftColorPalette.map(({ value }) => value));
const bandColors = {
  ground: '#2d73f2', low: '#00e5ff', mid: '#00e338', high: '#ffef00',
  upper: '#ff3636', cruise: '#ae4dff', unknown: '#a5afa6',
};

export const defaultAircraftColors = {
  altitude: { thresholds: [1200, 10000, 18000, 40000], colors: { ...bandColors } },
  speed: { thresholds: [100, 200, 300, 400], colors: { ...bandColors } },
  squawk: { colors: { vfr: '#00e338', special: '#ff3636', other: '#4d90ff', unknown: '#b7c0b6' } },
};

export const altitudeAglTransitionFt = 18_000;

export function squawkColorBand(code) {
  if (!code) return 'unknown';
  if (code === '1200') return 'vfr';
  if (code === '7500' || code === '7600' || code === '7700') return 'special';
  return 'other';
}

export function validColorThresholds(mode, thresholds) {
  if ((mode !== 'altitude' && mode !== 'speed') || !Array.isArray(thresholds) || thresholds.length !== 4) return false;
  for (let i = 0; i < thresholds.length; i++) {
    const threshold = thresholds[i];
    if (!Number.isSafeInteger(threshold) || (mode === 'speed' && threshold < 0)) return false;
    if (i > 0 && thresholds[i - 1] >= threshold) return false;
  }
  return true;
}

export function loadAircraftColors(saved) {
  const config = {};
  for (const [mode, defaults] of Object.entries(defaultAircraftColors)) {
    const stored = saved?.[mode];
    const colors = {};
    for (const [band, fallback] of Object.entries(defaults.colors)) {
      const value = stored?.colors?.[band];
      const hex = typeof value === 'string' ? value.toLowerCase() : null;
      colors[band] = allowedColors.has(hex) ? hex : fallback;
    }
    config[mode] = { colors };
    if (defaults.thresholds) {
      const thresholds = validColorThresholds(mode, stored?.thresholds) ? stored.thresholds : defaults.thresholds;
      config[mode].thresholds = [...thresholds];
    }
  }
  return config;
}
