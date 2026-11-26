import { readFileSync } from 'node:fs';

const rows = 181;
const columns = 360;
const grid = readFileSync(new URL('./data/egm96-1deg.bin', import.meta.url));
if (grid.length !== rows * columns * 2) throw new Error('The EGM96 geoid grid has an unexpected size.');

function undulationCm(row, column) {
  return grid.readInt16LE((row * columns + column) * 2);
}

export function ellipsoidToMslFeet(heightFt, lat, lon) {
  if (!Number.isFinite(heightFt)) return null;

  const y = 90 - lat;
  const x = (lon + 180) % 360;
  const row = Math.floor(y);
  const column = Math.floor(x);
  const nextRow = Math.min(row + 1, rows - 1);
  const nextColumn = (column + 1) % columns;
  const fractionX = x - column;
  const fractionY = y - row;
  const north = undulationCm(row, column) * (1 - fractionX) + undulationCm(row, nextColumn) * fractionX;
  const south = undulationCm(nextRow, column) * (1 - fractionX) + undulationCm(nextRow, nextColumn) * fractionX;
  const geoidHeightFt = (north * (1 - fractionY) + south * fractionY) / 30.48;
  return heightFt - geoidHeightFt;
}
