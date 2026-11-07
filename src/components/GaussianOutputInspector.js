import { parseGaussianLogStream, parseGaussianLogText } from '../parsers/gaussianLogParser.js';

const CSV_HEADERS = [
  'filename', 'section', 'status', 'termination_line', 'termination_text', 'scf_status', 'scf_method',
  'scf_energy_hartree', 'reference_energy_hartree', 'method_energy_hartree', 'method_energy_label',
  'scf_records', 'scf_line', 'scf_evidence', 'optimization_status',
  'optimization_line', 'optimization_evidence', 'frequency_count', 'imaginary_count',
  'most_negative_frequency_cm-1', 'imaginary_frequencies_cm-1', 'omitted_imaginary_values',
  'frequency_line', 'frequency_evidence', 'thermochemistry_zero_point_hartree',
  'thermochemistry_thermal_energy_hartree', 'thermochemistry_thermal_enthalpy_hartree',
  'thermochemistry_thermal_gibbs_hartree', 'thermochemistry_zpe_total_hartree',
  'thermochemistry_energy_total_hartree', 'thermochemistry_enthalpy_total_hartree',
  'thermochemistry_gibbs_total_hartree', 'temperature_k', 'pressure_atm',
  'thermochemistry_line', 'thermochemistry_evidence', 'diagnostics',
];

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function csvCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let text = String(value ?? '');
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function formatGaussianResultsCsv(results) {
  const rows = [CSV_HEADERS.map(csvCell).join(',')];
  for (const result of results) {
    for (const section of result.sections || []) {
      const frequencyCount = section.frequencies.count;
      const diagnostics = (section.diagnostics || [])
        .map(item => `${item.kind} (line ${item.line}): ${item.text}`)
        .join(' | ');
      const values = [
        result.filename,
        section.index,
        section.status,
        section.termination?.line ?? '',
        section.termination?.text ?? '',
        section.scf.status,
        section.scf.method ?? '',
        section.scf.energyHartree,
        section.scf.energyHartree ?? '',
        section.finalEnergy?.valueHartree ?? '',
        section.finalEnergy?.label ?? '',
        section.scf.records,
        section.scf.line ?? '',
        section.scf.evidence ?? '',
        section.optimization.status,
        section.optimization.line ?? '',
        section.optimization.evidence ?? '',
        frequencyCount,
        frequencyCount === null ? '' : section.frequencies.imaginaryCount,
        section.frequencies.minImaginary,
        (section.frequencies.imaginaryValues || []).join('; '),
        section.frequencies.omittedImaginaryValues ?? 0,
        section.frequencies.line ?? '',
        section.frequencies.evidence ?? '',
        section.thermochemistry?.zeroPointHartree ?? '',
        section.thermochemistry?.thermalCorrectionHartree?.energy ?? '',
        section.thermochemistry?.thermalCorrectionHartree?.enthalpy ?? '',
        section.thermochemistry?.thermalCorrectionHartree?.gibbs ?? '',
        section.thermochemistry?.totalsHartree?.zpe ?? '',
        section.thermochemistry?.totalsHartree?.energy ?? '',
        section.thermochemistry?.totalsHartree?.enthalpy ?? '',
        section.thermochemistry?.totalsHartree?.gibbs ?? '',
        section.thermochemistry?.temperatureK ?? '',
        section.thermochemistry?.pressureAtm ?? '',
        section.thermochemistry?.line ?? '',
        section.thermochemistry?.evidence ?? '',
        diagnostics,
      ];
      rows.push(values.map(csvCell).join(','));
    }
  }
  return rows.join('\r\n');
}

function statusLabel(status) {
  return ({
    completed: 'Completed',
    error: 'Error termination',
    incomplete: 'Incomplete',
    'parse-error': 'Could not read',
  })[status] || 'Unknown';
}

function formatFrequency(section) {
  const frequencies = section.frequencies;
  if (frequencies.count === null) return 'Not found';
  const imaginary = frequencies.imaginaryCount === 1 ? '1 negative mode' : `${frequencies.imaginaryCount} negative modes`;
  const lowest = frequencies.minImaginary === null ? '' : ` · most negative ${frequencies.minImaginary} cm⁻¹`;
  const line = frequencies.line ? ` · line ${frequencies.line}` : '';
  return `${frequencies.count} modes · ${imaginary}${lowest}${line}`;
}

function formatEnergy(energy) {
  if (!Number.isFinite(energy)) return 'Not found';
  return `${energy} Hartree`;
}

