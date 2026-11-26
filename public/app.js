import { aircraftAltitudeBand, aircraftLabel, aircraftSpeedBand, aircraftSquawk, createRadar, distanceNm, formatAltitudeHundreds, formatHeightHundreds } from './radar.js';
import { artccCenters } from './artcc.js';
import { altitudeAglTransitionFt, defaultAircraftColors, loadAircraftColors, squawkColorBand } from './aircraft-colors.js';
import { colorCutoffError, createColorControls, parseColorCutoff } from './color-controls.js';

const $ = (selector) => document.querySelector(selector);
const ranges = [1, 2.5, 5, 10, 25, 30, 40, 50, 75, 100];
const screens = ['radar', 'traffic', 'settings'];
const weatherCutoffs = Array.from({ length: 16 }, (_, index) => index * 5);
const previewFields = new Set(['artcc', 'scopeCenter', 'station', 'lat', 'lon', 'radius']);
const mapLatitudeLimit = 85.051128;
const settingsKey = 'airwatch.settings.v1';
const altitudeBandVersion = 4;
const previousAltitudeDefaults = new Map([
  [1, [5000, 10000, 20000, 30000]],
  [2, [1200, 10000, 18000, 40000]],
  [3, [1200, 12000, 18000, 40000]],
]);
const aircraftSortKey = 'airwatch.sort.v1';
const defaultSettings = {
  station: 'Kansas City', lat: 39.0997, lon: -94.5786, radius: 40, source: 'demo',
  artcc: null, scopeCenter: 'custom',
  liveProvider: null, ground: 'show', airborne: 'show', basemap: 'radar', weather: false, newChime: false, emergencyChime: false,
  aircraftColorMode: 'altitude',
  aircraftColors: defaultAircraftColors,
  vectors: true, dataBlocks: true, labelOutlineOpacity: 70, labelBackgroundOpacity: 90, weatherMinDbz: null,
};
const scopeCoordinateErrors = {
  lat: 'Enter a scope latitude between −85.051128° and 85.051128°.',
  lon: 'Enter a scope longitude between −180° and 180°.',
};
const providerCredits = new Map([
  ['adsb.lol', '<a href="https://www.adsb.lol/docs/privacy-license/" target="_blank" rel="noopener noreferrer">adsb.lol source information</a>'],
  ['adsb.fi', '<a href="https://adsb.fi/" target="_blank" rel="noopener noreferrer">adsb.fi source information</a>'],
  ['flyitalyadsb', '<a href="https://flyitalyadsb.com/" target="_blank" rel="noopener noreferrer">FlyItalyADSB</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-SA 4.0</a>'],
  ['receiver', ''],
]);
const utcTime = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
});
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const altitudeLegendNumber = new Intl.NumberFormat('en-US', {
  minimumIntegerDigits: 3, maximumFractionDigits: 2, useGrouping: false,
});
const identOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const firstSeenTimes = new Map();
const firstSeenLimit = 5_000;
const aircraftSortColumns = {
  time: { label: 'Time UTC', value: (flight) => firstSeenTimes.get(flight.id) },
  ident: { label: 'Ident', value: aircraftLabel },
  altitude: { label: 'Altitude MSL', value: (flight) => flight.onGround ? 0 : flight.altitudeFt },
  altitudeAgl: { label: 'Altitude AGL', value: (flight) => flight.altitudeAglFt },
  speed: { label: 'Ground Speed', value: (flight) => Number.isFinite(flight.speedKt) ? flight.speedKt : null },
  squawk: { label: 'Squawk', value: (flight) => Number.parseInt(aircraftSquawk(flight) ?? '', 8) },
  distance: { label: 'Range', value: (flight) => flight.distanceNm },
};
const defaultAircraftSort = { column: 'time', descending: true };
const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => entities[character]);
const form = $('#settings-form');
const weatherCutoffInput = form.elements.namedItem('weatherMinDbz');
const settingsPreviewMap = $('#settings-preview-map');
const colorControls = createColorControls($('#aircraft-color-settings'));
const outlineOpacityInput = form.elements.namedItem('labelOutlineOpacity');
const backgroundOpacityInput = form.elements.namedItem('labelBackgroundOpacity');
const labelOpacityInputs = [outlineOpacityInput, backgroundOpacityInput];
const artccInput = $('#artcc-preset');
const scopeCenterInput = $('#scope-center');
const presetCenterOption = scopeCenterInput.querySelector('[value="preset"]');
const scopeLatitude = form.elements.namedItem('lat');
const scopeLongitude = form.elements.namedItem('lon');
const mapStyle = $('#map-style');
const mapStyles = new Set(Array.from(mapStyle.options, (option) => option.value));
const aircraftColorMode = $('#aircraft-color-mode');
const aircraftColorModes = new Set(Array.from(aircraftColorMode.options, (option) => option.value));
const aircraftColorKeys = document.querySelectorAll('[data-color-key]');
const altitudeLegend = $('[data-color-key="altitude"]');
const sourceInput = form.elements.namedItem('trafficSource');
const rangeDialog = $('#range-dialog');
let settings = loadSettings();
let providerCatalog = null;
let providerCatalogError = false;
let providerCatalogLoading = false;
let activeScreen = 'radar';
let snapshot = null;
let selectedId = null;
let currentFlights = [];
let connectionError = false;
let checking = false;
let fetchController;
let refreshTimer;
let gesture;
let suppressClickUntil = 0;
let audio;
let observedAircraft = null;
let lastAlertObservation = null;
let firstSeenSource = null;
let { nearby: nearbySort, traffic: trafficSort } = loadAircraftSorts();
let settingsPreview;
let settingsPreviewFrame = 0;
let scopeElevation = null;
let customScopeValues = { lat: '', lon: '' };

const radar = createRadar($('#scope-map'), $('#map-notice'), selectAircraft);

