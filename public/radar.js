import { altitudeAglTransitionFt, defaultAircraftColors, squawkColorBand } from './aircraft-colors.js';
import { filterMosaicTiles } from './weather-tiles.js';

const L = window.L;
const EARTH_RADIUS_NM = 3440.065;
const RADIANS = Math.PI / 180;
const USGS_IMAGERY = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer';
const FAA_CHARTS = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
const basemapProviders = {
  imagery: { title: 'Imagery', url: USGS_IMAGERY, credit: 'USDA · USGS National Map imagery', zoom: [0, 16] },
  vfr: { title: 'VFR Sectional', url: FAA_CHARTS + 'VFR_Sectional/MapServer', credit: 'FAA VFR Sectional chart', zoom: [8, 12], chart: true },
  'ifr-low': { title: 'IFR Low', url: FAA_CHARTS + 'IFR_AreaLow/MapServer', credit: 'FAA IFR Low En Route chart', zoom: [8, 12], chart: true },
  'ifr-high': { title: 'IFR High', url: FAA_CHARTS + 'IFR_High/MapServer', credit: 'FAA IFR High En Route chart', zoom: [7, 9], chart: true },
};
const regionalChartZooms = {
  alaska: { 'ifr-low': [7, 10], 'ifr-high': [6, 9] },
  hawaii: { 'ifr-low': [8, 11], 'ifr-high': [5, 7] },
};
const artccAttribution = '<a href="https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/ArcGIS/rest/services/Boundary_Airspace/FeatureServer" target="_blank" rel="noopener noreferrer">FAA charted airspace</a>';
const WEATHER_INTERVAL_MS = 300_000;
const WEATHER_TILES = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q/{z}/{x}/{y}.png';
const weatherBounds = [[23, -128], [51, -64]];
const weatherAttribution = '<a href="https://mesonet.agron.iastate.edu/docs/nexrad_composites/" target="_blank" rel="noopener noreferrer">NEXRAD Mosaic · Iowa Environmental Mesonet</a>';
const MAX_VECTOR_AGE_SECONDS = 60;
const HISTORY_IDLE_MS = 20 * 60_000;
const historyDotOpacity = [0.66, 0.52, 0.39, 0.27];
const dataBlock = { width: 124, height: 46, horizontalOffset: 15, verticalOffset: 8, padding: 4 };
const previewFlight = {
  callsign: 'SAMPLE', altitudeFt: 12_400, verticalRateFpm: -640, speedKt: 340, squawk: '1200', type: 'B738',
};
const leaderLength = Math.hypot(dataBlock.horizontalOffset, dataBlock.verticalOffset);
const preferredLeaderCosine = Math.cos(40 * RADIANS);
const retainedLeaderCosine = Math.cos(25 * RADIANS);
const localMapResources = new Map();

function loadLocalMapResource(path, prepare) {
  const existing = localMapResources.get(path);
  if (existing) return existing;
  const pending = fetch(path).then((response) => {
    if (!response.ok) throw new Error('Map resource request failed: ' + path);
    return response.json();
  }).then(prepare);
  localMapResources.set(path, pending);
  pending.catch(() => {
    if (localMapResources.get(path) === pending) localMapResources.delete(path);
  });
  return pending;
}

export function aircraftLabel(flight) {
  return flight.callsign || flight.registration || flight.id.toUpperCase();
}

export function distanceNm(lat, lon, otherLat, otherLon) {
  const a = Math.sin((otherLat - lat) * RADIANS / 2) ** 2
    + Math.cos(lat * RADIANS) * Math.cos(otherLat * RADIANS)
    * Math.sin((otherLon - lon) * RADIANS / 2) ** 2;
  return 2 * EARTH_RADIUS_NM * Math.asin(Math.sqrt(Math.min(a, 1)));
}

function nearLongitude(lon, centerLon) {
  return lon + Math.round((centerLon - lon) / 360) * 360;
}

function chartRegion(area) {
  if (!area) return null;
  const { lat, lon } = area;
  const alaskaLon = nearLongitude(lon, -152);
  if (lat >= 50 && lat <= 73 && alaskaLon >= -190 && alaskaLon <= -128) return 'alaska';
  if (lat >= 17 && lat <= 25 && lon >= -165 && lon <= -150) return 'hawaii';
  return null;
}

function boundaryLines(geometry) {
  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  if (geometry.type === 'MultiPolygon') return coordinates.flat();
  if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') return coordinates;
  if (geometry.type === 'LineString') return [coordinates];
  return [];
}

function unwrapBoundary(coordinates) {
  let previous;
  let west = Infinity;
  let east = -Infinity;
  const points = [];
  for (const [lon, lat] of coordinates) {
    const unwrapped = previous === undefined ? lon : nearLongitude(lon, previous);
    points.push([lat, unwrapped]);
    west = Math.min(west, unwrapped);
    east = Math.max(east, unwrapped);
    previous = unwrapped;
  }
  return { points, centerLon: (west + east) / 2 };
}

function prepareArtccBoundaries({ features }) {
  const index = new Map();
  for (const feature of features) {
    const id = feature.properties?.id;
    const lines = boundaryLines(feature.geometry).filter((line) => line.length >= 2).map(unwrapBoundary);
    if (typeof id !== 'string' || !lines.length) continue;
    index.set(id, [...(index.get(id) ?? []), ...lines]);
  }
  return index;
}

function samePosition(a, b) {
  return a.lat === b.lat && a.lon === nearLongitude(b.lon, a.lon);
}