function renderThermochemistry(section) {
  const thermochemistry = section.thermochemistry;
  const totals = thermochemistry?.totalsHartree;
  if (!totals || ![totals.zpe, totals.enthalpy, totals.gibbs].some(value => Number.isFinite(value))) {
    return '<div><strong>Thermochemistry:</strong> Not found</div>';
  }
  const rows = [];
  if (Number.isFinite(totals.zpe)) rows.push(`<div><strong>ZPE total:</strong> ${escapeHtml(totals.zpe)} Hartree</div>`);
  if (Number.isFinite(totals.enthalpy)) rows.push(`<div><strong>H total:</strong> ${escapeHtml(totals.enthalpy)} Hartree</div>`);
  if (Number.isFinite(totals.gibbs)) rows.push(`<div><strong>G total:</strong> ${escapeHtml(totals.gibbs)} Hartree</div>`);
  const conditions = [];
  if (Number.isFinite(thermochemistry.temperatureK)) conditions.push(`${thermochemistry.temperatureK} K`);
  if (Number.isFinite(thermochemistry.pressureAtm)) conditions.push(`${thermochemistry.pressureAtm} Atm`);
  if (conditions.length > 0) {
    const line = Number.isInteger(thermochemistry.line) ? ` · line ${thermochemistry.line}` : '';
    rows.push(`<div><strong>Thermochemistry conditions:</strong> ${escapeHtml(conditions.join(' · '))}${line}</div>`);
  }
  return rows.join('');
}

/**
 * Route-echo summary for one section. The echoed `%Chk`/`%OldChk` filename is
 * shown explicitly: a route can match while a stale checkpoint silently loads a
 * different molecule.
 *
 * `options.expectedRouteTokens` (optional) adds a missing/unexpected diff, for
 * callers that already know the configured route.
 */
function renderRouteEcho(section, options = {}) {
  const echo = section.routeEcho;
  if (!echo || typeof echo !== 'object') {
    return '<div><strong>Route echo:</strong> Not captured for this section</div>';
  }
  const tokens = Array.isArray(echo.tokens) ? echo.tokens : [];
  const checkpoints = Array.isArray(echo.checkpoints) ? echo.checkpoints : [];
  if (!Number.isInteger(echo.line) && tokens.length === 0 && checkpoints.length === 0) {
    return '<div><strong>Route echo:</strong> Not found in this section</div>';
  }

  const found = Number.isInteger(echo.line)
    ? `line ${echo.line} · ${tokens.length} token(s)`
    : 'no route line found';
  const rows = [`<div><strong>Route echo:</strong> ${escapeHtml(found)}</div>`];
  rows.push(checkpoints.length
    ? `<div><strong>Echoed checkpoint (%Chk / %OldChk):</strong> ${checkpoints.map(name => `<code>${escapeHtml(name)}</code>`).join(', ')}</div>`
    : '<div><strong>Echoed checkpoint (%Chk / %OldChk):</strong> none</div>');

  if (Array.isArray(options?.expectedRouteTokens)) {
    const ignored = new Set(['SP', 'TEST', 'MAXDISK']);
    const expected = options.expectedRouteTokens
      .map(token => String(token).trim().toUpperCase())
      .filter(token => token && !ignored.has(token));
    const missing = expected.filter(token => !tokens.includes(token));
    const unexpected = tokens.filter(token => !expected.includes(token) && !ignored.has(token));
    const parts = [];
    if (missing.length) parts.push(`missing ${missing.join(', ')}`);
    if (unexpected.length) parts.push(`unexpected ${unexpected.join(', ')}`);
    const summary = parts.length ? parts.join(' · ') : 'all expected tokens present';
    rows.push(`<div><strong>Route echo comparison:</strong> ${escapeHtml(summary)}</div>`);
  }

  if (tokens.length) {
    rows.push(`<details class="inspector-evidence"><summary>Route tokens (${tokens.length})</summary><code>${escapeHtml(tokens.join(' '))}</code></details>`);
  }
  if (echo.evidence) {
    const line = Number.isInteger(echo.line) ? `, line ${echo.line}` : '';
    rows.push(`<details class="inspector-evidence"><summary>Route echo source${line}</summary><code>${escapeHtml(echo.evidence)}</code></details>`);
  }
  return rows.join('');
}

export class GaussianOutputInspector {
  constructor(container) {
    this.container = container;
    this.results = [];
    this.processing = false;
    this.statusMessage = 'Files are parsed locally in this browser; no log contents are uploaded or saved.';
    this.render();
  }