function coordinate(value, min, max, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

function savedOpacity(value, fallback) {
  return Number.isInteger(value) && value >= 0 && value <= 100 ? Math.round(value / 10) * 10 : fallback;
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey)) || {};
    const artcc = artccCenters.has(saved.artcc) ? saved.artcc : null;
    const legacyLat = coordinate(saved.userLat, -mapLatitudeLimit, mapLatitudeLimit, null);
    const legacyLon = coordinate(saved.userLon, -180, 180, null);
    const hasLegacyLocation = saved.scopeCenter === undefined && legacyLat !== null && legacyLon !== null;
    const legacyOverride = hasLegacyLocation && saved.useUserCenter === true;
    // Keep the active legacy center, or the saved override if a preset is active.
    const useLegacyLocation = hasLegacyLocation && (legacyOverride || artcc !== null);
    const aircraftColors = loadAircraftColors(saved.aircraftColors);
    // Older settings stored the default cutoffs alongside custom values.
    const previousThresholds = previousAltitudeDefaults.get(saved.altitudeBandVersion ?? 1);
    if (previousThresholds?.every((threshold, index) => threshold === aircraftColors.altitude.thresholds[index])) {
      aircraftColors.altitude.thresholds = [...defaultAircraftColors.altitude.thresholds];
    }
    return {
      station: typeof saved.station === 'string' ? saved.station.trim().slice(0, 48) || defaultSettings.station : defaultSettings.station,
      lat: useLegacyLocation ? legacyLat : coordinate(saved.lat, -mapLatitudeLimit, mapLatitudeLimit, defaultSettings.lat),
      lon: useLegacyLocation ? legacyLon : coordinate(saved.lon, -180, 180, defaultSettings.lon),
      artcc,
      scopeCenter: artcc && saved.scopeCenter !== 'custom' && !legacyOverride ? 'preset' : 'custom',
      radius: ranges.includes(saved.radius) ? saved.radius : defaultSettings.radius,
      source: saved.source === 'live' ? 'live' : 'demo',
      liveProvider: providerCredits.has(saved.liveProvider) ? saved.liveProvider : null,
      ground: saved.ground === 'hide' ? 'hide' : 'show',
      airborne: saved.airborne === 'hide' ? 'hide' : 'show',
      basemap: mapStyles.has(saved.basemap) ? saved.basemap : saved.satellite === true ? 'imagery' : defaultSettings.basemap,
      aircraftColorMode: aircraftColorModes.has(saved.aircraftColorMode) ? saved.aircraftColorMode : defaultSettings.aircraftColorMode,
      aircraftColors,
      weather: saved.weather === true,
      weatherMinDbz: weatherCutoffs.includes(saved.weatherMinDbz) ? saved.weatherMinDbz : defaultSettings.weatherMinDbz,
      vectors: saved.vectors !== false,
      dataBlocks: saved.dataBlocks !== false,
      labelOutlineOpacity: savedOpacity(saved.labelOutlineOpacity, defaultSettings.labelOutlineOpacity),
      labelBackgroundOpacity: savedOpacity(saved.labelBackgroundOpacity, defaultSettings.labelBackgroundOpacity),
      newChime: saved.newChime === true,
      emergencyChime: saved.emergencyChime === true,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function artccLabel(id, center) {
  const label = id === 'ZHN' ? center.name : center.name + ' Center';
  return label + ' (' + id + ')';
}

function monitoringCenter({ artcc, station, lat, lon, scopeCenter }) {
  const preset = artccCenters.get(artcc);
  if (!preset) return { station, lat, lon };
  const stationName = artccLabel(artcc, preset);
  return scopeCenter === 'custom' ? { station: stationName, lat, lon, customOverride: true }
    : { station: stationName, lat: preset.lat, lon: preset.lon };
}

function readCustomCoordinates() {
  return scopeLatitude.disabled ? customScopeValues : { lat: scopeLatitude.value, lon: scopeLongitude.value };
}

function scopeDraft() {
  const { lat, lon } = readCustomCoordinates();
  return {
    artcc: artccInput.value || null,
    scopeCenter: scopeCenterInput.value,
    station: form.elements.namedItem('station').value.trim() || 'Custom location',
    lat: Number.parseFloat(lat),
    lon: Number.parseFloat(lon),
  };
}

function validScopeCoordinates(lat, lon) {
  return coordinate(lat, -mapLatitudeLimit, mapLatitudeLimit, null) !== null
    && coordinate(lon, -180, 180, null) !== null;
}

function persistSettings() {
  try {
    localStorage.setItem(settingsKey, JSON.stringify({ ...settings, altitudeBandVersion }));
    return true;
  } catch {
    return false;
  }
}

function validAircraftSort(saved) {
  const column = saved?.column === 'userDistance' ? 'distance' : saved?.column;
  if (typeof column !== 'string' || !Object.hasOwn(aircraftSortColumns, column)
    || typeof saved.descending !== 'boolean') return defaultAircraftSort;
  return { column, descending: saved.descending };
}

function loadAircraftSorts() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(aircraftSortKey));
  } catch {
    // Storage may be disabled or contain an invalid value.
  }
  return { nearby: validAircraftSort(saved?.nearby), traffic: validAircraftSort(saved?.traffic) };
}

function persistAircraftSort(view, sort) {
  try {
    localStorage.setItem(aircraftSortKey, JSON.stringify({ ...loadAircraftSorts(), [view]: sort }));
  } catch {
    // Sorting still works for the current page when storage is disabled.
  }
}

function updateSettingControls() {
  const { elements } = form;
  for (const key of ['station', 'radius', 'ground']) {
    elements.namedItem(key).value = settings[key];
  }
  weatherCutoffInput.value = settings.weatherMinDbz ?? '';
  colorControls.setValues(settings.aircraftColors);
  for (const input of labelOpacityInputs) {
    input.value = settings[input.name];
    updateOpacityValue(input);
  }
  artccInput.value = settings.artcc ?? '';
  updateScopeCenterControls(settings.scopeCenter, { lat: settings.lat, lon: settings.lon });
  for (const key of ['newChime', 'emergencyChime']) {
    elements.namedItem(key).checked = settings[key];
  }
  updateSourceOptions(savedSourceChoice());
  scheduleSettingsPreview();
}

function updateOpacityValue(input) {
  const percent = input.value + '%';
  $('#' + input.id + '-value').value = percent;
  input.setAttribute('aria-valuetext', percent);
  settingsPreviewMap.style.setProperty('--' + input.id, percent);
}

