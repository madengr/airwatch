import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ellipsoidToMslFeet } from './geoid.mjs';
import { terrainElevationFeet } from './terrain.mjs';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = integerSetting('PORT', 8080, 1, 65535);
const receiver = getReceiverUrl(process.env.FLIGHT_TRACK_LIVE_URL);
const adsbLolKey = process.env.ADSB_LOL_API_KEY?.trim();
const flyItalyKey = process.env.FLYITALYADSB_API_KEY?.trim();
const adsbLolInterval = integerSetting('FLIGHT_TRACK_REMOTE_INTERVAL_SECONDS', 180, adsbLolKey ? 15 : 180, 3600);
const defaultProvider = receiver ? 'receiver' : 'adsb.lol';
const maxCacheEntries = 32;
const timeoutMs = 8000;
const maxResponseBytes = 12 * 1024 * 1024;
const defaultArea = { lat: 39.0997, lon: -94.5786, radius: 40 };
const earthRadiusNm = 3440.065;
const toRadians = Math.PI / 180;
const startedAt = performance.now();

// Allow a small burst for manual changes while limiting the sustained rate per public provider.
const requestBurst = 6;
const providers = new Map([
  createProvider('adsb.lol', 'adsb.lol', adsbLolInterval, {
    origin: 'https://api.adsb.lol',
    apiKey: adsbLolKey,
    areaPath: ({ lat, lon, coverage }) => `/v2/point/${lat}/${lon}/${Math.ceil(coverage)}`,
  }),
  createProvider('adsb.fi', 'adsb.fi', 15, {
    origin: 'https://opendata.adsb.fi',
    areaPath: ({ lat, lon, coverage }) => `/api/v3/lat/${lat}/lon/${lon}/dist/${Math.ceil(coverage)}`,
    lookupPrefix: '/api/v2',
    registrationPath: 'registration',
    minimumGapMs: 1100,
  }),
  createProvider('flyitalyadsb', 'FlyItalyADSB', 10, {
    origin: 'https://api.flyitalyadsb.com',
    apiKey: flyItalyKey,
    areaPath: ({ lat, lon, coverage }) => `/v2/lat/${lat}/lon/${lon}/dist/${Math.ceil(coverage * 1.852)}`,
    hexPath: 'icao',
    secondsTimestamp: true,
    singleAircraftResponse: true,
    reason: flyItalyKey ? undefined : 'Set FLYITALYADSB_API_KEY on the kiosk server to use this feed.',
  }),
  createProvider('receiver', 'Local ADS-B receiver', 5, {
    url: receiver,
    secondsTimestamp: true,
    reason: receiver ? undefined : 'Set FLIGHT_TRACK_LIVE_URL on the kiosk server to use a local receiver.',
  }),
].map(provider => [provider.id, provider]));

const emergencyCodes = new Set(['general', 'lifeguard', 'minfuel', 'nordo', 'unlawful', 'downed']);
const positionSources = new Set([
  'adsb_icao', 'adsb_icao_nt', 'adsb_other', 'adsr_icao', 'adsr_other',
  'tisb_icao', 'tisb_other', 'tisb_trackfile', 'adsc', 'mlat', 'mode_s', 'other',
]);
const aircraftLookup = new Map([
  ['callsign', { field: 'callsign', format: /^[A-Z0-9]{1,8}$/, description: 'up to eight letters or digits' }],
  ['hex', { field: 'id', format: /^~?[A-F0-9]{6}$/, description: 'six hexadecimal digits, optionally preceded by ~' }],
  ['reg', { field: 'registration', format: /^[A-Z0-9][A-Z0-9-]{0,15}$/, description: 'up to sixteen letters, digits, or hyphens' }],
]);
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'], ['.geojson', 'application/geo+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.ico', 'image/x-icon'], ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'], ['.txt', 'text/plain; charset=utf-8'],
]);

