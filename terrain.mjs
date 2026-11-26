import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const missing = -32768;
const sampleOffset = 1 / 120;
const regionalGrids = loadGrids('etopo-2022-us-1arcmin-land.bin.gz', 60, [
  [24, 50, -125, -66],    // Contiguous United States
  [50, 72, -180, -129],   // Alaska
  [50, 55, 172, 180],     // Western Aleutian Islands
  [18, 23, -161, -154],   // Hawaii
  [17, 19, -68, -64],     // Puerto Rico and U.S. Virgin Islands
  [13, 21, 144, 147],     // Guam and Northern Mariana Islands
  [-15, -11, -173, -169], // American Samoa
]);
const [globalGrid] = loadGrids('etopo-2022-5arcmin-land.bin.gz', 12, [[-90, 90, -180, 180]]);

function loadGrids(filename, samplesPerDegree, bounds) {
  let count = 0;
  const grids = bounds.map(([south, north, west, east]) => {
    const rows = (north - south) * samplesPerDegree;
    const columns = (east - west) * samplesPerDegree;
    const start = count;
    count += rows * columns;
    return { south, north, west, east, rows, columns, start, samplesPerDegree };
  });
  const gridBytes = count * 2;
  try {
    const file = readFileSync(new URL('./data/' + filename, import.meta.url));
    const samples = gunzipSync(file, { maxOutputLength: gridBytes });
    return samples.length === gridBytes ? grids.map((grid) => ({ ...grid, samples })) : [];
  } catch {
    return [];
  }
}

function sample(grid, row, column) {
  const { samples, start, columns } = grid;
  return samples.readInt16LE((start + row * columns + column) * 2);
}

function clampIndex(value, count) {
  return Math.max(0, Math.min(count - 1, value));
}

export function terrainElevationFeet(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const longitude = lon === 180 ? -180 : lon;
  const grid = regionalGrids.find(({ south, north, west, east }) =>
    lat >= south && lat < north && longitude >= west && longitude < east
  ) ?? globalGrid;
  if (!grid) return null;

  const { south: latitudeOrigin, west: longitudeOrigin, rows, columns, samplesPerDegree } = grid;
  const columnIndex = grid === globalGrid ? (value) => (value + columns) % columns
    : (value) => clampIndex(value, columns);
  const y = clampIndex((lat - latitudeOrigin - sampleOffset) * samplesPerDegree, rows);
  const x = columnIndex((longitude - longitudeOrigin - sampleOffset) * samplesPerDegree);
  if (sample(grid, Math.round(y), columnIndex(Math.round(x))) === missing) return null;

  const south = Math.floor(y);
  const north = Math.min(south + 1, rows - 1);
  const west = Math.floor(x);
  const east = columnIndex(west + 1);
  const dy = y - south;
  const dx = x - west;
  let elevationMeters = 0;
  let weight = 0;

  for (const [row, latitudeWeight] of [[south, 1 - dy], [north, dy]]) {
    for (const [column, longitudeWeight] of [[west, 1 - dx], [east, dx]]) {
      const meters = sample(grid, row, column);
      if (meters === missing) continue;
      const contribution = latitudeWeight * longitudeWeight;
      elevationMeters += meters * contribution;
      weight += contribution;
    }
  }
  return Math.round(elevationMeters / weight / 0.3048);
}