function updateScopeCenterControls(mode = scopeCenterInput.value, customValues = readCustomCoordinates()) {
  const preset = artccCenters.get(artccInput.value);
  presetCenterOption.disabled = !preset;
  scopeCenterInput.value = preset ? mode : 'custom';
  const usePreset = scopeCenterInput.value === 'preset';
  customScopeValues = customValues;
  const { lat, lon } = usePreset ? preset : customScopeValues;
  scopeLatitude.value = lat;
  scopeLongitude.value = lon;
  scopeLatitude.disabled = usePreset;
  scopeLongitude.disabled = usePreset;
  $('#scope-location-name').hidden = Boolean(preset);
  form.elements.namedItem('station').disabled = Boolean(preset);
}

function scheduleSettingsPreview() {
  if (settingsPreviewFrame || activeScreen !== 'settings') return;
  settingsPreviewFrame = requestAnimationFrame(() => {
    settingsPreviewFrame = 0;
    if (activeScreen === 'settings') renderSettingsPreview();
  });
}

function renderSettingsPreview() {
  const draft = scopeDraft();
  const { station, lat, lon, customOverride } = monitoringCenter(draft);
  const radius = Number(form.elements.namedItem('radius').value);
  const notice = $('#settings-preview-notice');
  const caption = $('#settings-preview-caption');
  const empty = $('#settings-preview-empty');
  const hasLocation = validScopeCoordinates(lat, lon);
  const hasRange = ranges.includes(radius);

  settingsPreviewMap.hidden = !hasLocation || !hasRange;
  empty.hidden = !settingsPreviewMap.hidden;
  if (settingsPreviewMap.hidden) {
    notice.hidden = true;
    caption.textContent = '';
    empty.textContent = hasLocation ? 'Choose a radar range to preview the scope.'
      : 'Enter valid latitude and longitude to preview the scope.';
    return;
  }

  caption.textContent = (customOverride ? 'Custom coordinates' : station) + ' · ' + radius + ' NM';
  settingsPreview ??= createRadar(settingsPreviewMap, notice, () => {}, { preview: true });
  settingsPreview.setArtcc(draft.artcc);
  settingsPreview.setArea({ lat, lon, radius });
}

function savedSourceChoice() {
  return settings.source === 'demo' ? 'demo' : settings.liveProvider ?? providerCatalog?.defaultProvider;
}

function updateSourceOptions(preferred) {
  const demo = new Option('Demo · simulated aircraft', 'demo');
  const status = new Option(providerCatalogError ? 'Live sources unavailable' : 'Loading live sources…', '');
  status.disabled = true;
  const live = providerCatalog?.providers.map((provider) => {
    const name = provider.label + (provider.available ? '' : ' (setup required)');
    return new Option(name, provider.id);
  }) ?? [status];
  sourceInput.replaceChildren(demo, ...live);
  sourceInput.value = preferred ?? '';
  if (sourceInput.selectedIndex < 0) sourceInput.value = providerCatalog ? providerCatalog.defaultProvider : '';
  updateSourceNote();
}

function updateSourceNote() {
  const choice = sourceInput.value;
  const note = $('#traffic-source-note');
  const selected = providerCatalog?.providers.find((provider) => provider.id === choice);
  let refreshNote;
  if (choice === 'demo') {
    refreshNote = 'Demo runs offline.';
  } else if (!selected) {
    refreshNote = providerCatalogError ? 'Could not load live sources. Reopen Settings to retry.' : 'Loading live sources…';
  } else if (selected.available) {
    const seconds = selected.intervalSeconds;
    const cadence = seconds % 60 === 0 ? seconds / 60 + ' min' : seconds + ' sec';
    refreshNote = 'Refreshes about every ' + cadence + '.';
  } else {
    refreshNote = selected.reason || 'This source requires server setup.';
  }
  const message = choice === 'adsb.fi' ? refreshNote + ' For personal, noncommercial use.' : refreshNote;
  const attribution = selected?.available ? providerCredits.get(choice) : '';
  replaceMarkup(note, esc(message) + (attribution ? ' ' + attribution : ''));
}

