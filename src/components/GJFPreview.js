/**
 * GJFPreview component
 * Live preview of the generated .gjf file with syntax highlighting
 */

import { generateGJF } from '../generators/gjfGenerator.js';
import { validateInputCompleteness } from '../utils/validation.js';

export class GJFPreview {
  /**
   * @param {HTMLElement} container
   * @param {Function} [onAddToBatch] - Optional callback when adding to batch
   */
  constructor(container, onAddToBatch = null) {
    this.container = container;
    this.onAddToBatch = onAddToBatch;
    this.currentGJF = '';
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="code-preview">
        <div class="code-header">
          <span class="code-filename">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            output.gjf
          </span>
          <div class="code-actions" style="display: flex; gap: var(--space-2);">
            ${this.onAddToBatch ? `
              <button id="preview-add-batch" class="btn btn-secondary btn-sm" title="Add to batch queue">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Add to Batch
              </button>
            ` : ''}
            <button id="preview-copy" class="btn btn-ghost btn-sm" title="Copy to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              Copy
            </button>
          </div>
        </div>
        <div id="gjf-warnings" class="code-warnings-container hidden"></div>
        <div class="code-body" id="gjf-code">
          <div class="code-placeholder">
            <span>Configure parameters and load a molecule to generate .gjf</span>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const copyBtn = this.container.querySelector('#preview-copy');
    copyBtn.addEventListener('click', () => this.copyToClipboard());

    const addBatchBtn = this.container.querySelector('#preview-add-batch');
    if (addBatchBtn && this.onAddToBatch) {
      addBatchBtn.addEventListener('click', () => this.onAddToBatch());
    }
  }

  /**
   * Update the preview with new parameters
   * @param {Object} params - Parameter state from ParameterPanel
   * @param {Object} molecule - Molecule state from MoleculeInput
   */
  update(params, molecule) {
    if (!params) return;

    try {
      const config = this.buildConfig(params, molecule);
      this.currentGJF = generateGJF(config);
      const validation = validateInputCompleteness(config);
      this.renderCode(this.currentGJF, validation);
    } catch (err) {
      this.currentGJF = '';
      const codeBody = this.container.querySelector('#gjf-code');
      const warningsContainer = this.container.querySelector('#gjf-warnings');
      if (warningsContainer) {
        warningsContainer.classList.add('hidden');
        warningsContainer.innerHTML = '';
      }
      if (codeBody) {
        codeBody.innerHTML = `<div class="code-placeholder error"><span>Error generating GJF: ${err.message}</span></div>`;
      }
    }
  }


  /**
   * Build GJF config from parameter and molecule state
   */
  buildConfig(params, molecule) {
    // Build solvation keyword
    let solvation = '';
    if (params.solvation && params.solvent) {
      solvation = `SCRF=(${params.solvationModel},Solvent=${params.solvent})`;
    }

    // Build method/basis string
    const methodDef = params.method || 'HF';
    const basisSet = params.basisSet || '';

    return {
      link0: {
        memory: params.memory ? `${params.memory}${params.memoryUnit}` : '',
        nproc: params.nproc || '',
        checkpoint: params.checkpoint || '',
      },
      route: {
        verbosity: params.verbosity || '#N',
        method: methodDef,
        basisSet: basisSet,
        jobType: params.jobType || 'SP',
        scf: params.scf || '',
        grid: params.grid || '',
        dispersion: params.dispersion || '',
        solvation: solvation,
        pop: params.pop || '',
        custom: params.customKeywords || '',
      },
      title: params.title || 'Gaussian calculation',
      charge: molecule ? molecule.charge : 0,
      multiplicity: molecule ? molecule.multiplicity : 1,
      atoms: molecule ? molecule.atoms : [],
    };
  }

