import { aircraftColorPalette, altitudeAglTransitionFt, loadAircraftColors, validColorThresholds } from './aircraft-colors.js';

const bandRows = [
  { key: 'ground', label: 'Ground' },
  { key: 'low', label: 'First band', cutoff: 0 },
  { key: 'mid', label: 'Second band', cutoff: 1 },
  { key: 'high', label: 'Third band', cutoff: 2 },
  { key: 'upper', label: 'Fourth band', cutoff: 3 },
  { key: 'cruise', label: 'Top band' },
  { key: 'unknown', label: 'Missing' },
];
const groups = [
  {
    mode: 'altitude', title: 'Altitude', unit: 'ft', bands: bandRows,
    hint: `Use whole feet. Colors use scope AGL below ${altitudeAglTransitionFt.toLocaleString('en-US')} ft MSL when scope elevation is available, then MSL.`,
  },
  { mode: 'speed', title: 'Ground Speed', unit: 'kt', bands: bandRows, hint: 'Use whole knots, zero or greater. Speed is rounded for color bands.' },
  { mode: 'squawk', title: 'Squawk', bands: [
    { key: 'vfr', label: '1200' },
    { key: 'special', label: '7500 / 7600 / 7700' },
    { key: 'other', label: 'Other' },
    { key: 'unknown', label: 'Unknown' },
  ] },
];
const paletteByColor = new Map(aircraftColorPalette.map((entry) => [entry.value, entry]));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function swatchButton() {
  const button = element('button', 'aircraft-swatch-button');
  button.type = 'button';
  button.append(element('span', 'aircraft-swatch-chip'), element('span', 'aircraft-swatch-name'));
  button.firstChild.setAttribute('aria-hidden', 'true');
  return button;
}

function writeSwatch(button, { value, name }) {
  button.dataset.colorValue = value;
  button.style.setProperty('--swatch-color', value);
  button.lastChild.textContent = name;
}

export function parseColorCutoff(text, mode) {
  const value = /^[+-]?\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(value) && (mode !== 'speed' || value >= 0) ? value : NaN;
}

export function colorCutoffError(mode) {
  return mode === 'speed'
    ? 'Ground Speed cutoffs must be whole knots, zero or greater.'
    : 'Altitude cutoffs must be whole numbers in feet.';
}

function readThresholds(group, inputs) {
  const thresholds = inputs.map((input) => {
    input.removeAttribute('aria-invalid');
    return parseColorCutoff(input.value.trim(), group.mode);
  });
  if (validColorThresholds(group.mode, thresholds)) return thresholds;

  const badValue = thresholds.findIndex((value) => !Number.isSafeInteger(value));
  const badOrder = thresholds.findIndex((value, index) => index > 0 && value <= thresholds[index - 1]);
  const invalid = inputs[Math.max(0, badValue === -1 ? badOrder : badValue)];
  invalid.setAttribute('aria-invalid', 'true');
  invalid.focus();
  if (badValue === -1) throw new Error(`${group.title} cutoffs must increase from top to bottom.`);
  throw new Error(colorCutoffError(group.mode));
}

export function createColorControls(container) {
  const grid = element('div', 'aircraft-color-grid');
  const note = element('p', 'aircraft-color-note', 'Cutoffs increase from top to bottom. The top band starts at the last cutoff.');
  const dialog = element('dialog', 'aircraft-color-dialog');
  const heading = element('h2');
  heading.id = 'aircraft-color-dialog-title';
  dialog.setAttribute('aria-labelledby', heading.id);
  const header = element('header', 'panel-header');
  const cancel = element('button', 'text-button', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', () => dialog.close());
  header.append(heading, cancel);
  const choices = element('div', 'aircraft-color-choices');
  let active = null;
  const options = new Map();

  function applyColor(control, option) {
    writeSwatch(control.button, option);
    control.button.setAttribute('aria-label', `${control.label} color, ${option.name}`);
  }

  for (const option of aircraftColorPalette) {
    const button = swatchButton();
    writeSwatch(button, option);
    button.addEventListener('click', () => {
      if (active) applyColor(active, option);
      dialog.close();
    });
    choices.append(button);
    options.set(option.value, button);
  }
  dialog.append(header, choices);
  dialog.addEventListener('close', () => {
    active?.button.focus();
    active = null;
  });

  const editors = groups.map((group) => {
    const section = element('section', 'aircraft-color-group');
    const title = element('h2', '', group.unit ? `${group.title} (${group.unit})` : group.title);
    title.id = `aircraft-color-${group.mode}-title`;
    section.setAttribute('aria-labelledby', title.id);
    section.append(title);
    if (group.hint) section.append(element('p', 'aircraft-color-hint', group.hint));
    const inputs = [];
    const swatches = new Map();

    for (const band of group.bands) {
      const row = element('div', 'aircraft-color-row');
      if (band.cutoff === undefined) {
        row.append(element('span', 'aircraft-color-band', band.label));
      } else {
        const label = element('label', 'aircraft-color-cutoff');
        const symbol = element('span', '', '<');
        symbol.setAttribute('aria-hidden', 'true');
        const input = element('input', 'aircraft-color-threshold');
        input.type = 'text';
        input.dataset.cutoffMode = group.mode;
        input.inputMode = group.mode === 'speed' ? 'numeric' : 'decimal';
        input.autocomplete = 'off';
        input.maxLength = 17;
        input.setAttribute('aria-label', `${group.title} cutoff ${band.cutoff + 1} (${group.unit}, exclusive)`);
        input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
        inputs.push(input);
        label.append(symbol, input);
        row.append(label);
      }

      const button = swatchButton();
      const control = { button, label: `${group.title} ${band.label}` };
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', () => {
        active = control;
        heading.textContent = `${control.label} color`;
        for (const [value, choice] of options) {
          choice.setAttribute('aria-pressed', String(value === button.dataset.colorValue));
        }
        dialog.showModal();
        options.get(button.dataset.colorValue).focus();
      });
      swatches.set(band.key, control);
      row.append(button);
      section.append(row);
    }
    grid.append(section);
    return { group, inputs, swatches };
  });

  container.replaceChildren(note, grid, dialog);

  function setValues(config) {
    const values = loadAircraftColors(config);
    for (const { group, inputs, swatches } of editors) {
      const { colors, thresholds } = values[group.mode];
      for (const [index, input] of inputs.entries()) {
        input.value = thresholds[index];
        input.removeAttribute('aria-invalid');
      }
      for (const [band, control] of swatches) applyColor(control, paletteByColor.get(colors[band]));
    }
  }

  function readValues() {
    const values = {};
    for (const { group, inputs, swatches } of editors) {
      const colors = Object.fromEntries(Array.from(swatches, ([band, { button }]) => [band, button.dataset.colorValue]));
      values[group.mode] = inputs.length ? { thresholds: readThresholds(group, inputs), colors } : { colors };
    }
    return values;
  }

  setValues();
  return { setValues, readValues };
}