const demoFlights = [
  { callsign: 'DEMO302', type: 'B738', bearing: 320, offset: 0.15, heading: 57, speed: 340, altitude: 12400, rate: -640, squawk: '0453' },
  { callsign: 'DEMO517', type: 'A321', bearing: 49, offset: 0.42, heading: 226, speed: 443, altitude: 33200, rate: 0, squawk: '2346' },
  { callsign: 'DEMO284', type: 'E75L', bearing: 130, offset: 0.33, heading: 292, speed: 278, altitude: 8200, rate: 720, squawk: '4561' },
  { callsign: 'DEMO661', type: 'A20N', bearing: 228, offset: 0.73, heading: 38, speed: 423, altitude: 29600, rate: 0, squawk: '1042' },
  { callsign: 'DEMO872', type: 'B39M', bearing: 282, offset: 0.58, heading: 110, speed: 451, altitude: 35400, rate: 0, squawk: '3160' },
  { callsign: 'DEMO934', type: 'C172', bearing: 96, offset: 0.22, heading: 149, speed: 112, altitude: 3600, rate: 0, squawk: '1200' },
  { callsign: 'DEMO406', type: 'CRJ9', bearing: 14, offset: 0.78, heading: 168, speed: 372, altitude: 17700, rate: -480, squawk: '0246' },
  { callsign: 'DEMO125', type: 'B763', bearing: 197, offset: 0.46, heading: 346, speed: 397, altitude: 24800, rate: 0, squawk: '3412' },
  { callsign: 'DEMO773', type: 'C560', bearing: 252, offset: 0.31, heading: 81, speed: 285, altitude: 9400, rate: 600, squawk: '4461' },
  { callsign: 'DEMO546', type: 'DH8D', bearing: 163, offset: 0.73, heading: 18, speed: 243, altitude: 19000, rate: -320, squawk: '2143' },
  { callsign: 'DEMO219', type: 'B737', bearing: 331, offset: 0.36, heading: 175, speed: 0, altitude: 0, rate: 0, squawk: '4531' },
];

const outerDemoFlights = [
  { callsign: 'DEMO641', type: 'B739', bearing: 5, offset: 0.49, heading: 81, speed: 431, altitude: 32100, rate: 0, squawk: '3642' },
  { callsign: 'DEMO353', type: 'A319', bearing: 89, offset: 0.63, heading: 182, speed: 394, altitude: 26800, rate: -320, squawk: '2163' },
  { callsign: 'DEMO710', type: 'E190', bearing: 177, offset: 0.45, heading: 272, speed: 355, altitude: 21600, rate: 480, squawk: '4273' },
  { callsign: 'DEMO835', type: 'B752', bearing: 266, offset: 0.76, heading: 352, speed: 448, altitude: 33800, rate: 0, squawk: '3156' },
  { callsign: 'DEMO459', type: 'C208', bearing: 229, offset: 0.55, heading: 315, speed: 152, altitude: 5400, rate: 0, squawk: '1200' },
];

function integerSetting(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function getReceiverUrl(value) {
  if (!value) return null;
  if (URL.canParse(value)) {
    const url = new URL(value);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash) return url;
  }
  throw new Error('FLIGHT_TRACK_LIVE_URL must be an HTTP(S) aircraft.json URL without credentials or a fragment.');
}

function createProvider(id, label, intervalSeconds, config) {
  return {
    id, label, intervalSeconds, intervalMs: intervalSeconds * 1000,
    lookupPrefix: '/v2', registrationPath: 'reg', hexPath: 'hex', minimumGapMs: 0,
    cache: new Map(), tokens: requestBurst, lastRefillAt: performance.now(), nextRequestAt: 0,
    backoffUntil: 0, backoffMessage: null, waitingForGap: false,
    ...config,
  };
}

function describeProviders() {
  return {
    defaultProvider,
    providers: [...providers.values()].map(({ id, label, intervalSeconds, reason }) => ({
      id, label, available: !reason, intervalSeconds, ...(reason ? { reason } : {}),
    })),
  };
}