function positionTimestamp(flight, observedAt) {
  if (!Number.isFinite(observedAt) || !Number.isFinite(flight.positionAgeSeconds)) return null;
  return observedAt - Math.max(0, flight.positionAgeSeconds) * 1_000;
}

function earlierPosition(first, second) {
  if (first.at !== null && second.at !== null) return first.at < second.at;
  return first.observedAt < second.observedAt;
}

function destination(lat, lon, degrees, nm) {
  const latitude = lat * RADIANS;
  const bearing = degrees * RADIANS;
  const angle = nm / EARTH_RADIUS_NM;
  const targetLat = Math.asin(Math.sin(latitude) * Math.cos(angle)
    + Math.cos(latitude) * Math.sin(angle) * Math.cos(bearing));
  const targetLon = lon + Math.atan2(
    Math.sin(bearing) * Math.sin(angle) * Math.cos(latitude),
    Math.cos(angle) - Math.sin(latitude) * Math.sin(targetLat),
  ) / RADIANS;
  return [targetLat / RADIANS, targetLon];
}

const styles = {
  land: { stroke: false, fillColor: '#000', fillOpacity: 1 },
  urban: { stroke: false, fillColor: '#131713', fillOpacity: 0.55 },
  lake: { color: '#4d524d', weight: 0.75, opacity: 0.66, fillColor: '#000', fillOpacity: 1 },
  river: { color: '#595e59', weight: 1.15, opacity: 0.6 },
  road: { color: '#454a45', weight: 0.7, opacity: 0.35 },
  majorRoad: { color: '#535853', weight: 1, opacity: 0.5 },
  border: { color: '#686d68', weight: 1.15, opacity: 0.62 },
  boundary: { color: '#646964', weight: 1, opacity: 0.66, dashArray: '4 5' },
};
const geometryOrder = ['land', 'urban', 'lake', 'road', 'river', 'border', 'boundary'];
const airportStyle = { color: '#e99c4d', weight: 1, opacity: 0.94, fillColor: '#68441f', fillOpacity: 0.9, interactive: false };

function prepareGeography({ features }) {
  const grouped = new Map(geometryOrder.map((kind) => [kind, []]));
  const places = [];
  for (const feature of features) {
    const { kind, name, rank } = feature.properties;
    if (kind === 'place') {
      const [lon, lat] = feature.geometry.coordinates;
      places.push({ name, lat, lon, rank: rank || 10 });
    } else {
      grouped.get(kind)?.push(feature);
    }
  }
  places.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'en'));
  return { grouped, places };
}

function prepareAirports(data) {
  const airports = data.filter(([id, lat, lon, priority]) => typeof id === 'string'
    && Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(priority))
    .sort((a, b) => a[3] - b[3] || a[0].localeCompare(b[0], 'en'));
  if (!airports.length) throw new Error('Airport list is empty');
  return airports;
}

function textIcon(className, text, rank, iconAnchor = [-6, 7]) {
  const span = document.createElement('span');
  span.textContent = text;
  if (rank) span.dataset.rank = rank;
  return L.divIcon({ className, html: span, iconSize: [0, 0], iconAnchor });
}

export function formatAltitudeHundreds(flight) {
  return flight.onGround ? 'GND' : formatHeightHundreds(flight.altitudeFt);
}

export function formatHeightHundreds(heightFt) {
  if (!Number.isFinite(heightFt)) return '—';
  const altitudeHundreds = Math.round(heightFt / 100);
  return (altitudeHundreds < 0 ? '−' : '') + String(Math.abs(altitudeHundreds)).padStart(3, '0');
}

export function aircraftSquawk(flight) {
  const code = flight?.squawk;
  return typeof code === 'string' && /^[0-7]{4}$/.test(code) ? code : null;
}

function flightReadout(flight) {
  const speed = Number.isFinite(flight.speedKt) ? Math.round(flight.speedKt) + 'KT' : '—';
  let trend = '—';
  if (Number.isFinite(flight.verticalRateFpm)) {
    trend = flight.verticalRateFpm > 0 ? '↑' : flight.verticalRateFpm < 0 ? '↓' : '·';
  }
  return [
    aircraftLabel(flight),
    flight.onGround ? 'GND ' + speed : [formatAltitudeHundreds(flight), trend, speed].join(' '),
    'SQ ' + (aircraftSquawk(flight) ?? '—') + (flight.type ? ' · ' + flight.type : ''),
  ];
}

function flightIcon(flight, selected, placement, readout, color) {
  const pin = document.createElement('span');
  pin.className = 'aircraft-pin';
  pin.setAttribute('aria-hidden', 'true');
  pin.style.setProperty('--air-color', color);
  const shape = document.createElement('span');
  shape.className = 'target-symbol';
  pin.append(shape);
  if (readout) {
    const block = document.createElement('span');
    block.className = 'target-data';
    for (const [index, className] of ['target-callsign', 'target-motion', 'target-transponder'].entries()) {
      const row = document.createElement('span');
      row.className = className;
      row.textContent = readout[index];
      block.append(row);
    }
    pin.append(block);
  }
  const className = [
    'airmarker', selected && 'selected', flight.onGround && 'ground', flight.emergency && 'emergency',
    placement?.left && 'target-data-left', placement?.up && 'target-data-up',
  ].filter(Boolean).join(' ');
  return L.divIcon({ className, html: pin, iconSize: [44, 44], iconAnchor: [22, 22] });
}

