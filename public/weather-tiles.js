import { mosaicColors } from './weather-mosaic-palette.js';

export function filterMosaicTiles(layer, minimumDbz) {
  // The IEM palette starts at −32 dBZ and advances by 0.5 dBZ per color.
  const hiddenColors = new Set(mosaicColors.slice(0, (minimumDbz + 32) * 2).map((hex) => Number.parseInt(hex, 16)));
  layer.createTile = (coords, done) => {
    const tile = document.createElement('canvas');
    const size = layer.getTileSize();
    tile.width = size.x;
    tile.height = size.y;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (!tile.isConnected) return;
      try {
        const context = tile.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, size.x, size.y);
        const pixels = context.getImageData(0, 0, size.x, size.y);
        const { data } = pixels;
        let filtered = false;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] === 0) continue;
          const rgb = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
          if (!hiddenColors.has(rgb)) continue;
          data[i + 3] = 0;
          filtered = true;
        }
        if (filtered) context.putImageData(pixels, 0, 0);
      } catch (error) {
        // Clear the tile if pixel filtering fails instead of showing unfiltered returns.
        tile.width = size.x;
        done(error, tile);
        return;
      }
      done(null, tile);
    };
    image.onerror = () => {
      if (tile.isConnected) done(new Error('Weather tile unavailable'), tile);
    };
    image.src = layer.getTileUrl(coords);
    return tile;
  };
}