async function loadProviders() {
  if (providerCatalogLoading) return;
  providerCatalogLoading = true;
  providerCatalogError = false;
  updateSourceOptions(sourceInput.value || savedSourceChoice());
  const initialChoice = sourceInput.value;
  try {
    const response = await fetch('/api/providers', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Provider list request failed');
    const catalog = await response.json();
    const providers = catalog.providers.filter((provider) => providerCredits.has(provider.id));
    if (!providers.some((provider) => provider.id === catalog.defaultProvider && provider.available)) throw new Error('Invalid provider list');
    const draftChoice = sourceInput.value !== initialChoice ? sourceInput.value : null;
    providerCatalog = { ...catalog, providers };
    updateSourceOptions(draftChoice || savedSourceChoice());
    renderFeed();
  } catch {
    providerCatalogError = true;
    updateSourceOptions(sourceInput.value || savedSourceChoice());
  } finally {
    providerCatalogLoading = false;
  }
}

function syncAircraftColors(aircraftColors) {
  const style = document.documentElement.style;
  for (const [mode, { colors }] of Object.entries(aircraftColors)) {
    for (const [band, color] of Object.entries(colors)) style.setProperty('--' + mode + '-' + band, color);
  }

  for (const key of aircraftColorKeys) {
    const mode = key.dataset.colorKey;
    const { thresholds } = aircraftColors[mode];
    if (!thresholds) continue;
    const limits = thresholds.map((threshold) => {
      if (mode !== 'altitude') return number.format(threshold);
      const hundreds = altitudeLegendNumber.format(threshold / 100);
      if (threshold < altitudeAglTransitionFt) return hundreds;
      return threshold % 100 === 0 ? 'FL' + hundreds : hundreds + ' MSL';
    });
    const labels = [...limits.map((limit) => '<' + limit), limits.at(-1) + '+'];
    key.querySelectorAll('[data-band-limit]').forEach((element, index) => {
      element.textContent = labels[index];
    });
  }
}

function syncControls() {
  const { station, customOverride } = monitoringCenter(settings);
  const scopeStyle = $('#scope-map').style;
  scopeStyle.setProperty('--label-outline-opacity', settings.labelOutlineOpacity + '%');
  scopeStyle.setProperty('--label-background-opacity', settings.labelBackgroundOpacity + '%');
  const stationName = $('#station-name');
  stationName.textContent = settings.artcc ?? station;
  stationName.title = station;
  $('#traffic-station').textContent = (customOverride ? 'Custom coordinates' : station).toUpperCase();
  $('#scope-range').textContent = settings.radius;
  $('#range-picker').setAttribute('aria-label', 'Radar range, ' + settings.radius + ' nautical miles');
  $('#range-down').disabled = settings.radius === ranges[0];
  $('#range-up').disabled = settings.radius === ranges.at(-1);
  mapStyle.value = settings.basemap;
  mapStyle.dataset.overlay = String(settings.basemap !== 'radar');
  aircraftColorMode.value = settings.aircraftColorMode;
  syncAircraftColors(settings.aircraftColors);
  $('#weather-toggle').setAttribute('aria-pressed', settings.weather);
  $('#vector-toggle').setAttribute('aria-pressed', settings.vectors);
  $('#data-block-toggle').setAttribute('aria-pressed', settings.dataBlocks);
  $('#ground-toggle').setAttribute('aria-pressed', settings.ground === 'show');
  $('#airborne-toggle').setAttribute('aria-pressed', settings.airborne === 'show');
  $('#vector-key').hidden = !settings.vectors;
  radar.updateLayerOptions(settings.basemap, settings.weather, settings.weatherMinDbz);
}

function navigate(name) {
  if (!screens.includes(name) || activeScreen === name) return;
  activeScreen = name;
  if (name === 'settings') {
    updateSettingControls();
    $('#settings-notice').textContent = '';
    loadProviders();
  }
  for (const screen of screens) {
    const active = screen === name;
    $('#screen-' + screen).hidden = !active;
    const tab = $('.nav-tab[data-screen="' + screen + '"]');
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  $('#radar-controls').hidden = name !== 'radar';
  if (name === 'radar') {
    radar.fitArea();
    refresh();
  }
  renderTraffic();
}

function stepScreen(direction) {
  const index = (screens.indexOf(activeScreen) + direction + screens.length) % screens.length;
  navigate(screens[index]);
}

function updateSettings(changes) {
  const previous = settings;
  settings = { ...settings, ...changes };
  const saved = persistSettings();
  const previousCenter = monitoringCenter(previous);
  const center = monitoringCenter(settings);
  const artccChanged = previous.artcc !== settings.artcc;
  const locationChanged = previousCenter.lat !== center.lat || previousCenter.lon !== center.lon;
  const rangeChanged = previous.radius !== settings.radius;
  const sourceChanged = previous.source !== settings.source;
  const providerChanged = settings.source === 'live' && previous.liveProvider !== settings.liveProvider;
  if (artccChanged) radar.setArtcc(settings.artcc);
  if (sourceChanged || providerChanged || locationChanged || rangeChanged) resetTraffic();
  syncControls();
  renderTraffic();
  return saved;
}

function setRadarArea() {
  const { lat, lon } = monitoringCenter(settings);
  radar.setArea({ lat, lon, radius: settings.radius });
  if (scopeElevation?.lat !== lat || scopeElevation?.lon !== lon) loadScopeElevation(lat, lon);
}

async function loadScopeElevation(lat, lon) {
  const scope = { lat, lon, elevationFt: null };
  scopeElevation = scope;
  altitudeLegend.title = 'Altitude colors use MSL while scope elevation loads.';
  try {
    const query = new URLSearchParams({ lat, lon });
    const response = await fetch('/api/elevation?' + query, { signal: AbortSignal.timeout(8_000) });
    if (response.ok) {
      const { elevationFt } = await response.json();
      if (Number.isFinite(elevationFt)) scope.elevationFt = elevationFt;
    }
  } catch {
    // Traffic stays available when the center elevation cannot be loaded.
  }
  if (scopeElevation !== scope) return;

  const transition = altitudeAglTransitionFt / 100;
  altitudeLegend.title = scope.elevationFt === null
    ? 'Altitude colors use MSL because scope elevation is unavailable.'
    : `Scope center elevation is approximately ${number.format(scope.elevationFt)} ft MSL. Colors use scope AGL below FL${transition}.`;
  renderTraffic();
}

function resetTraffic() {
  snapshot = null;
  selectedId = null;
  observedAircraft = null;
  lastAlertObservation = null;
  connectionError = false;
  checking = true;
  setRadarArea();
  syncControls();
  renderTraffic();
  refresh();
}

function selectAircraft(id) {
  if (id === selectedId) return;
  if (id !== null && !currentFlights.some((flight) => flight.id === id)) return;
  selectedId = id;
  renderTraffic();
}

function value(numberValue, unit, prefix = '') {
  if (!Number.isFinite(numberValue)) return '—';
  return prefix + number.format(numberValue) + (unit ? ' <span>' + unit + '</span>' : '');
}

function groundTrackFor(flight) {
  return Number.isFinite(flight.trackDeg) ? String(Math.round(flight.trackDeg) % 360).padStart(3, '0') + '° <span>T</span>' : '—';
}

function snapshotAge() {
  const time = Date.parse(snapshot?.observedAt);
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 1000) : 0;
}

function altitudeFor(flight) {
  if (flight.onGround) return 'Ground';
  if (!Number.isFinite(flight.altitudeFt)) return '—';
  return `${number.format(flight.altitudeFt)}/${value(flight.altitudeAglFt)} <span>FT</span>`;
}

function distanceFor(distance, unit = '') {
  return Number.isFinite(distance) ? distance.toFixed(1) + (unit ? ' <span>' + unit + '</span>' : '') : '—';
}

function squawkReadout(flight, missing = '—') {
  const squawk = aircraftSquawk(flight);
  return '<span class="squawk-code" data-squawk="' + (squawk ?? '') + '" data-squawk-key="'
    + squawkColorBand(squawk) + '">' + (squawk ?? missing) + '</span>';
}

function replaceMarkup(container, markup) {
  if (container.renderedMarkup === markup) return;
  const active = container.contains(document.activeElement) && document.activeElement.dataset.focus;
  container.innerHTML = markup;
  container.renderedMarkup = markup;
  if (active) {
    const button = Array.from(container.querySelectorAll('[data-focus]')).find((element) => element.dataset.focus === active);
    button?.focus({ preventScroll: true });
  }
}

function renderDetails(flight) {
  let heading;
  if (flight) {
    const identity = [flight.type, flight.registration, flight.operator].filter(Boolean).join(' · ');
    heading = `<div class="flight-identity-title">
      <p class="flight-id">${esc(aircraftLabel(flight))}</p>
      ${flight.emergency ? '<span class="detail-emergency" role="img" aria-label="Reported emergency" title="Reported emergency">!</span>' : ''}
    </div>
    ${identity ? '<p class="flight-type">' + esc(identity) + '</p>' : ''}`;
  } else {
    const message = currentFlights.length ? 'Select an aircraft to see its details.'
      : checking ? 'Waiting for traffic data.'
      : connectionError || snapshot?.status === 'unavailable' ? 'Traffic data is unavailable.'
      : 'No aircraft are visible on the scope.';
    heading = '<p class="empty-detail">' + message + '</p>';
  }

  const details = flight ?? {};
  const altitudeBand = aircraftAltitudeBand(details, settings.aircraftColors.altitude.thresholds);
  const speedBand = aircraftSpeedBand(details, settings.aircraftColors.speed.thresholds);
  const altitudeAttribute = ' data-altitude="' + altitudeBand + '"';
  const speedAttribute = ' data-speed-band="' + speedBand + '"';
  const metric = (label, text, attribute = '') => '<div><dt>' + label + '</dt><dd' + attribute + '>'
    + (text === '—' ? '' : text) + '</dd></div>';
  const ratePrefix = details.verticalRateFpm > 0 ? '+' : '';
  replaceMarkup($('#flight-details'), `
    <div class="flight-identity">${heading}</div>
    <dl class="stats">
      ${metric('Altitude MSL/AGL', altitudeFor(details), altitudeAttribute + ' title="ADS-B barometric reports use standard pressure. AGL is estimated relative to the radar center."')}
      ${metric('Vertical Rate', value(details.verticalRateFpm, 'FT/MIN', ratePrefix))}
      ${metric('Ground Speed', value(details.speedKt, 'KT'), speedAttribute)}
      ${metric('Ground Track', groundTrackFor(details))}
      ${metric('Range', distanceFor(details.distanceNm, 'NM'))}
      ${metric('Squawk', squawkReadout(details, ''))}
      ${metric('Aircraft ID', esc(details.id?.toUpperCase()))}
      ${metric('Position Age', value(Number.isFinite(details.positionAgeSeconds) ? details.positionAgeSeconds + snapshotAge() : null, 's'))}
    </dl>
  `);
}

function visibleAircraft(aircraft) {
  const viewport = radar.getViewport();
  return aircraft.filter((flight) =>
    (flight.onGround ? settings.ground === 'show' : settings.airborne === 'show')
    && (!viewport || viewport.contains(flight.lat, flight.lon)),
  );
}

function recordFirstSeen(healthySnapshot) {
  const source = settings.source === 'demo' ? 'simulator' : snapshot?.provider ?? settings.liveProvider;
  if (!source) return;
  if (source !== firstSeenSource) {
    firstSeenTimes.clear();
    firstSeenSource = source;
  }
  if (!healthySnapshot) return;
  const now = Date.now();
  for (const flight of currentFlights) {
    if (!firstSeenTimes.has(flight.id)) firstSeenTimes.set(flight.id, now);
  }
  if (firstSeenTimes.size <= firstSeenLimit) return;
  const visible = new Set(currentFlights.map(({ id }) => id));
  for (const id of firstSeenTimes.keys()) {
    if (!visible.has(id)) firstSeenTimes.delete(id);
    if (firstSeenTimes.size <= firstSeenLimit) break;
  }
}

function firstSeenTime(flight) {
  const observedAt = firstSeenTimes.get(flight.id);
  if (observedAt === undefined) return '—';
  return '<time datetime="' + new Date(observedAt).toISOString() + '">' + utcTime.format(observedAt) + '</time>';
}

function compareIdent(a, b) {
  return identOrder.compare(aircraftLabel(a), aircraftLabel(b)) || a.id.localeCompare(b.id, 'en');
}

function compareAircraftSortValues(a, b, descending) {
  const aMissing = typeof a.value !== 'string' && !Number.isFinite(a.value);
  const bMissing = typeof b.value !== 'string' && !Number.isFinite(b.value);
  if (aMissing || bMissing) return Number(aMissing) - Number(bMissing) || compareIdent(a.flight, b.flight);
  const order = typeof a.value === 'string' ? identOrder.compare(a.value, b.value) : a.value - b.value;
  return (descending ? -order : order) || compareIdent(a.flight, b.flight);
}

function updateAircraftSortControls(selector, { column, descending }) {
  for (const button of document.querySelectorAll(selector)) {
    const name = button.dataset.nearSort ?? button.dataset.trafficSort;
    const active = name === column;
    const label = aircraftSortColumns[name].label;
    const direction = name === 'time' ? (descending ? 'newest first' : 'oldest first')
      : descending ? 'descending' : 'ascending';
    const heading = button.closest('th');
    if (active) heading?.setAttribute('aria-sort', descending ? 'descending' : 'ascending');
    else heading?.removeAttribute('aria-sort');
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? label + ', ' + direction : label);
    button.querySelector('[aria-hidden="true"]').textContent = active && descending ? '▼' : '▲';
  }
}