function readoutPosition(point, left, up) {
  const x = left ? point.x - dataBlock.horizontalOffset - dataBlock.width : point.x + dataBlock.horizontalOffset;
  const y = up ? point.y - dataBlock.verticalOffset - dataBlock.height : point.y + dataBlock.verticalOffset;
  return { left, up, bounds: L.bounds([x, y], [x + dataBlock.width, y + dataBlock.height]) };
}

function withReadoutGap(bounds, gap) {
  const padding = [gap, gap];
  return L.bounds(bounds.min.subtract(padding), bounds.max.add(padding));
}

function readoutOverlaps(bounds, placements, gap) {
  const padded = withReadoutGap(bounds, gap);
  for (const other of placements) {
    if (padded.overlaps(other.bounds)) return true;
  }
  return false;
}

function readoutClearsVector({ vectorDelta, vectorPixels }, { left, up }, cosine = preferredLeaderCosine) {
  if (vectorPixels < 1) return true;
  const x = left ? -dataBlock.horizontalOffset : dataBlock.horizontalOffset;
  const y = up ? -dataBlock.verticalOffset : dataBlock.verticalOffset;
  const dot = x * vectorDelta.x + y * vectorDelta.y;
  return dot <= cosine * leaderLength * vectorPixels;
}

function projectedTrack(flight, location, snapshotAgeSeconds) {
  const age = Math.max(0, flight.positionAgeSeconds ?? 0) + Math.max(0, snapshotAgeSeconds);
  if (flight.onGround || age > MAX_VECTOR_AGE_SECONDS || !Number.isFinite(flight.speedKt) || flight.speedKt <= 0
    || !Number.isFinite(flight.trackDeg) || flight.trackDeg < 0 || flight.trackDeg >= 360) return null;
  return [location, destination(...location, flight.trackDeg, flight.speedKt / 60)];
}

export function aircraftAltitudeBand(flight, thresholds = defaultAircraftColors.altitude.thresholds) {
  if (flight.onGround) return 'ground';
  const msl = flight.altitudeFt;
  if (!Number.isFinite(msl)) return 'unknown';
  const altitude = msl < altitudeAglTransitionFt && Number.isFinite(flight.altitudeAglFt) ? flight.altitudeAglFt : msl;
  if (altitude < thresholds[0]) return 'low';
  if (altitude < thresholds[1]) return 'mid';
  if (altitude < thresholds[2]) return 'high';
  if (altitude < thresholds[3]) return 'upper';
  return 'cruise';
}

export function aircraftSpeedBand(flight, thresholds = defaultAircraftColors.speed.thresholds) {
  if (flight.onGround) return 'ground';
  if (!Number.isFinite(flight.speedKt) || flight.speedKt < 0) return 'unknown';
  const knots = Math.round(flight.speedKt);
  if (knots < thresholds[0]) return 'low';
  if (knots < thresholds[1]) return 'mid';
  if (knots < thresholds[2]) return 'high';
  if (knots < thresholds[3]) return 'upper';
  return 'cruise';
}

function aircraftModeColor(flight, colorMode, colors) {
  if (colorMode === 'squawk') return colors.squawk.colors[squawkColorBand(aircraftSquawk(flight))];
  if (colorMode === 'speed') return colors.speed.colors[aircraftSpeedBand(flight, colors.speed.thresholds)];
  return colors.altitude.colors[aircraftAltitudeBand(flight, colors.altitude.thresholds)];
}