  /**
   * Render the GJF content with syntax highlighting
   */
  renderCode(gjf, validation) {
    const codeBody = this.container.querySelector('#gjf-code');
    const warningsContainer = this.container.querySelector('#gjf-warnings');

    if (!gjf || gjf.trim() === '') {
      if (codeBody) codeBody.innerHTML = '<div class="code-placeholder"><span>Configure parameters and load a molecule to generate .gjf</span></div>';
      if (warningsContainer) {
        warningsContainer.classList.add('hidden');
        warningsContainer.innerHTML = '';
      }
      return;
    }

    if (validation && !validation.valid && validation.errors && validation.errors.length > 0) {
      if (warningsContainer) {
        warningsContainer.innerHTML = `
          <div class="form-warning" style="margin: 12px 16px 0 16px;">
            <div style="font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; color: var(--warning);">
              <span class="warning-icon">⚠️</span> Gaussian Input Verification Warnings
            </div>
            <ul style="margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 11px;">
              ${validation.errors.map(err => `<li style="margin-bottom: 2px;">${err}</li>`).join('')}
            </ul>
          </div>
        `;
        warningsContainer.classList.remove('hidden');
      }
    } else {
      if (warningsContainer) {
        warningsContainer.classList.add('hidden');
        warningsContainer.innerHTML = '';
      }
    }

    const lines = gjf.split('\n');
    const highlighted = lines.map((line, idx) => {
      const num = `<span class="code-line-num">${String(idx + 1).padStart(3)}</span>`;
      const content = this.highlightLine(line);
      return `<div class="code-line">${num}<span class="code-line-content">${content}</span></div>`;
    }).join('');

    codeBody.innerHTML = `<div class="code-lines">${highlighted}</div>`;
  }

  /**
   * Apply syntax highlighting to a single line
   */
  highlightLine(line) {
    const escaped = this.escapeHtml(line);

    // Blank line
    if (line.trim() === '') {
      return '<span class="syn-blank">·</span>';
    }

    // Link 0 commands (%Mem, %NProcShared, %Chk)
    if (line.startsWith('%')) {
      return `<span class="syn-link0">${escaped}</span>`;
    }

    // Route section (starts with #)
    if (line.startsWith('#')) {
      // Highlight method and keywords within route
      return this.highlightRoute(escaped);
    }

    // Comment
    if (line.startsWith('!')) {
      return `<span class="syn-comment">${escaped}</span>`;
    }

    // Charge/multiplicity line (two numbers)
    const chargeMult = line.trim().match(/^(-?\d+)\s+(\d+)$/);
    if (chargeMult) {
      return `<span class="syn-charge">${escaped}</span>`;
    }

    // Atom coordinate line
    const atomLine = line.trim().match(/^([A-Z][a-z]?\d*)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)\s+(-?\d+\.\d+)/);
    if (atomLine) {
      const parts = line.match(/^(\s*)(\S+)(\s+)(-?\d+\.\d+)(\s+)(-?\d+\.\d+)(\s+)(-?\d+\.\d+)/);
      if (parts) {
        return `${parts[1]}<span class="syn-atom">${this.escapeHtml(parts[2])}</span>${parts[3]}<span class="syn-coord">${this.escapeHtml(parts[4])}</span>${parts[5]}<span class="syn-coord">${this.escapeHtml(parts[6])}</span>${parts[7]}<span class="syn-coord">${this.escapeHtml(parts[8])}</span>`;
      }
    }

    // Title line (between route and charge/mult - appears as gray)
    return `<span class="syn-title">${escaped}</span>`;
  }

  /**
   * Highlight the route section with keyword coloring
   */
  highlightRoute(escaped) {
    // Replace known keywords with colored spans
    let result = escaped;

    // The # prefix
    result = result.replace(/^(#[NnPpTt]?)/, '<span class="syn-keyword">$1</span>');

    // Method/Basis (e.g., B3LYP/6-31G(d))
    result = result.replace(
      /([A-Za-z0-9\-\(\)]+\/[A-Za-z0-9\-\+\(\)\*,]+)/,
      '<span class="syn-route">$1</span>'
    );

    // Keywords like Opt, Freq, SP, etc.
    const keywords = ['Opt', 'Freq', 'SP', 'IRC', 'Scan', 'TD', 'NMR', 'Stable', 'Polar', 'Force', 'Volume', 'Pop', 'SCRF', 'EmpiricalDispersion', 'SCF', 'Int', 'NoSymm', 'Symmetry', 'Guess', 'Geom', 'GFInput', 'GFPrint', 'MaxDisk', 'Counterpoise', 'Pseudo'];
    keywords.forEach(kw => {
      const regex = new RegExp(`\\b(${kw}(?:=[^\\s]*)?)`, 'gi');
      result = result.replace(regex, '<span class="syn-keyword">$1</span>');
    });

    return result;
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async copyToClipboard() {
    if (!this.currentGJF) return;
    try {
      await navigator.clipboard.writeText(this.currentGJF);
      this.showToast('Copied to clipboard', 'success');
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = this.currentGJF;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this.showToast('Copied to clipboard', 'success');
    }
  }

  /** Get the current GJF content */
  getGJF() {
    return this.currentGJF;
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${type === 'success' ? '✓' : 'ℹ'}</span>
      <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}