function nextAircraftSort(previous, column) {
  return { column, descending: column === previous.column ? !previous.descending : column === 'time' };
}

function sortedAircraft(flights, { column, descending }) {
  const valueFor = aircraftSortColumns[column].value;
  return flights.map((flight) => ({ flight, value: valueFor(flight) }))
    .sort((a, b) => compareAircraftSortValues(a, b, descending))
    .map(({ flight }) => flight);
}

function renderNearby() {
  updateAircraftSortControls('[data-near-sort]', nearbySort);
  const rows = sortedAircraft(currentFlights, nearbySort).slice(0, 24).map((flight) => `
    <button type="button" class="near-row" data-id="${esc(flight.id)}" data-focus="${esc(flight.id)}" data-altitude="${aircraftAltitudeBand(flight, settings.aircraftColors.altitude.thresholds)}" aria-pressed="${flight.id === selectedId}">
      <span class="row-time">${firstSeenTime(flight)}</span>
      <span class="near-identity"><span class="row-id">${esc(aircraftLabel(flight))}</span><span class="row-type">${esc(flight.type || '—')}</span></span>
      <span class="row-height">${formatAltitudeHundreds(flight)}</span><span class="row-height-agl">${formatHeightHundreds(flight.altitudeAglFt)}</span>
      <span class="row-speed" data-speed-band="${aircraftSpeedBand(flight, settings.aircraftColors.speed.thresholds)}">${value(flight.speedKt)}</span>
      <span class="row-squawk">${squawkReadout(flight)}</span><span class="row-distance">${distanceFor(flight.distanceNm)}</span>
    </button>
  `).join('');
  replaceMarkup($('#near-list'), rows || '<p class="empty-list">No aircraft to list.</p>');
}