function readTrafficQuery(params) {
  const source = params.get('source') ?? 'demo';
  if (source !== 'demo' && source !== 'live') throw new Error('source must be demo or live.');

  const numberParam = (name, min, max, fallback = defaultArea[name]) => {
    const raw = params.get(name);
    if (raw === null) return fallback;
    const value = raw.trim() ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${name} must be between ${min} and ${max}.`);
    }
    return value;
  };

  const lat = numberParam('lat', -90, 90);
  const lon = numberParam('lon', -180, 180);
  const radius = numberParam('radius', 1, 250);
  const coverage = numberParam('coverage', radius, 250, radius);
  return { source, lat, lon, radius, coverage };
}

function readAircraftQuery(params) {
  const kind = params.get('kind');
  const lookup = aircraftLookup.get(kind);
  if (!lookup) throw new Error('kind must be callsign, hex, or reg.');

  const value = params.get('value')?.trim().toUpperCase() ?? '';
  if (!lookup.format.test(value)) throw new Error(`The aircraft ${kind} must contain ${lookup.description}.`);
  return { kind, value, field: lookup.field };
}

function destination(origin, bearing, distance) {
  const lat = origin.lat * toRadians;
  const lon = origin.lon * toRadians;
  const angle = bearing * toRadians;
  const arc = distance / earthRadiusNm;
  const nextLat = Math.asin(Math.sin(lat) * Math.cos(arc) + Math.cos(lat) * Math.sin(arc) * Math.cos(angle));
  const nextLon = lon + Math.atan2(Math.sin(angle) * Math.sin(arc) * Math.cos(lat), Math.cos(arc) - Math.sin(lat) * Math.sin(nextLat));
  return { lat: nextLat / toRadians, lon: (nextLon / toRadians + 540) % 360 - 180 };
}

function distanceNm(start, end) {
  const deltaLat = (end.lat - start.lat) * toRadians;
  const deltaLon = (end.lon - start.lon) * toRadians;
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(start.lat * toRadians) * Math.cos(end.lat * toRadians) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadiusNm * Math.asin(Math.sqrt(Math.min(1, a)));
}

function initialBearing(start, end) {
  const startLat = start.lat * toRadians;
  const endLat = end.lat * toRadians;
  const deltaLon = (end.lon - start.lon) * toRadians;
  const east = Math.sin(deltaLon) * Math.cos(endLat);
  const north = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLon);
  return (Math.atan2(east, north) / toRadians + 360) % 360;
}

function simulateTraffic(area) {
  const hours = (performance.now() - startedAt) / 3_600_000;
  const outerSpan = Math.min(area.coverage - area.radius, area.radius * 0.26);
  const flights = outerSpan > 0 ? [...demoFlights, ...outerDemoFlights] : demoFlights;
  const aircraft = flights.map((flight, index) => {
    const outside = index >= demoFlights.length;
    const pathLength = outside ? outerSpan * 0.35 : area.radius * (1 - flight.offset);
    const legProgress = (flight.speed * hours + pathLength / 2) % pathLength - pathLength / 2;
    const originDistance = outside ? area.radius + outerSpan * flight.offset : area.radius * flight.offset;
    const origin = destination(area, flight.bearing, originDistance);
    const position = destination(origin, flight.heading, legProgress);
    const trackDeg = flight.speed ? initialBearing(position, destination(origin, flight.heading, legProgress + 1)) : null;
    const altitudeFt = Math.max(1000, Math.round((flight.altitude + flight.rate * legProgress / Math.max(1, flight.speed) * 60) / 100) * 100);
    return {
      id: `sim-${index + 1}`,
      callsign: flight.callsign,
      ...position,
      altitudeFt: flight.speed ? altitudeFt : 0,
      altitudeMslFt: flight.speed ? altitudeFt : null,
      speedKt: flight.speed,
      heading: flight.heading,
      trackDeg,
      positionAgeSeconds: 0,
      verticalRateFpm: flight.rate,
      type: flight.type,
      registration: `SIM-${String(index + 1).padStart(2, '0')}`,
      onGround: flight.speed === 0,
      emergency: null,
      operator: null,
      squawk: flight.squawk,
      positionSource: 'simulator',
    };
  }).filter((flight, index) => {
    if (index < demoFlights.length) return true;
    const distance = distanceNm(area, flight);
    return distance > area.radius && distance <= area.coverage;
  });
  return { source: 'demo', provider: 'simulator', status: 'ok', observedAt: new Date().toISOString(), aircraft };
}

function normalizeAircraft(raw, seenIds) {
  const id = typeof raw?.hex === 'string' ? raw.hex.trim().toLowerCase() : '';
  if (!/^~?[\da-f]{6}$/.test(id) || seenIds.has(id) || raw.seen_pos > 60 ||
      !Number.isFinite(raw.lat) || Math.abs(raw.lat) > 90 ||
      !Number.isFinite(raw.lon) || Math.abs(raw.lon) > 180) return null;

  const number = (...values) => values.find(Number.isFinite) ?? null;
  const label = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) || null : null;
  const onGround = raw.ground === true || raw.alt_baro === 'ground' || raw.altitude === 'ground';
  const altitudeMslFt = onGround ? null : ellipsoidToMslFeet(raw.alt_geom, raw.lat, raw.lon);
  const registration = label(raw.r, 16);
  const heading = number(raw.track, raw.true_heading, raw.calc_track);
  // ADS-B feeds can report true heading in the track field while the aircraft is on the ground.
  const trackDeg = !onGround && Number.isFinite(raw.track) && raw.track >= 0 && raw.track < 360 ? raw.track : null;
  const positionAgeSeconds = Number.isFinite(raw.seen_pos) && raw.seen_pos >= 0 ? raw.seen_pos : null;
  const emergency = label(raw.emergency, 16)?.toLowerCase();
  seenIds.add(id);

  return {
    id,
    callsign: label(raw.flight, 16) ?? registration ?? id.toUpperCase(),
    lat: raw.lat,
    lon: raw.lon,
    altitudeFt: onGround ? 0 : number(raw.alt_baro, raw.altitude, altitudeMslFt),
    altitudeMslFt,
    speedKt: number(raw.gs, raw.speed),
    heading: heading === null ? null : (heading % 360 + 360) % 360,
    trackDeg,
    positionAgeSeconds,
    verticalRateFpm: number(raw.baro_rate, raw.geom_rate, raw.vert_rate),
    type: label(raw.t, 12),
    registration,
    onGround,
    emergency: emergencyCodes.has(emergency) ? emergency : null,
    operator: label(raw.operator, 80),
    squawk: typeof raw.squawk === 'string' && /^[0-7]{4}$/.test(raw.squawk) ? raw.squawk : null,
    positionSource: positionSources.has(raw.type) ? raw.type : null,
  };
}

function reserveRemoteRequest(provider) {
  const now = performance.now();
  if (now < provider.nextRequestAt) return false;
  provider.tokens = Math.min(requestBurst, provider.tokens + (now - provider.lastRefillAt) / provider.intervalMs);
  provider.lastRefillAt = now;
  if (provider.tokens < 1) return false;
  provider.tokens -= 1;
  provider.nextRequestAt = now + provider.minimumGapMs;
  return true;
}

function retryDelay(header, minimum) {
  if (!header) return minimum;
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(delay) ? Math.max(minimum, delay) : minimum;
}

async function readUpstreamJson(response) {
  if (!response.body || Number(response.headers.get('content-length')) > maxResponseBytes) {
    await response.body?.cancel();
    throw new Error('The response is missing or too large.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > maxResponseBytes) throw new Error('The response is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
}

function backOff(provider, entry, delay, message) {
  entry.retryAt = performance.now() + delay;
  entry.message = message;
  if (entry.retryAt > provider.backoffUntil) {
    provider.backoffUntil = entry.retryAt;
    provider.backoffMessage = message;
  }
}

async function handleUpstreamError(provider, entry, response, singleAircraft) {
  if (singleAircraft && response.status === 404) {
    const data = await readUpstreamJson(response);
    if (data?.error !== 'not found') throw new Error('Unrecognized aircraft lookup response.');
    entry.snapshot = { observedAt: Date.now(), aircraft: [] };
    entry.message = null;
    return;
  }

  const retryAfter = response.headers.get('retry-after');
  if (response.status === 429) {
    let delay = retryDelay(retryAfter, provider.intervalMs);
    if (provider.id === 'flyitalyadsb' && !retryAfter) {
      const data = await readUpstreamJson(response).catch(() => null);
      const resetValue = data?.resets;
      const epoch = Number(resetValue);
      const resetAt = Number.isFinite(epoch) ? epoch * (epoch < 1e12 ? 1000 : 1) : Date.parse(resetValue);
      delay = Math.max(delay, 60_000, Number.isFinite(resetAt) ? resetAt - Date.now() : 0);
    } else {
      await response.body?.cancel();
    }
    backOff(provider, entry, delay, 'The flight feed reached its request limit. It will retry automatically.');
    return;
  }

  await response.body?.cancel();
  if (response.status === 401 || response.status === 403) {
    const message = response.status === 401 && provider.apiKey
      ? 'The flight feed rejected the configured API key.'
      : 'The flight feed denied access. It will retry automatically.';
    backOff(provider, entry, retryDelay(retryAfter, Math.max(provider.intervalMs, 60_000)), message);
    return;
  }
  if (response.status >= 400 && response.status < 500) {
    entry.retryAt = performance.now() + Math.max(provider.intervalMs, 60_000);
    entry.message = 'The flight feed rejected this request.';
    return;
  }
  throw new Error(`HTTP ${response.status}`);
}

async function refreshSnapshot(provider, entry, url, singleAircraft) {
  entry.retryAt = performance.now() + provider.intervalMs;
  try {
    const headers = { accept: 'application/json', 'user-agent': 'Airwatch/1.0' };
    if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      await handleUpstreamError(provider, entry, response, singleAircraft);
      return;
    }

    const data = await readUpstreamJson(response);
    const records = singleAircraft ? (typeof data?.hex === 'string' ? [data] : null)
      : provider.url ? data?.aircraft : data?.ac;
    if (!Array.isArray(records) || (!singleAircraft && !Number.isFinite(data.now))) {
      throw new Error('Unrecognized aircraft feed.');
    }
    // FlyItalyADSB's single-record response has no envelope timestamp.
    const observedAt = singleAircraft ? Date.now() : data.now * (provider.secondsTimestamp ? 1000 : 1);
    const age = Date.now() - observedAt;
    if (!Number.isFinite(new Date(observedAt).getTime()) || age < -60_000) {
      throw new Error('Invalid aircraft timestamp.');
    }

    const seenIds = new Set();
    const aircraft = records.map(record => normalizeAircraft(record, seenIds)).filter(Boolean);
    if (!entry.snapshot || observedAt >= entry.snapshot.observedAt) entry.snapshot = { observedAt, aircraft };
    entry.message = age > (provider.url ? 30_000 : 60_000) ? 'The flight feed is returning an older snapshot.' : null;
  } catch {
    entry.message = 'The flight feed could not be reached. It will retry automatically.';
  }
}

function unavailableSnapshot(provider, message) {
  return { source: 'live', provider: provider.id, status: 'unavailable', observedAt: null, aircraft: [], message };
}

async function refreshWhenAllowed(provider, entry, url, singleAircraft) {
  if (provider.waitingForGap) {
    entry.message = 'Waiting for the flight feed’s next available refresh.';
    return;
  }

  // Reserve one waiting request so a quick lookup can follow an area poll without a burst.
  const gap = provider.nextRequestAt - performance.now();
  if (gap > 0 && provider.nextRequestAt >= provider.backoffUntil) {
    provider.waitingForGap = true;
    await new Promise(resolve => setTimeout(resolve, Math.ceil(gap) + 1));
    provider.waitingForGap = false;
  }

  if (performance.now() < provider.backoffUntil) {
    entry.message = provider.backoffMessage;
  } else if (provider.url || reserveRemoteRequest(provider)) {
    await refreshSnapshot(provider, entry, url, singleAircraft);
  } else {
    entry.message = 'Waiting for the flight feed’s next available refresh.';
  }
}

async function getLiveSnapshot(provider, path, matches, singleAircraft = false) {
  if (provider.reason) return unavailableSnapshot(provider, provider.reason);

  const { cache, intervalMs } = provider;
  const key = provider.url ? 'receiver' : path;
  const url = provider.url ?? new URL(path, provider.origin);
  const entry = cache.get(key) ?? { snapshot: null, retryAt: 0, pending: null, message: null };
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);

  if (!entry.pending && performance.now() >= entry.retryAt) {
    entry.pending = refreshWhenAllowed(provider, entry, url, singleAircraft).finally(() => { entry.pending = null; });
  }
  await entry.pending;

  const snapshot = entry.snapshot;
  const age = snapshot ? Date.now() - snapshot.observedAt : Infinity;
  if (age > Math.max(15 * 60_000, intervalMs + 60_000)) {
    return unavailableSnapshot(provider, entry.message ?? 'The flight feed has no recent snapshot.');
  }

  const message = entry.message ?? (age > intervalMs + 60_000 ? 'The flight feed is returning an older snapshot.' : null);
  return {
    source: 'live',
    provider: provider.id,
    status: message ? 'stale' : 'ok',
    observedAt: new Date(snapshot.observedAt).toISOString(),
    aircraft: snapshot.aircraft.filter(matches),
    ...(message ? { message } : {}),
  };
}

function findAircraft(provider, { kind, value, field }) {
  const { singleAircraftResponse, lookupPrefix, registrationPath, hexPath } = provider;
  if (!provider.reason && singleAircraftResponse && kind === 'hex' && value.startsWith('~')) {
    return unavailableSnapshot(provider, 'FlyItalyADSB requires a six-digit ICAO address for aircraft ID lookup.');
  }

  const lookupPath = { callsign: 'callsign', reg: registrationPath, hex: hexPath }[kind];
  const path = `${lookupPrefix}/${lookupPath}/${encodeURIComponent(value)}`;
  // FlyItalyADSB can resolve documented flight-number and registration aliases.
  const matches = singleAircraftResponse && kind !== 'hex' ? () => true
    : aircraft => aircraft[field]?.toUpperCase() === value;
  return getLiveSnapshot(provider, path, matches, singleAircraftResponse);
}

function send(request, response, status, contentType, body) {
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

function sendJson(request, response, status, body) {
  send(request, response, status, mimeTypes.get('.json'), JSON.stringify(body));
}

async function handleRequest(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return sendJson(request, response, 405, { message: 'Method not allowed.' });
  }

  let url;
  let pathname;
  try {
    url = new URL(request.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendJson(request, response, 400, { message: 'Invalid URL.' });
  }

  if (pathname === '/api/providers') return sendJson(request, response, 200, describeProviders());

  if (pathname === '/api/elevation') {
    const parseCoordinate = (name, limit) => {
      const raw = url.searchParams.get(name)?.trim();
      return raw && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) && Math.abs(Number(raw)) <= limit
        ? Number(raw) : null;
    };
    const lat = parseCoordinate('lat', 90);
    const lon = parseCoordinate('lon', 180);
    if (lat === null || lon === null) {
      return sendJson(request, response, 400, { message: 'Supply lat between −90 and 90 and lon between −180 and 180.' });
    }
    const elevationFt = terrainElevationFeet(lat, lon);
    return sendJson(request, response, 200, { elevationFt, source: elevationFt === null ? null : 'noaa-etopo-2022' });
  }

  if (pathname === '/api/traffic' || pathname === '/api/aircraft') {
    if (request.headers['sec-fetch-site'] === 'cross-site') {
      return sendJson(request, response, 403, { message: 'Cross-site traffic requests are disabled.' });
    }

    const lookup = pathname === '/api/aircraft';
    let query;
    try {
      query = lookup ? readAircraftQuery(url.searchParams) : readTrafficQuery(url.searchParams);
    } catch (error) {
      return sendJson(request, response, 400, { message: error.message });
    }

    if (query.source === 'demo') return sendJson(request, response, 200, simulateTraffic(query));

    const provider = providers.get(url.searchParams.get('provider') ?? defaultProvider);
    if (!provider) return sendJson(request, response, 400, { message: 'Unknown flight data provider.' });

    const traffic = lookup ? await findAircraft(provider, query)
      : await getLiveSnapshot(provider, provider.areaPath?.(query), aircraft => distanceNm(query, aircraft) <= query.coverage);
    return sendJson(request, response, 200, traffic);
  }

  const file = resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relativePath = relative(publicDir, file);
  if (pathname.includes('\\') || pathname.includes(':') || pathname.includes('\0') ||
      relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return sendJson(request, response, 404, { message: 'Page not found.' });
  }

  try {
    const contents = await readFile(file);
    return send(request, response, 200, mimeTypes.get(extname(file).toLowerCase()) ?? 'application/octet-stream', contents);
  } catch (error) {
    if (!['ENOENT', 'EISDIR', 'ENOTDIR'].includes(error.code)) throw error;
    return sendJson(request, response, 404, { message: 'Page not found.' });
  }
}

const server = createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    console.error(error);
    if (response.headersSent) return response.destroy();
    return sendJson(request, response, 500, { message: 'The kiosk server encountered an error.' });
  });
});

server.listen(port, host, () => {
  const address = host.includes(':') ? `[${host}]` : host;
  console.log(`Flight Track is ready at http://${address}:${port}`);
});