  render() {
    const sectionCount = this.results.reduce((sum, result) => sum + (result.sections?.length || 0), 0);
    const completed = this.results.reduce((sum, result) => sum + (result.summary?.completed || 0), 0);
    const errors = this.results.reduce((sum, result) => sum + (result.summary?.errors || 0), 0);
    const incomplete = this.results.reduce((sum, result) => sum + (result.summary?.incomplete || 0), 0);
    const parseErrors = this.results.filter(result => result.parseError).length;

    this.container.innerHTML = `
      <div class="gaussian-output-inspector">
        <section class="card">
          <div class="card-header">
            <span class="card-title">Gaussian Output Inspector</span>
            <div class="inspector-actions">
              <button id="inspector-export-csv" class="btn btn-secondary btn-sm" ${sectionCount === 0 ? 'disabled' : ''}>Export CSV</button>
              <button id="inspector-clear" class="btn btn-ghost btn-sm" ${this.results.length === 0 || this.processing ? 'disabled' : ''}>Clear</button>
            </div>
          </div>
          <div class="card-body">
            <label class="file-drop-zone gaussian-log-dropzone" id="gaussian-log-dropzone">
              <span class="file-drop-zone-icon" aria-hidden="true">📄</span>
              <span class="file-drop-zone-text">Drop Gaussian output files here or browse</span>
              <span class="file-drop-zone-hint">Select one or more .log / .out files</span>
              <input id="gaussian-log-input" type="file" accept=".log,.out" multiple ${this.processing ? 'disabled' : ''} hidden />
            </label>
            <div class="inspector-status" id="inspector-status" role="status" aria-live="polite">${escapeHtml(this.statusMessage)}</div>
          </div>
        </section>

        ${sectionCount || parseErrors ? `
          <div class="inspector-summary" aria-label="Batch summary">
            <div class="inspector-summary-item"><strong>${sectionCount}</strong><span>Sections</span></div>
            <div class="inspector-summary-item"><strong>${completed}</strong><span>Completed</span></div>
            <div class="inspector-summary-item"><strong>${errors + parseErrors}</strong><span>Errors</span></div>
            <div class="inspector-summary-item"><strong>${incomplete}</strong><span>Incomplete</span></div>
          </div>
        ` : ''}

        <div class="inspector-results">
          ${this.results.length === 0 ? '' : this.results.map(result => this.renderFileResult(result)).join('')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const input = this.container.querySelector('#gaussian-log-input');
    const dropzone = this.container.querySelector('#gaussian-log-dropzone');
    const exportButton = this.container.querySelector('#inspector-export-csv');
    const clearButton = this.container.querySelector('#inspector-clear');

    input?.addEventListener('change', event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      void this.processFiles(files);
    });

    dropzone?.addEventListener('dragover', event => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone?.addEventListener('drop', event => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
      void this.processFiles(Array.from(event.dataTransfer?.files || []));
    });

    exportButton?.addEventListener('click', () => this.downloadCsv());
    clearButton?.addEventListener('click', () => {
      this.results = [];
      this.statusMessage = 'Results cleared. Files are parsed locally in this browser.';
      this.render();
    });
  }

  async processFiles(files) {
    if (this.processing || files.length === 0) return;

    this.processing = true;
    this.statusMessage = `Processing ${files.length} file(s)…`;
    this.render();

    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        try {
          if (!/\.(?:log|out)$/i.test(file.name)) {
            throw new Error('Only .log and .out files are supported.');
          }
          const result = typeof file.stream === 'function'
            ? await parseGaussianLogStream(file.stream(), file.name)
            : parseGaussianLogText(await file.text(), file.name);
          result.sizeBytes = file.size;
          this.results.push(result);
        } catch (error) {
          this.results.push({
            filename: file.name,
            sizeBytes: file.size,
            parseError: error instanceof Error ? error.message : String(error),
            sections: [],
            summary: { status: 'parse-error', completed: 0, errors: 0, incomplete: 0 },
          });
        }
        this.statusMessage = `Processed ${index + 1} of ${files.length} file(s). Logs remain on this device.`;
        this.render();
      }
      this.statusMessage = `Finished processing ${files.length} file(s). Results are only held in this page.`;
    } finally {
      this.processing = false;
      this.render();
    }
  }

  renderFileResult(result) {
    const size = Number.isFinite(result.sizeBytes) ? ` · ${formatBytes(result.sizeBytes)}` : '';
    if (result.parseError) {
      return `
        <section class="card inspector-file-result">
          <div class="card-header">
            <span class="inspector-file-name">${escapeHtml(result.filename)}${size}</span>
            <span class="inspector-status-badge status-error">${statusLabel('parse-error')}</span>
          </div>
          <div class="card-body"><div class="form-warning">${escapeHtml(result.parseError)}</div></div>
        </section>
      `;
    }

    const summary = result.summary;
    return `
      <section class="card inspector-file-result">
        <div class="card-header">
          <span class="inspector-file-name">${escapeHtml(result.filename)}${size}</span>
          <span class="inspector-status-badge status-${escapeHtml(summary.status)}">${statusLabel(summary.status)}</span>
        </div>
        <div class="card-body">
          <div class="inspector-file-summary">${summary.completed} completed · ${summary.errors} errors · ${summary.incomplete} incomplete section(s)</div>
          ${result.sections.map(section => this.renderSection(section)).join('')}
        </div>
      </section>
    `;
  }

  renderSection(section, options = {}) {
    const scfEnergy = formatEnergy(section.scf.energyHartree);
    const finalEnergy = section.finalEnergy;
    const hasFinalEnergy = Number.isFinite(finalEnergy?.valueHartree);
    const methodEnergyName = finalEnergy?.label ? `Method energy (${finalEnergy.label})` : 'Method energy';
    const methodEnergy = hasFinalEnergy
      ? `${finalEnergy.valueHartree} Hartree${finalEnergy.line ? ` · line ${finalEnergy.line}` : ''}`
      : 'Not found — this section reports only the SCF reference';
    const scfEvidence = section.scf.evidence
      ? `<details class="inspector-evidence"><summary>SCF source, line ${section.scf.line}</summary><code>${escapeHtml(section.scf.evidence)}</code></details>`
      : '';
    const finalEnergyEvidence = hasFinalEnergy && finalEnergy.evidence
      ? `<details class="inspector-evidence"><summary>Method energy source, line ${finalEnergy.line}</summary><code>${escapeHtml(finalEnergy.evidence)}</code></details>`
      : '';
    const optEvidence = section.optimization.evidence
      ? `<details class="inspector-evidence"><summary>Optimization source, line ${section.optimization.line}</summary><code>${escapeHtml(section.optimization.evidence)}</code></details>`
      : '';
    const freqEvidence = section.frequencies.evidence
      ? `<details class="inspector-evidence"><summary>Frequency source, line ${section.frequencies.line}</summary><code>${escapeHtml(section.frequencies.evidence)}</code></details>`
      : '';
    const thermoEvidence = section.thermochemistry?.evidence
      ? `<details class="inspector-evidence"><summary>Thermochemistry source, line ${section.thermochemistry.line}</summary><code>${escapeHtml(section.thermochemistry.evidence)}</code></details>`
      : '';
    const thermoFailure = section.thermochemistry?.failure
      ? `<div class="form-warning">Thermochemistry failure, line ${section.thermochemistry.failure.line}: <code>${escapeHtml(section.thermochemistry.failure.evidence)}</code></div>`
      : '';
    const termination = section.termination
      ? `<div><strong>Termination:</strong> line ${section.termination.line} — <code>${escapeHtml(section.termination.text)}</code></div>`
      : '<div><strong>Termination:</strong> no termination marker found</div>';
    const imaginaryValues = section.frequencies.imaginaryValues || [];
    const imaginaryValueText = imaginaryValues.length
      ? ` · values ${imaginaryValues.join(', ')} cm⁻¹${section.frequencies.omittedImaginaryValues ? ` (first ${imaginaryValues.length} shown; ${section.frequencies.omittedImaginaryValues} omitted)` : ''}`
      : '';
    const diagnostics = section.diagnostics.length
      ? `<details class="inspector-diagnostics"><summary>Warnings / errors (${section.diagnostics.length}${section.omittedDiagnostics ? ` shown, ${section.omittedDiagnostics} omitted` : ''})</summary><ul>${section.diagnostics.map(item => `<li><strong>${escapeHtml(item.kind)} · line ${item.line}:</strong> <code>${escapeHtml(item.text)}</code></li>`).join('')}</ul></details>`
      : '<div class="inspector-no-diagnostics">No matching warning/error lines found; this is not a correctness guarantee.</div>';

    return `
      <details class="inspector-section" open>
        <summary>Section ${section.index} · ${statusLabel(section.status)}</summary>
        <div class="inspector-metrics">
          <div><strong>SCF:</strong> ${escapeHtml(section.scf.status)} · ${escapeHtml(section.scf.method || 'method not found')}${section.scf.line ? ` · line ${section.scf.line}` : ''}</div>
          <div><strong>Reference energy (SCF):</strong> ${escapeHtml(scfEnergy)}</div>
          <div><strong>${escapeHtml(methodEnergyName)}:</strong> ${escapeHtml(methodEnergy)}</div>
          ${renderRouteEcho(section, options)}
          <div><strong>Optimization:</strong> ${escapeHtml(section.optimization.status)}${section.optimization.line ? ` · line ${section.optimization.line}` : ''}</div>
          <div><strong>Frequencies:</strong> ${escapeHtml(formatFrequency(section))}${escapeHtml(imaginaryValueText)}</div>
          ${renderThermochemistry(section)}
          ${termination}
        </div>
        ${scfEvidence}${finalEnergyEvidence}${optEvidence}${freqEvidence}${thermoEvidence}${thermoFailure}${diagnostics}
      </details>
    `;
  }

  downloadCsv() {
    const csv = formatGaussianResultsCsv(this.results);
    if (!csv || this.results.every(result => result.sections.length === 0)) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gaussian-output-summary.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