function renderTraffic() {
  const aircraft = snapshot?.aircraft ?? [];
  const { lat, lon } = monitoringCenter(settings);
  const elevationFt = scopeElevation?.elevationFt;
  currentFlights = visibleAircraft(aircraft)
    .map((flight) => ({
      ...flight,
      altitudeAglFt: !flight.onGround && Number.isFinite(flight.altitudeFt) && Number.isFinite(elevationFt)
        ? flight.altitudeFt - elevationFt : null,
      distanceNm: distanceNm(lat, lon, flight.lat, flight.lon),
    }))
    .sort((a, b) => a.distanceNm - b.distanceNm);
  const flight = currentFlights.find((entry) => entry.id === selectedId);
  selectedId = flight?.id ?? null;

  const count = currentFlights.length;
  const ringCount = currentFlights.filter((entry) => entry.distanceNm <= settings.radius).length;
  $('#radar-counts').hidden = activeScreen !== 'radar';
  $('#scope-count').textContent = count;
  $('#scope-ring-count').textContent = ringCount + ' within ' + settings.radius + ' NM';
  $('#traffic-summary').textContent = count + ' aircraft on scope · ' + ringCount + ' within ' + settings.radius + ' NM';
  renderDetails(flight);
  const healthySnapshot = snapshot?.status === 'ok' && !connectionError;
  recordFirstSeen(healthySnapshot);
  const historySource = settings.source === 'demo'
    ? ['simulator', lat, lon, settings.radius].join('/')
    : snapshot?.provider ?? settings.liveProvider;
  radar.updateAircraft(currentFlights, selectedId, {
    colorMode: settings.aircraftColorMode,
    colors: settings.aircraftColors,
    fullTrailId: selectedId,
    vectors: settings.vectors,
    dataBlocks: settings.dataBlocks,
    canProject: healthySnapshot,
    snapshotAgeSeconds: snapshotAge(),
    historySource,
    historyFlights: aircraft,
    historyObservedAt: Date.parse(snapshot?.observedAt),
    canRecordHistory: healthySnapshot,
  });

  renderNearby();

  if (activeScreen === 'traffic') renderTable();
  renderFeed();
}

function renderTable() {
  updateAircraftSortControls('[data-traffic-sort]', trafficSort);
  replaceMarkup($('#traffic-list'), sortedAircraft(currentFlights, trafficSort).map((entry) => `
    <tr data-selected="${entry.id === selectedId}" data-altitude="${aircraftAltitudeBand(entry, settings.aircraftColors.altitude.thresholds)}">
      <td class="traffic-time">${firstSeenTime(entry)}</td>
      <td><button type="button" class="table-flight" data-id="${esc(entry.id)}" data-focus="${esc(entry.id)}">${esc(aircraftLabel(entry))}</button></td>
      <td>${esc(entry.type || '—')}</td><td class="traffic-squawk">${squawkReadout(entry)}</td>
      <td class="traffic-altitude">${formatAltitudeHundreds(entry)}</td><td class="traffic-altitude-agl">${formatHeightHundreds(entry.altitudeAglFt)}</td>
      <td class="traffic-speed" data-speed-band="${aircraftSpeedBand(entry, settings.aircraftColors.speed.thresholds)}">${value(entry.speedKt)}</td>
      <td>${groundTrackFor(entry)}</td><td class="traffic-range">${distanceFor(entry.distanceNm)}</td>
    </tr>
  `).join(''));
  const empty = $('#traffic-empty');
  empty.hidden = currentFlights.length > 0;
  empty.textContent = checking ? 'Waiting for traffic data.'
    : snapshot?.status === 'unavailable' || connectionError ? 'Traffic data is unavailable.'
    : 'No aircraft to list.';
}

function renderFeed() {
  const status = connectionError ? snapshot?.observedAt ? 'stale' : 'unavailable' : snapshot?.status;
  const badge = $('#feed-badge');
  const mode = status === 'unavailable' ? 'offline' : status === 'ok' && settings.source === 'live' ? 'live' : 'demo';
  let label = 'Demo';
  if (settings.source === 'live') label = status === 'ok' ? 'Live' : 'Connecting';
  if (status === 'stale') label = 'Stale';
  if (status === 'unavailable') label = 'Unavailable';
  if (badge.dataset.mode !== mode) badge.dataset.mode = mode;
  if (badge.lastElementChild.textContent !== label) badge.lastElementChild.textContent = label;
  const message = connectionError ? 'Cannot reach the local Airwatch server.' : snapshot?.message || '';
  badge.title = message;
  updateFeedAge();
}

function updateFeedAge(now = Date.now()) {
  const updatedAt = Date.parse(snapshot?.observedAt);
  let age = '—';
  if (Number.isFinite(updatedAt)) {
    const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
    age = String(seconds).padStart(3, '0') + 's';
  }
  const text = 'Age ' + age;
  const feedAge = $('#feed-age');
  if (feedAge.textContent !== text) feedAge.textContent = text;
}

async function refresh() {
  clearTimeout(refreshTimer);
  fetchController?.abort();
  const controller = new AbortController();
  fetchController = controller;
  const { source, radius, liveProvider } = settings;
  const { lat, lon } = monitoringCenter(settings);
  try {
    const query = new URLSearchParams({ source, lat, lon, radius });
    const viewport = radar.getViewport();
    // Round the viewport radius up in 5 NM steps to reuse snapshots after small resizes.
    const coverage = viewport ? Math.min(250, Math.ceil(viewport.radiusNm / 5) * 5) : radius;
    if (coverage > radius) query.set('coverage', coverage);
    if (source === 'live' && liveProvider) query.set('provider', liveProvider);
    const response = await fetch('/api/traffic?' + query, {
      cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
    });
    if (!response.ok) throw new Error('Traffic request failed');
    const data = await response.json();
    if (controller.signal.aborted) return;
    snapshot = data;
    connectionError = false;
    notifyTraffic(data);
  } catch {
    if (controller.signal.aborted) return;
    connectionError = true;
    if (Date.now() - Date.parse(snapshot?.observedAt) > 15 * 60_000) snapshot = null;
  } finally {
    if (!controller.signal.aborted) {
      checking = false;
      renderTraffic();
      refreshTimer = setTimeout(refresh, source === 'demo' ? 4_000 : 5_000);
    }
  }
}

