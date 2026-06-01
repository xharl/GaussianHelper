import { parseCDXML } from '../parsers/cdxmlParser.js';
import { parseMOL, parseSDF } from '../parsers/molParser.js';
import { parseXYZ } from '../parsers/xyzParser.js';
import { processSMILES } from '../parsers/smilesHandler.js';
import { validateChargeMultiplicity } from '../utils/validation.js';

export class MoleculeInput {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Function} onMoleculeChange - Callback when molecule changes
   */
  constructor(container, onMoleculeChange) {
    this.container = container;
    this.onMoleculeChange = onMoleculeChange;
    this.jsmeApplet = null;
    this.jsmeReady = false;
    this.currentAtoms = [];
    this.currentMolfile = '';
    this.currentSmiles = '';
    this.charge = 0;
    this.multiplicity = 1;

    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <!-- SMILES Input -->
      <div class="section animate-in">
        <div class="section-header" data-section="smiles-section">
          <div class="section-title" style="display: flex; align-items: center; gap: 4px;">
            <span class="section-icon">✏️</span>
            SMILES Input
            <span class="tooltip tooltip-bottom" data-tooltip="Convert standard text representation to 3D conformation" style="cursor: help; opacity: 0.6; font-size: 11px;">ℹ️</span>
          </div>
        </div>
        <div class="section-content" id="smiles-section">
          <div class="form-group">
            <div class="smiles-input-row">
              <input type="text" id="smiles-input" class="form-input" placeholder="e.g. c1ccccc1 (benzene)" autocomplete="off" spellcheck="false" />
              <button id="smiles-load-btn" class="btn btn-primary btn-sm">Load</button>
            </div>
            <div class="smiles-examples">
              <span class="form-label" style="margin-bottom: 4px; display: block;">Examples:</span>
              <div class="example-tags">
                <button class="btn btn-ghost btn-sm example-smiles" data-smiles="c1ccccc1">Benzene</button>
                <button class="btn btn-ghost btn-sm example-smiles" data-smiles="CC(=O)O">Acetic acid</button>
                <button class="btn btn-ghost btn-sm example-smiles" data-smiles="CCO">Ethanol</button>
                <button class="btn btn-ghost btn-sm example-smiles" data-smiles="C1CCCCC1">Cyclohexane</button>
                <button class="btn btn-ghost btn-sm example-smiles" data-smiles="O">Water</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- File Upload -->
      <div class="section animate-in" style="animation-delay: 0.05s">
        <div class="section-header" data-section="upload-section">
          <div class="section-title" style="display: flex; align-items: center; gap: 4px;">
            <span class="section-icon">📁</span>
            Import File
            <span class="tooltip tooltip-bottom" data-tooltip="Load external molecules directly from common files" style="cursor: help; opacity: 0.6; font-size: 11px;">ℹ️</span>
          </div>
        </div>
        <div class="section-content" id="upload-section">
          <div class="file-drop-zone" id="file-drop-zone">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p class="drop-text">Drop file or <label for="file-input" class="drop-link">browse</label></p>
            <p class="drop-formats">.cdxml · .mol · .sdf · .xyz · .gjf · .com</p>
            <input type="file" id="file-input" accept=".cdxml,.mol,.sdf,.xyz,.gjf,.com" hidden />
          </div>
          <div id="file-info" class="file-info hidden">
            <span id="file-name" class="file-name"></span>
            <button id="file-clear" class="btn btn-ghost btn-sm">✕</button>
          </div>
        </div>
      </div>

      <!-- 2D Editor (Disabled) -->

      <!-- Charge & Multiplicity -->
      <div class="section animate-in" style="animation-delay: 0.15s">
        <div class="section-header">
          <div class="section-title" style="display: flex; align-items: center; gap: 4px;">
            <span class="section-icon">⚡</span>
            Charge & Multiplicity
          </div>
        </div>
        <div class="section-content">
          <div class="charge-mult-row">
            <div class="form-group" style="flex:1">
              <label class="form-label" for="charge-input" style="display: flex; align-items: center; gap: 4px;">
                Charge
                <span class="tooltip" data-tooltip="Net electrical charge of the species" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
              </label>
              <input type="number" id="charge-input" class="form-input" value="0" min="-10" max="10" step="1" />
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label" for="mult-input" style="display: flex; align-items: center; gap: 4px;">
                Multiplicity
                <span class="tooltip" data-tooltip="Spin multiplicity (2S+1). Must match electron count parity." style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
              </label>
              <input type="number" id="mult-input" class="form-input" value="1" min="1" max="10" step="1" />
            </div>
          </div>
          <div id="charge-mult-warning" class="form-warning hidden"></div>
        </div>
      </div>

      <!-- Atom Count Info -->
      <div class="section animate-in" style="animation-delay: 0.2s">
        <div id="atom-info" class="atom-info">
          <span class="atom-info-text">No molecule loaded</span>
        </div>
      </div>
    `;
  }

  bindEvents() {
    // SMILES input
    const smilesInput = this.container.querySelector('#smiles-input');
    const smilesLoadBtn = this.container.querySelector('#smiles-load-btn');

    smilesLoadBtn.addEventListener('click', () => this.loadSMILES());
    smilesInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.loadSMILES();
    });

    // Example SMILES buttons
    this.container.querySelectorAll('.example-smiles').forEach(btn => {
      btn.addEventListener('click', () => {
        smilesInput.value = btn.dataset.smiles;
        this.loadSMILES();
      });
    });

    // File upload
    const fileInput = this.container.querySelector('#file-input');
    const dropZone = this.container.querySelector('#file-drop-zone');
    const fileClear = this.container.querySelector('#file-clear');

    fileInput.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length) {
        this.handleFileSelect(e.dataTransfer.files[0]);
      }
    });

    fileClear.addEventListener('click', () => {
      this.container.querySelector('#file-info').classList.add('hidden');
      this.container.querySelector('#file-input').value = '';
    });

    // Editor apply button disabled
    // this.container.querySelector('#editor-get-btn').addEventListener('click', () => {
    //   this.getFromEditor();
    // });

    // Charge & Multiplicity
    const chargeInput = this.container.querySelector('#charge-input');
    const multInput = this.container.querySelector('#mult-input');

    chargeInput.addEventListener('change', () => {
      this.charge = parseInt(chargeInput.value) || 0;
      this.notifyChange();
    });
    multInput.addEventListener('change', () => {
      this.multiplicity = parseInt(multInput.value) || 1;
      this.notifyChange();
    });
  }

  initJSME() {
    // Wait for JSME to load
    const checkJSME = () => {
      if (typeof JSApplet !== 'undefined' && typeof JSApplet.JSME !== 'undefined') {
        try {
          this.jsmeApplet = new JSApplet.JSME('jsme-container', '100%', '280px', {
            options: 'query,hydrogens,nocanonize,nostereo'
          });
          this.jsmeReady = true;
          const loading = this.container.querySelector('#jsme-loading');
          if (loading) loading.remove();
        } catch (err) {
          console.warn('JSME initialization failed:', err);
          const loading = this.container.querySelector('#jsme-loading');
          if (loading) {
            loading.innerHTML = '<div class="viewer-placeholder"><span>JSME editor unavailable. Use SMILES or file import instead.</span></div>';
          }
        }
      } else {
        setTimeout(checkJSME, 500);
      }
    };
    // Start checking after a short delay
    setTimeout(checkJSME, 1000);
  }

  async loadSMILES(silent = false) {
    const input = this.container.querySelector('#smiles-input');
    const smiles = input.value.trim();
    if (!smiles) return;

    try {
      const result = await processSMILES(smiles);
      this.currentAtoms = result.atoms;
      this.currentMolfile = result.molfile;
      this.currentSmiles = smiles;

      // Load into JSME if available
      if (this.jsmeReady && this.jsmeApplet) {
        try {
          this.jsmeApplet.readMolFile(result.molfile);
        } catch (e) {
          // JSME may not support all molfiles
        }
      }

      this.updateAtomInfo();
      this.notifyChange();
      if (!silent) {
        this.showToast('Molecule loaded from SMILES', 'success');
      }
    } catch (err) {
      if (!silent) {
        this.showToast(`Invalid SMILES: ${err.message}`, 'error');
      }
    }
  }

  async handleFileSelect(file) {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const content = await file.text();

    try {
      let result;

      switch (ext) {
        case 'cdxml':
          result = parseCDXML(content);
          break;
        case 'mol':
          result = parseMOL(content);
          break;
        case 'sdf':
          result = parseSDF(content);
          break;
        case 'xyz':
          result = parseXYZ(content);
          break;
        case 'gjf':
        case 'com':
          result = this.parseGJF(content);
          break;
        default:
          throw new Error(`Unsupported file format: .${ext}`);
      }

      if (result && result.atoms && result.atoms.length > 0) {
        this.currentAtoms = result.atoms;
        this.currentMolfile = result.molfile || '';
        this.currentSmiles = result.smiles || '';

        // Update SMILES input
        if (this.currentSmiles) {
          this.container.querySelector('#smiles-input').value = this.currentSmiles;
        }

        // Show file info
        const fileInfo = this.container.querySelector('#file-info');
        const fileName = this.container.querySelector('#file-name');
        fileName.textContent = `${file.name} (${result.atoms.length} atoms)`;
        fileInfo.classList.remove('hidden');

        // Load into JSME if we have a molfile
        if (this.jsmeReady && this.jsmeApplet && this.currentMolfile) {
          try {
            this.jsmeApplet.readMolFile(this.currentMolfile);
          } catch (e) {
            // Ignore JSME errors
          }
        }

        // Set charge/multiplicity if parsed from GJF
        if (result.charge !== undefined) {
          this.charge = result.charge;
          this.container.querySelector('#charge-input').value = result.charge;
        }
        if (result.multiplicity !== undefined) {
          this.multiplicity = result.multiplicity;
          this.container.querySelector('#mult-input').value = result.multiplicity;
        }

        this.updateAtomInfo();
        this.notifyChange();
        this.showToast(`Loaded ${result.atoms.length} atoms from ${file.name}`, 'success');
      } else {
        throw new Error('No atoms found in file');
      }
    } catch (err) {
      this.showToast(`Error parsing file: ${err.message}`, 'error');
    }
  }

  /**
   * Parse a Gaussian .gjf/.com file to extract atoms
   */
  parseGJF(content) {
    const lines = content.split('\n');
    const atoms = [];
    let charge = 0, multiplicity = 1;
    let inMolecule = false;
    let blankCount = 0;
    let pastRoute = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip Link0 and route
      if (line.startsWith('%') || line.startsWith('#')) continue;
      if (line.startsWith('!')) continue; // comment

      if (line === '') {
        if (pastRoute) blankCount++;
        continue;
      }

      if (!pastRoute && !line.startsWith('%') && !line.startsWith('#')) {
        pastRoute = true;
      }

      // After title (2 blank lines from route start), next non-blank is charge/mult
      if (pastRoute && blankCount >= 2 && !inMolecule) {
        const parts = line.split(/\s+/);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          charge = parseInt(parts[0]);
          multiplicity = parseInt(parts[1]);
          inMolecule = true;
          continue;
        }
      }

      // Read atoms
      if (inMolecule) {
        if (line === '' || line.startsWith('$') || line.startsWith('!')) break;
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          const symbol = parts[0].replace(/\d+$/, ''); // Remove trailing numbers
          const x = parseFloat(parts[1]);
          const y = parseFloat(parts[2]);
          const z = parseFloat(parts[3]);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            atoms.push({ symbol, x, y, z });
          }
        }
      }
    }

    return { atoms, charge, multiplicity };
  }

  getFromEditor() {
    if (!this.jsmeReady || !this.jsmeApplet) {
      this.showToast('JSME editor not ready', 'warning');
      return;
    }

    try {
      const smiles = this.jsmeApplet.smiles();
      if (!smiles || smiles.trim() === '') {
        this.showToast('Draw a molecule first', 'warning');
        return;
      }
      this.container.querySelector('#smiles-input').value = smiles;
      this.loadSMILES();
    } catch (err) {
      this.showToast('Could not read from editor', 'error');
    }
  }

  updateAtomInfo() {
    const info = this.container.querySelector('#atom-info');
    if (this.currentAtoms.length === 0) {
      info.innerHTML = '<span class="atom-info-text">No molecule loaded</span>';
      return;
    }

    // Count atoms by element
    const counts = {};
    this.currentAtoms.forEach(a => {
      counts[a.symbol] = (counts[a.symbol] || 0) + 1;
    });

    // Build molecular formula
    const formula = Object.entries(counts)
      .sort(([a], [b]) => {
        // Hill system: C first, H second, then alphabetical
        if (a === 'C') return -1;
        if (b === 'C') return 1;
        if (a === 'H') return -1;
        if (b === 'H') return 1;
        return a.localeCompare(b);
      })
      .map(([sym, count]) => `${sym}${count > 1 ? count : ''}`)
      .join('');

    info.innerHTML = `
      <div class="atom-info-formula">${formula}</div>
      <div class="atom-info-count">${this.currentAtoms.length} atoms</div>
    `;
  }

  notifyChange() {
    this.validateChargeMult();
    if (this.onMoleculeChange) {
      this.onMoleculeChange({
        atoms: this.currentAtoms,
        molfile: this.currentMolfile,
        smiles: this.currentSmiles,
        charge: this.charge,
        multiplicity: this.multiplicity
      });
    }
  }

  validateChargeMult() {
    const warningEl = this.container.querySelector('#charge-mult-warning');
    if (!warningEl) return;

    if (this.currentAtoms.length === 0) {
      warningEl.classList.add('hidden');
      return;
    }

    const result = validateChargeMultiplicity(this.charge, this.multiplicity, this.currentAtoms);
    if (!result.valid) {
      warningEl.innerHTML = `<span class="warning-icon">⚠️</span> <span>${result.message}</span>`;
      warningEl.classList.remove('hidden');
    } else {
      warningEl.classList.add('hidden');
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
      <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /** Set charge/multiplicity programmatically */
  setChargeMult(charge, multiplicity) {
    this.charge = charge;
    this.multiplicity = multiplicity;
    this.container.querySelector('#charge-input').value = charge;
    this.container.querySelector('#mult-input').value = multiplicity;
  }

  /** Get current state */
  getState() {
    return {
      atoms: this.currentAtoms,
      molfile: this.currentMolfile,
      smiles: this.currentSmiles,
      charge: this.charge,
      multiplicity: this.multiplicity
    };
  }
}