export function createRadar(container, notice, onSelect, { preview = false } = {}) {
  const selectedColor = getComputedStyle(container).getPropertyValue('--selected-aircraft').trim() || '#f2f3ed';
  const map = L.map(container, {
    zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false,
    touchZoom: false, boxZoom: false, keyboard: false, zoomSnap: 0,
    fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false,
    preferCanvas: true, minZoom: 0, maxZoom: 18,
  });
  if (!preview) map.on('click', () => onSelect(null));
  map.attributionControl.setPrefix(false);
  if (preview) map.attributionControl.addAttribution('Natural Earth');
  map.createPane('terrain').style.zIndex = 220;
  map.createPane('basemap').style.zIndex = 230;
  map.createPane('weather').style.zIndex = 250;
  const artccPane = map.createPane('artcc');
  artccPane.style.zIndex = 350;
  artccPane.style.pointerEvents = 'none';
  const airportsPane = map.createPane('airports');
  airportsPane.style.zIndex = 390;
  airportsPane.style.pointerEvents = 'none';
  const historyPane = map.createPane('history');
  historyPane.style.zIndex = 425;
  historyPane.style.pointerEvents = 'none';
  const trackPane = map.createPane('tracks');
  trackPane.style.zIndex = 450;
  trackPane.style.pointerEvents = 'none';
  const terrainRenderer = L.canvas({ pane: 'terrain' });
  const artccRenderer = L.canvas({ pane: 'artcc' });
  const airportsRenderer = L.canvas({ pane: 'airports' });
  const historyRenderer = L.canvas({ pane: 'history' });
  const trackRenderer = L.canvas({ pane: 'tracks' });
  const geometry = L.layerGroup().addTo(map);
  const labels = L.layerGroup().addTo(map);
  const rings = L.layerGroup().addTo(map);
  const previewLabel = preview ? L.marker([0, 0], {
    icon: flightIcon(previewFlight, true, null, flightReadout(previewFlight), selectedColor),
    interactive: false, keyboard: false, zIndexOffset: 1000,
  }) : null;
  const markers = new Map();
  const airportMarkers = new Map();
  const positionHistories = new Map();
  let rawPlaces = [];
  const labelCanvas = document.createElement('canvas').getContext('2d');
  let airports = [];
  let airportsUnavailable = false;
  let offlineError = false;
  let basemap = 'radar';
  let tileBasemap = null;
  let wantsWeather = false;
  let weatherMinDbz = null;
  let weatherLayer = null;
  let selectedArtcc = null;
  let artccBoundaries = null;
  let artccLoading = false;
  let artccLoadFailed = false;
  let artccLayer = null;
  let artccLayerKey = null;
  let area = null;
  let viewport = null;
  let traffic = null;
  let historySource = null;
  let latestHistoryObservation = 0;

  function showNotice() {
    const messages = [
      offlineError && 'Offline basemap unavailable',
      airportsUnavailable && 'Airport data unavailable',
      tileBasemap?.notice,
      selectedArtcc && (artccLoadFailed || artccBoundaries && !artccBoundaries.has(selectedArtcc)) && 'Airspace boundary unavailable',
    ].filter(Boolean);
    if (wantsWeather) {
      if (area && !weatherCovered()) messages.push('The U.S. Mosaic covers the contiguous U.S.');
      else if (weatherLayer?.failed) messages.push('U.S. Mosaic unavailable');
    }
    const message = messages.join(' · ');
    notice.textContent = message;
    notice.hidden = !message;
  }

  function bindTileStatus(layer, onStatus) {
    let loaded = 0;
    let errors = 0;
    layer.on('loading', () => { loaded = 0; errors = 0; });
    layer.on('tileload', () => { loaded += 1; });
    layer.on('tileerror', () => { errors += 1; });
    layer.on('load', () => {
      onStatus(errors > 0, loaded);
      showNotice();
    });
  }

  function weatherCovered() {
    return area && L.latLngBounds(weatherBounds).contains([area.lat, area.lon]);
  }

  function addWeatherLayer() {
    const refreshedAt = Date.now();
    const frame = Math.floor(refreshedAt / WEATHER_INTERVAL_MS);
    const layer = L.tileLayer(WEATHER_TILES + '?frame=' + frame, {
      pane: 'weather', bounds: weatherBounds, opacity: 0.63, noWrap: true,
      maxNativeZoom: 10, maxZoom: 18, attribution: weatherAttribution,
    });
    if (weatherMinDbz !== null) filterMosaicTiles(layer, weatherMinDbz);
    const entry = { minimumDbz: weatherMinDbz, layer, refreshedAt, failed: false };
    bindTileStatus(layer, (error, loaded) => {
      entry.failed = error && loaded === 0;
    });
    weatherLayer = entry;
    layer.addTo(map);
  }

  function updateWeatherLayer() {
    const show = wantsWeather && weatherCovered();
    if (weatherLayer && (!show || weatherLayer.minimumDbz !== weatherMinDbz)) {
      weatherLayer.layer.remove();
      weatherLayer = null;
    }
    if (show && !weatherLayer) addWeatherLayer();
  }

  function updateBasemapLayer() {
    const provider = basemapProviders[basemap];
    const zoom = regionalChartZooms[chartRegion(area)]?.[basemap] ?? provider?.zoom;
    const key = zoom ? [basemap, ...zoom].join(':') : null;
    if (key === (tileBasemap?.key ?? null)) return;
    tileBasemap?.layer.remove();
    tileBasemap = null;
    if (!provider) return;

    const [minNativeZoom, maxNativeZoom] = zoom;
    const url = provider.url + '/tile/{z}/{y}/{x}' + (provider.chart ? '?blankTile=false' : '');
    const layer = L.tileLayer(url, {
      pane: 'basemap', minNativeZoom, maxNativeZoom, maxZoom: 18,
      className: provider.chart ? 'chart-tiles' : 'imagery-tiles',
      attribution: '<a href="' + provider.url + '" target="_blank" rel="noopener noreferrer">' + provider.credit + '</a>',
    });
    const entry = { key, layer, notice: '' };
    bindTileStatus(layer, (error, loaded) => {
      entry.notice = !error ? '' : (loaded ? 'Some ' : '') + provider.title + ' tiles unavailable';
    });
    tileBasemap = entry;
    layer.addTo(map);
  }

  function updateLayerOptions(nextBasemap, nextWeather, nextWeatherMinDbz = null) {
    const previousBasemap = basemap;
    basemap = Object.hasOwn(basemapProviders, nextBasemap) ? nextBasemap : 'radar';
    wantsWeather = nextWeather;
    weatherMinDbz = nextWeatherMinDbz;
    if (basemap !== previousBasemap) rings.eachLayer((layer) => layer.setStyle?.({ color: rangeRingColor() }));
    updateBasemapLayer();
    updateWeatherLayer();
    showNotice();
  }

  function updateWeather() {
    const now = Date.now();
    if (!weatherLayer || now - weatherLayer.refreshedAt < WEATHER_INTERVAL_MS) return;
    const frame = Math.floor(now / WEATHER_INTERVAL_MS);
    weatherLayer.refreshedAt = now;
    weatherLayer.layer.setUrl(WEATHER_TILES + '?frame=' + frame);
  }

  function updateAirportMarkers(bounds) {
    const visible = [];
    const active = new Set();
    const { lat: south, lng: west } = bounds.getSouthWest();
    const { lat: north, lng: east } = bounds.getNorthEast();
    for (const [name, lat, lon] of airports) {
      if (lat < south || lat > north) continue;
      const wrappedLon = nearLongitude(lon, area.lon);
      if (wrappedLon < west || wrappedLon > east) continue;
      const location = [lat, wrappedLon];
      active.add(name);
      visible.push({ name, location, rank: 0 });
      const existing = airportMarkers.get(name);
      if (!existing) {
        airportMarkers.set(name, L.circleMarker(location, {
          ...airportStyle, radius: 3, renderer: airportsRenderer,
        }).addTo(map));
      } else if (existing.getLatLng().lng !== wrappedLon) {
        existing.setLatLng(location);
      }
    }
    for (const [name, marker] of airportMarkers) {
      if (active.has(name)) continue;
      marker.remove();
      airportMarkers.delete(name);
    }
    return visible;
  }

  function mapLabelFonts() {
    const probe = document.createElement('div');
    probe.className = 'place-label';
    probe.style.cssText = 'position:absolute; visibility:hidden; left:0; top:0';
    const sample = document.createElement('span');
    sample.textContent = 'Ag';
    probe.append(sample);
    container.append(probe);
    const readFont = () => {
      const { fontWeight, fontSize, fontFamily } = getComputedStyle(sample);
      return {
        font: `${fontWeight} ${fontSize} ${fontFamily}`,
        height: sample.getBoundingClientRect().height,
        averageWidth: parseFloat(fontSize) * 0.61,
      };
    };
    const regular = readFont();
    sample.dataset.rank = '1';
    const primary = readFont();
    probe.remove();
    return { regular, primary };
  }

  function updateLabels() {
    if (!viewport || !container.clientWidth || !container.clientHeight) return;
    labels.clearLayers();
    const bounds = map.getBounds();
    const size = map.getSize();
    const labelBounds = L.bounds([2, 2], size.subtract([2, 2]));
    const visibleAirports = updateAirportMarkers(bounds);
    const visiblePlaces = rawPlaces.map((place) => ({ ...place, location: [place.lat, nearLongitude(place.lon, area.lon)] }))
      .filter(({ location }) => bounds.contains(location));
    const font = mapLabelFonts();
    const occupied = [];
    const addLabel = ({ name, location, rank }) => {
      const metrics = rank === 1 ? font.primary : font.regular;
      if (labelCanvas) labelCanvas.font = metrics.font;
      const width = Math.ceil(labelCanvas?.measureText(name).width ?? name.length * metrics.averageWidth);
      const { x, y } = map.latLngToContainerPoint(location);
      const top = y - 7;
      for (const left of [x + 6, x - width - 6]) {
        const box = L.bounds([left, top], [left + width, top + metrics.height]);
        const withGap = L.bounds(box.min.subtract([3, 2]), box.max.add([3, 2]));
        if (!labelBounds.contains(box) || occupied.some((other) => withGap.overlaps(other))) continue;
        occupied.push(box);
        L.marker(location, {
          icon: textIcon(rank === 0 ? 'place-label airport-label' : 'place-label', name, rank, [x - left, 7]),
          interactive: false, keyboard: false, zIndexOffset: -1000,
        }).addTo(labels);
        return true;
      }
      return false;
    };

    const cityReserve = size.x < 600 ? 2 : 4;
    const cityLimit = size.x < 600 ? 6 : 14;
    const cities = new Set();
    for (const place of visiblePlaces) {
      if (cities.size >= cityReserve) break;
      if (addLabel(place)) cities.add(place);
    }
    const airportLimit = Math.max(8, Math.min(160, Math.floor(size.x * size.y / 2_500)));
    let airportLabels = 0;
    for (const airport of visibleAirports) {
      if (airportLabels >= airportLimit) break;
      if (addLabel(airport)) airportLabels += 1;
    }
    for (const place of visiblePlaces) {
      if (cities.size >= cityLimit) break;
      if (!cities.has(place) && addLabel(place)) cities.add(place);
    }
  }

  async function loadAirports() {
    try {
      airports = await loadLocalMapResource('/geo/airports.json', prepareAirports);
      updateLabels();
    } catch {
      airportsUnavailable = true;
      showNotice();
    }
  }

  async function loadGeography() {
    try {
      const { grouped, places } = await loadLocalMapResource('/geo/basemap.geojson', prepareGeography);
      rawPlaces = places;
      for (const group of grouped.values()) {
        L.geoJSON(group, {
          interactive: false,
          renderer: terrainRenderer,
          style: ({ properties }) => styles[properties.kind === 'road' && properties.major ? 'majorRoad' : properties.kind],
        }).addTo(geometry);
      }
      updateLabels();
      rings.eachLayer((layer) => layer.bringToFront?.());
    } catch {
      offlineError = true;
      showNotice();
    }
  }

  function updateArtccBoundary() {
    const lines = artccBoundaries?.get(selectedArtcc);
    if (!lines?.length || !area) {
      artccLayer?.remove();
      artccLayer = null;
      artccLayerKey = null;
      return;
    }
    const worlds = lines.map(({ centerLon }) => Math.round((area.lon - centerLon) / 360));
    const key = [selectedArtcc, ...worlds].join(':');
    if (key === artccLayerKey) return;
    artccLayer?.remove();
    const positions = lines.map(({ points }, index) => points.map(([lat, lon]) => [lat, lon + worlds[index] * 360]));
    artccLayer = L.polyline(positions, {
      renderer: artccRenderer, color: '#759bda', weight: 1.35, opacity: 0.85,
      dashArray: '7 6', interactive: false, attribution: preview ? artccAttribution : undefined,
    }).addTo(map);
    artccLayerKey = key;
  }

  async function loadArtccBoundaries() {
    artccLoading = true;
    artccLoadFailed = false;
    try {
      artccBoundaries = await loadLocalMapResource('/geo/artcc.geojson', prepareArtccBoundaries);
      updateArtccBoundary();
    } catch {
      artccLoadFailed = true;
    } finally {
      artccLoading = false;
      showNotice();
    }
  }

  function setArtcc(id) {
    if (id === selectedArtcc) return;
    selectedArtcc = id;
    if (id && !artccBoundaries && !artccLoading) loadArtccBoundaries();
    updateArtccBoundary();
    showNotice();
  }

  function measureViewport() {
    const bounds = map.getBounds();
    const center = map.getCenter();
    const corners = [bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthWest(), bounds.getSouthEast()];
    return {
      radiusNm: Math.max(...corners.map(({ lat, lng }) => distanceNm(center.lat, center.lng, lat, lng))),
      contains(lat, lon) {
        return Number.isFinite(lat) && Number.isFinite(lon) && bounds.contains([lat, nearLongitude(lon, center.lng)]);
      },
    };
  }

  function rangeRingColor() {
    return basemap === 'radar' ? '#666b66' : '#c5cfc4';
  }

  function fitArea() {
    if (!area || !container.clientWidth || !container.clientHeight) return;
    map.invalidateSize({ pan: false });
    const { lat, lon, radius } = area;
    const center = map.project([lat, lon], 0);
    const outer = Array.from({ length: 73 }, (_, index) => destination(lat, lon, index * 5, radius));
    const envelope = L.bounds(outer.map((point) => map.project(point, 0)));
    const maxX = Math.max(center.x - envelope.min.x, envelope.max.x - center.x);
    const maxY = Math.max(center.y - envelope.min.y, envelope.max.y - center.y);
    const size = map.getSize();
    const scale = Math.min(size.x * 0.42 / maxX, size.y * 0.405 / maxY);
    map.setView([lat, lon], Math.min(18, Math.log2(scale)), { animate: false });
    viewport = measureViewport();
    rings.clearLayers();
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      const nm = radius * fraction;
      const ring = fraction === 1 ? outer : Array.from({ length: 73 }, (_, index) => destination(lat, lon, index * 5, nm));
      L.polyline(ring, {
        color: rangeRingColor(), opacity: fraction === 1 ? 0.66 : 0.42, weight: fraction === 1 ? 1.35 : 1,
        dashArray: fraction === 1 ? null : '4 7', interactive: false,
      }).addTo(rings);
      if (fraction === 0.5 || fraction === 1) {
        L.marker(destination(lat, lon, 94, nm), {
          icon: textIcon('ring-label', nm + ' NM'), interactive: false, keyboard: false, zIndexOffset: -1000,
        }).addTo(rings);
      }
    }
    L.marker([lat, lon], {
      icon: L.divIcon({ className: 'center-mark', html: '+', iconSize: [24, 24], iconAnchor: [12, 12] }),
      interactive: false, keyboard: false, zIndexOffset: -1000,
    }).addTo(rings);
    if (previewLabel) {
      // Place the label over the outer ring so opacity is visible on the offline map.
      const ringPoint = map.latLngToContainerPoint(destination(lat, lon, 300, radius));
      const { width, height, horizontalOffset, verticalOffset } = dataBlock;
      const x = Math.max(16, ringPoint.x - horizontalOffset - width / 2);
      const y = Math.max(16, ringPoint.y - verticalOffset - height / 2);
      previewLabel.setLatLng(map.containerPointToLatLng([x, y]));
      if (!map.hasLayer(previewLabel)) previewLabel.addTo(map);
    }
    updateLabels();
    renderAircraft();
  }

  function setArea({ lat, lon, radius }) {
    if (!area || area.lat !== lat || area.lon !== lon || area.radius !== radius) viewport = null;
    area = { lat, lon, radius };
    fitArea();
    updateArtccBoundary();
    updateLayerOptions(basemap, wantsWeather, weatherMinDbz);
  }

  function getViewport() {
    if (!viewport && area) fitArea();
    return viewport;
  }

  function recordHistory(flights, source, observedAt, canRecord) {
    if (!source) return;
    if (historySource !== source) {
      positionHistories.clear();
      latestHistoryObservation = 0;
      historySource = source;
    }
    if (!canRecord || !Number.isFinite(observedAt)) return;
    latestHistoryObservation = Math.max(latestHistoryObservation, observedAt);
    const cutoff = latestHistoryObservation - HISTORY_IDLE_MS;
    for (const [id, { recent }] of positionHistories) {
      const latest = recent.at(-1);
      if ((latest.at ?? latest.observedAt) < cutoff) positionHistories.delete(id);
    }
    for (const flight of flights) {
      const { id, lat, lon } = flight;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const fix = { lat, lon, at: positionTimestamp(flight, observedAt), observedAt };
      if ((fix.at ?? fix.observedAt) < cutoff) continue;
      const track = positionHistories.get(id) ?? { positions: new Map(), recent: [] };
      const previous = track.recent.at(-1);
      if (previous && !earlierPosition(previous, fix)) continue;

      const key = lat + '/' + nearLongitude(lon, 0);
      track.positions.delete(key);
      track.positions.set(key, fix);
      // Keep the normal scope render independent of the length of each stored track.
      track.recent = track.recent.filter((point) => !samePosition(point, fix));
      track.recent.push(fix);
      if (track.recent.length > historyDotOpacity.length + 1) track.recent.shift();
      positionHistories.set(id, track);
    }
  }

  function updateHistoryDots(entry, flight, selected, observedAt, color, fullTrail) {
    const report = { at: positionTimestamp(flight, observedAt), observedAt };
    const track = Number.isFinite(observedAt) && viewport?.contains(flight.lat, flight.lon)
      ? positionHistories.get(flight.id) : null;
    const history = !track ? [] : fullTrail ? track.positions.values() : track.recent;
    const locations = [];
    for (const fix of history) {
      if (earlierPosition(fix, report) && !samePosition(fix, flight)) {
        locations.push([fix.lat, nearLongitude(fix.lon, area.lon)]);
      }
    }
    if (!fullTrail && locations.length > historyDotOpacity.length) locations.shift();
    const key = JSON.stringify([color, selected, locations]);
    if (key === entry.historyKey) return;
    entry.historyKey = key;
    while (entry.dots.length > locations.length) entry.dots.pop().remove();
    const radius = selected ? 2.25 : 1.8;
    for (const [index, location] of locations.entries()) {
      const ageIndex = Math.min(historyDotOpacity.length - 1, locations.length - 1 - index);
      const fillOpacity = historyDotOpacity[ageIndex];
      const existing = entry.dots[index];
      const style = { fillColor: color, fillOpacity, radius };
      if (existing) {
        const { lat, lng } = existing.getLatLng();
        if (lat !== location[0] || lng !== location[1]) existing.setLatLng(location);
        const previous = existing.options;
        if (previous.fillColor !== color || previous.fillOpacity !== fillOpacity || previous.radius !== radius) {
          existing.setStyle(style);
        }
      } else {
        entry.dots.push(L.circleMarker(location, {
          ...style, stroke: false, renderer: historyRenderer, interactive: false,
        }).addTo(map));
      }
    }
  }

  function readoutChoices({ point, vectorDelta }, previousSlot) {
    if (previousSlot) {
      const { left, up } = previousSlot;
      return [[left, up], [left, !up], [!left, up], [!left, !up]]
        .map(([horizontal, vertical]) => readoutPosition(point, horizontal, vertical));
    }
    const direction = vectorDelta ?? L.point(0, 0);
    const left = direction.x > 0;
    const up = direction.y > 0;
    const quadrants = Math.abs(direction.x) > Math.abs(direction.y)
      ? [[left, up], [left, !up], [!left, up], [!left, !up]]
      : [[left, up], [!left, up], [left, !up], [!left, !up]];
    return quadrants.map(([horizontal, vertical]) => readoutPosition(point, horizontal, vertical));
  }

  function selectedReadout(plot, incumbents, bounds, inset) {
    const previous = markers.get(plot.flight.id);
    const choices = readoutChoices(plot, previous?.readoutSlot);
    if (previous?.readoutVisible && bounds.contains(choices[0].bounds)) return choices[0];

    let best;
    let bestScore = Infinity;
    for (const choice of choices) {
      if (!bounds.contains(choice.bounds)) continue;
      const padded = withReadoutGap(choice.bounds, 1);
      const conflicts = incumbents.filter(({ placement }) => bounds.contains(placement.bounds) && padded.overlaps(placement.bounds));
      const score = 4 * conflicts.length + 2 * Number(!readoutClearsVector(plot, choice))
        + Number(!inset.contains(choice.bounds));
      if (score < bestScore) {
        best = choice;
        bestScore = score;
      }
      if (!score) break;
    }
    const center = bounds.getCenter();
    return best ?? readoutPosition(plot.point, plot.point.x > center.x, plot.point.y > center.y);
  }

  function placeReadouts(plots, dataBlocks) {
    const size = map.getSize();
    const bounds = L.bounds([0, 0], size);
    const padding = [dataBlock.padding, dataBlock.padding];
    const inset = L.bounds(L.point(padding), size.subtract(padding));
    const labeled = new Map();
    const limit = Math.min(32, Math.max(8, Math.floor(size.x * size.y / 30_000)));
    const eligible = new Map(plots.filter((plot) => dataBlocks && !plot.selected && bounds.contains(plot.point))
      .map((plot) => [plot.flight.id, plot]));
    const incumbents = [];
    // Marker insertion order stays stable when the feed or distance order changes.
    for (const [id, entry] of markers) {
      const plot = eligible.get(id);
      if (!plot || !entry.readoutVisible) continue;
      const { left, up } = entry.readoutSlot;
      incumbents.push({ plot, placement: readoutPosition(plot.point, left, up) });
    }
    const selected = plots.find((plot) => plot.selected);
    if (selected) labeled.set(selected.flight.id, selectedReadout(selected, incumbents, bounds, inset));

    const pending = new Map();
    // Keep viable slots before trying alternatives for any displaced or new label.
    for (const { plot, placement } of incumbents) {
      if (labeled.size >= limit) break;
      const id = plot.flight.id;
      if (bounds.contains(placement.bounds) && !readoutOverlaps(placement.bounds, labeled.values(), 1)) {
        labeled.set(id, placement);
      } else {
        pending.set(id, plot);
      }
    }

    // Reserve existing labels before correcting any narrow angles. Keep a
    // smaller angle unless a clear alternative can fit without moving others.
    for (const [id, current] of labeled) {
      const plot = selected?.flight.id === id ? selected : eligible.get(id);
      if (readoutClearsVector(plot, current, retainedLeaderCosine)) continue;
      const occupied = [...labeled].filter(([otherId]) => otherId !== id).map(([, placement]) => placement);
      const better = readoutChoices(plot, current).find((choice) => bounds.contains(choice.bounds)
        && readoutClearsVector(plot, choice) && !readoutOverlaps(choice.bounds, occupied, 1));
      if (better) labeled.set(id, better);
    }
    for (const [id, plot] of eligible) {
      if (!labeled.has(id)) pending.set(id, plot);
    }
    for (const [id, plot] of pending) {
      if (labeled.size >= limit) break;
      const choices = readoutChoices(plot, markers.get(id)?.readoutSlot)
        .filter((choice) => inset.contains(choice.bounds) && !readoutOverlaps(choice.bounds, labeled.values(), dataBlock.padding));
      const placement = choices.find((choice) => readoutClearsVector(plot, choice)) ?? choices[0];
      if (placement) labeled.set(id, placement);
    }
    return labeled;
  }

  function vectorSegments({ path, vectorTip, vectorDelta, vectorPixels, selected }) {
    if (vectorPixels < 3) return path;

    const depth = Math.min(selected ? 8 : 7, vectorPixels * 0.48);
    const along = vectorDelta.multiplyBy(depth / vectorPixels);
    const across = L.point(-along.y, along.x).multiplyBy(0.55);
    const base = vectorTip.subtract(along);
    return [path, [map.unproject(base.add(across)), path[1], map.unproject(base.subtract(across))]];
  }

  function updateVector(entry, plot) {
    const { path, selected, color } = plot;
    if (!path) {
      entry.vector?.remove();
      entry.vector = null;
      return;
    }
    const style = { color, weight: selected ? 2 : 1.35, opacity: selected ? 0.95 : 0.67 };
    const segments = vectorSegments(plot);
    if (entry.vector) {
      entry.vector.setLatLngs(segments).setStyle(style);
    } else {
      entry.vector = L.polyline(segments, { ...style, smoothFactor: 0, renderer: trackRenderer, interactive: false }).addTo(map);
    }
  }

  function renderAircraft() {
    if (!area || !traffic || !container.clientWidth || !container.clientHeight) return;
    const { flights, selectedId, options } = traffic;
    const plots = flights.map((flight) => {
      const location = [flight.lat, nearLongitude(flight.lon, area.lon)];
      const path = options.vectors && options.canProject ? projectedTrack(flight, location, options.snapshotAgeSeconds) : null;
      const selected = flight.id === selectedId;
      const color = selected ? selectedColor : aircraftModeColor(flight, options.colorMode, options.colors);
      const vectorTip = path ? map.project(path[1]) : null;
      const vectorDelta = vectorTip ? vectorTip.subtract(map.project(location)) : null;
      const vectorPixels = vectorDelta ? Math.hypot(vectorDelta.x, vectorDelta.y) : 0;
      return {
        flight, location, path, selected, color, vectorTip, vectorDelta, vectorPixels,
        point: map.latLngToContainerPoint(location),
      };
    });
    const placements = placeReadouts(plots, options.dataBlocks);
    const ids = new Set();
    for (const plot of plots) {
      const { flight, location, selected, color } = plot;
      ids.add(flight.id);
      const placement = placements.get(flight.id);
      const readout = placement ? flightReadout(flight) : null;
      const iconKey = JSON.stringify([selected, placement?.left, placement?.up, readout, flight.onGround, flight.emergency, color]);
      let entry = markers.get(flight.id);
      if (!entry) {
        const marker = L.marker(location, {
          icon: flightIcon(flight, selected, placement, readout, color),
          riseOnHover: true,
          autoPanOnFocus: false,
          alt: aircraftLabel(flight),
          bubblingMouseEvents: false,
        }).addTo(map);
        marker.on('click', () => onSelect(flight.id));
        marker.on('keydown', ({ originalEvent }) => {
          if (originalEvent.key !== 'Enter' && originalEvent.key !== ' ') return;
          originalEvent.preventDefault();
          if (!originalEvent.repeat) onSelect(flight.id);
        });
        entry = { marker, iconKey, vector: null, dots: [], historyKey: null, readoutSlot: null, readoutVisible: false };
        markers.set(flight.id, entry);
      } else {
        entry.marker.setLatLng(location);
        if (entry.iconKey !== iconKey) {
          entry.marker.setIcon(flightIcon(flight, selected, placement, readout, color));
          entry.iconKey = iconKey;
        }
      }
      if (placement) entry.readoutSlot = { left: placement.left, up: placement.up };
      entry.readoutVisible = Boolean(placement);
      const element = entry.marker.getElement();
      element?.setAttribute('aria-label', 'Select ' + aircraftLabel(flight) + (flight.emergency ? ', reported emergency' : ''));
      element?.setAttribute('aria-pressed', String(selected));
      entry.marker.setZIndexOffset(selected ? 1000 : 0);
      updateHistoryDots(entry, flight, selected, options.historyObservedAt, color, flight.id === options.fullTrailId);
      updateVector(entry, plot);
    }
    for (const [id, { marker, vector, dots }] of markers) {
      if (ids.has(id)) continue;
      marker.remove();
      vector?.remove();
      for (const dot of dots) dot.remove();
      markers.delete(id);
    }
  }

  function updateAircraft(flights, selectedId, {
    vectors = false, dataBlocks = true, canProject = true, snapshotAgeSeconds = 0,
    historySource: source = null, historyObservedAt = null, canRecordHistory = false, historyFlights = flights,
    colorMode = 'altitude', colors = defaultAircraftColors, fullTrailId = null,
  } = {}) {
    recordHistory(historyFlights, source, historyObservedAt, canRecordHistory);
    traffic = { flights, selectedId, options: { vectors, dataBlocks, canProject, snapshotAgeSeconds, historyObservedAt, colorMode, colors, fullTrailId } };
    renderAircraft();
  }

  new ResizeObserver(fitArea).observe(container);
  loadGeography();
  loadAirports();
  return { setArea, setArtcc, fitArea, getViewport, updateAircraft, updateLayerOptions, updateWeather };
}