function enableAudio() {
  if (!(settings.newChime || settings.emergencyChime) || !window.AudioContext) return;
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume().catch(() => {});
}

function notifyTraffic(data) {
  if (data.source !== 'live' || data.status !== 'ok' || data.observedAt === lastAlertObservation) return;
  lastAlertObservation = data.observedAt;
  const live = visibleAircraft(data.aircraft);
  const current = new Map(live.map((flight) => [flight.id, flight.emergency]));
  const emergency = settings.emergencyChime && live.some((flight) => flight.emergency && !observedAircraft?.get(flight.id));
  const newFlight = settings.newChime && observedAircraft && live.some((flight) => !observedAircraft.has(flight.id));
  observedAircraft = current;
  if (audio?.state !== 'running' || (!emergency && !newFlight)) return;
  for (const [index, pitch] of (emergency ? [620, 470, 620] : [680, 860]).entries()) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime + index * 0.14;
    oscillator.frequency.value = pitch;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.10, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.13);
  }
}

const centersByName = [...artccCenters].sort(([, a], [, b]) => a.name.localeCompare(b.name, 'en'));
for (const [id, center] of centersByName) artccInput.add(new Option(artccLabel(id, center), id));
artccInput.addEventListener('change', () => updateScopeCenterControls(presetCenterOption.disabled ? 'preset' : scopeCenterInput.value));
scopeCenterInput.addEventListener('change', () => updateScopeCenterControls());
function previewDraftChanged(event) {
  if (previewFields.has(event.target.name)) scheduleSettingsPreview();
}
form.addEventListener('input', previewDraftChanged);
form.addEventListener('change', previewDraftChanged);

if (new URLSearchParams(location.search).has('coordinate-keypad')) {
  const keypad = $('#coordinate-keypad');
  const entry = $('#coordinate-keypad-entry');
  const error = $('#coordinate-keypad-error');
  const decimalKey = keypad.querySelector('[data-coordinate-key="."]');
  const minusKey = keypad.querySelector('[data-coordinate-key="-"]');
  let activeField;

  for (const field of [scopeLatitude, scopeLongitude, ...form.querySelectorAll('[data-cutoff-mode]')]) {
    field.inputMode = 'none';
    field.setAttribute('aria-haspopup', 'dialog');
    const openKeypad = () => {
      if (field.disabled || keypad.open) return;
      activeField = field;
      const { cutoffMode } = field.dataset;
      $('#coordinate-keypad-title').textContent = field.getAttribute('aria-label') ?? field.labels[0].textContent.trim();
      decimalKey.disabled = Boolean(cutoffMode);
      minusKey.disabled = cutoffMode === 'speed';
      entry.value = field.value;
      error.textContent = '';
      keypad.showModal();
      entry.select();
    };
    field.addEventListener('click', openKeypad);
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      openKeypad();
    });
  }

  $('#coordinate-keypad-cancel').addEventListener('click', () => keypad.close());
  entry.addEventListener('input', () => { error.textContent = ''; });
  keypad.addEventListener('pointerdown', (event) => {
    if (event.target.closest('[data-coordinate-key]')) event.preventDefault();
  });
  keypad.addEventListener('click', (event) => {
    const button = event.target.closest('[data-coordinate-key]');
    if (!button || button.disabled) return;
    const { coordinateKey: key } = button.dataset;
    const { selectionStart: start, selectionEnd: end } = entry;
    if (key === 'clear') entry.value = '';
    else if (key === 'backspace') entry.setRangeText('', start === end ? Math.max(0, start - 1) : start, end, 'end');
    else entry.setRangeText(key, start, end, 'end');
    error.textContent = '';
  });
  keypad.addEventListener('submit', (event) => {
    const { cutoffMode } = activeField.dataset;
    const text = entry.value.trim();
    const value = cutoffMode ? parseColorCutoff(text, cutoffMode) : Number(text);
    const valid = cutoffMode ? Number.isSafeInteger(value)
      : /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) &&
        coordinate(value, Number(activeField.min), Number(activeField.max), null) !== null;
    if (!valid) {
      event.preventDefault();
      error.textContent = cutoffMode ? colorCutoffError(cutoffMode) : scopeCoordinateErrors[activeField.name];
      return;
    }
    if (cutoffMode) activeField.value = String(value);
    else activeField.valueAsNumber = value;
    activeField.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const rangeOptions = ranges.map((range) => '<option value="' + range + '">' + range + ' NM</option>').join('');
$('#settings-range').innerHTML = rangeOptions;
for (const dbz of weatherCutoffs) weatherCutoffInput.add(new Option(`${dbz} dBZ`, dbz));
$('#range-options').innerHTML = ranges.map((range) => '<button type="button" data-range="' + range + '">' + range + ' NM</button>').join('');
$('#range-picker').addEventListener('click', () => {
  for (const button of rangeDialog.querySelectorAll('[data-range]')) {
    button.setAttribute('aria-pressed', Number(button.dataset.range) === settings.radius);
  }
  rangeDialog.showModal();
  rangeDialog.querySelector('[aria-pressed="true"]').focus();
});
$('#range-down').addEventListener('click', () => updateSettings({ radius: ranges[ranges.indexOf(settings.radius) - 1] }));
$('#range-up').addEventListener('click', () => updateSettings({ radius: ranges[ranges.indexOf(settings.radius) + 1] }));
mapStyle.addEventListener('change', () => updateSettings({ basemap: mapStyle.value }));
aircraftColorMode.addEventListener('change', () => updateSettings({ aircraftColorMode: aircraftColorMode.value }));
$('#weather-toggle').addEventListener('click', () => updateSettings({ weather: !settings.weather }));
$('#vector-toggle').addEventListener('click', () => updateSettings({ vectors: !settings.vectors }));
$('#data-block-toggle').addEventListener('click', () => updateSettings({ dataBlocks: !settings.dataBlocks }));
$('#ground-toggle').addEventListener('click', () => updateSettings({ ground: settings.ground === 'show' ? 'hide' : 'show' }));
$('#airborne-toggle').addEventListener('click', () => updateSettings({ airborne: settings.airborne === 'show' ? 'hide' : 'show' }));
for (const input of labelOpacityInputs) {
  input.addEventListener('input', () => updateOpacityValue(input));
}
sourceInput.addEventListener('change', updateSourceNote);
form.addEventListener('invalid', (event) => {
  const message = scopeCoordinateErrors[event.target.name];
  if (message) $('#settings-notice').textContent = message;
}, true);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData(form);
  const { artcc, scopeCenter, station, lat, lon } = scopeDraft();
  const hasCustomCoordinates = validScopeCoordinates(lat, lon);
  if (scopeCenter === 'custom' && !hasCustomCoordinates) {
    $('#settings-notice').textContent = 'Enter valid latitude and longitude for the scope center.';
    return;
  }
  let aircraftColors;
  try {
    aircraftColors = colorControls.readValues();
  } catch (error) {
    $('#settings-notice').textContent = error.message;
    return;
  }
  const choice = sourceInput.value;
  const source = choice === 'demo' ? 'demo' : 'live';
  const selectedProvider = providerCatalog?.providers.find((provider) => provider.id === choice);
  if (source === 'live' && !selectedProvider?.available) {
    $('#settings-notice').textContent = selectedProvider?.reason || 'Select an available source before saving.';
    return;
  }
  const customLocation = hasCustomCoordinates ? { station, lat, lon } : {};
  const saved = updateSettings({
    ...customLocation, artcc, scopeCenter, radius: Number(values.get('radius')), source,
    aircraftColors,
    labelOutlineOpacity: outlineOpacityInput.valueAsNumber,
    labelBackgroundOpacity: backgroundOpacityInput.valueAsNumber,
    liveProvider: source === 'live' ? selectedProvider.id : settings.liveProvider,
    ground: values.get('ground'), weatherMinDbz: weatherCutoffInput.value === '' ? null : Number(weatherCutoffInput.value),
    newChime: values.has('newChime'), emergencyChime: values.has('emergencyChime'),
  });
  updateSettingControls();
  enableAudio();
  $('#settings-notice').textContent = saved ? 'Settings saved.' : 'Settings applied for this session.';
});

document.addEventListener('click', (event) => {
  if (performance.now() >= suppressClickUntil || event.detail === 0) return;
  event.stopImmediatePropagation();
  event.preventDefault();
}, true);
document.addEventListener('click', (event) => {
  enableAudio();
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.nearSort) {
    nearbySort = nextAircraftSort(nearbySort, button.dataset.nearSort);
    persistAircraftSort('nearby', nearbySort);
    renderNearby();
    return;
  }
  if (button.dataset.trafficSort) {
    trafficSort = nextAircraftSort(trafficSort, button.dataset.trafficSort);
    persistAircraftSort('traffic', trafficSort);
    renderTable();
    return;
  }
  if (button.dataset.screen) navigate(button.dataset.screen);
  if (button.dataset.id) {
    selectAircraft(button.dataset.id);
    if (activeScreen === 'traffic') navigate('radar');
  }
  if (button.dataset.range) {
    rangeDialog.close();
    updateSettings({ radius: Number(button.dataset.range) });
  }
});

function finishGesture(event) {
  if (!gesture || event.pointerId !== gesture.id) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  const limit = gesture.kind === 'touch' ? 60 : 44;
  if (Math.abs(dx) >= limit && Math.abs(dx) > Math.abs(dy) * 1.35 && performance.now() - gesture.start < 850) {
    suppressClickUntil = performance.now() + 350;
    stepScreen(dx < 0 ? 1 : -1);
  }
  gesture = null;
}

$('#kiosk').addEventListener('pointerdown', (event) => {
  if (!event.isPrimary) return;
  suppressClickUntil = 0;
  if (event.pointerType === 'mouse' || document.querySelector('dialog[open]')) return;
  if (event.target.closest('input, select, textarea, a')) return;
  const table = event.target.closest('.table-wrap');
  if (table && table.scrollWidth > table.clientWidth) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, kind: event.pointerType, start: performance.now() };
});
document.addEventListener('pointerup', finishGesture, true);
document.addEventListener('pointercancel', () => { gesture = null; }, true);

// Some touchscreens report a finger drag as mouse input. Keep native scrolling for touch.
const settingsScreen = $('#screen-settings');
let settingsDrag;
settingsScreen.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0 || settingsScreen.scrollHeight <= settingsScreen.clientHeight ||
      event.target.closest('button, input, select, textarea, label, a, [contenteditable]')) return;
  event.preventDefault();
  settingsScreen.setPointerCapture(event.pointerId);
  settingsDrag = { id: event.pointerId, y: event.clientY, top: settingsScreen.scrollTop, moved: false };
});
settingsScreen.addEventListener('pointermove', (event) => {
  if (event.pointerId !== settingsDrag?.id) return;
  const distance = settingsDrag.y - event.clientY;
  if (!settingsDrag.moved && Math.abs(distance) < 6) return;
  settingsDrag.moved = true;
  settingsScreen.scrollTop = settingsDrag.top + distance;
});
settingsScreen.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId === settingsDrag?.id) settingsDrag = undefined;
});

document.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || document.querySelector('dialog[open]') || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target.closest('input, select, textarea, [contenteditable]')) return;
  event.preventDefault();
  stepScreen(event.key === 'ArrowRight' ? 1 : -1);
});

const fullscreen = $('#fullscreen');
fullscreen.hidden = !document.fullscreenEnabled;
fullscreen.setAttribute('aria-label', 'Full screen');
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    fullscreen.title = 'Use F11 for full screen';
    fullscreen.setAttribute('aria-label', fullscreen.title);
  }
});
document.addEventListener('fullscreenchange', () => {
  const label = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  fullscreen.title = label;
  fullscreen.setAttribute('aria-label', label);
});

function updateClock() {
  const now = new Date();
  const clock = $('#utc-clock');
  clock.textContent = utcTime.format(now);
  clock.dateTime = now.toISOString();
  updateFeedAge(now.getTime());
  radar.updateWeather();
}

setRadarArea();
radar.setArtcc(settings.artcc);
syncControls();
updateAircraftSortControls('[data-near-sort]', nearbySort);
updateClock();
setInterval(updateClock, 1000);
enableAudio();
checking = true;
renderDetails(null);
refresh();
