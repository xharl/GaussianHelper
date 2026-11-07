/**
 * GJFPreview component
 * Live preview of the generated .gjf file with syntax highlighting
 */

import { generateGJF } from '../generators/gjfGenerator.js';
import { validateInputCompleteness, lintTheoryLevel } from '../utils/validation.js';

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
      const lint = lintTheoryLevel(config);
      this.renderCode(this.currentGJF, validation, lint);
    } catch (err) {
      this.currentGJF = '';
      const codeBody = this.container.querySelector('#gjf-code');
      const warningsContainer = this.container.querySelector('#gjf-warnings');
      if (warningsContainer) {
        warningsContainer.classList.add('hidden');
        warningsContainer.innerHTML = '';
      }
      if (codeBody) {
        codeBody.innerHTML = `<div class="code-placeholder error"><span>Error generating GJF: ${this.escapeHtml(err.message)}</span></div>`;
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
  renderCode(gjf, validation, lint = null) {
    const codeBody = this.container.querySelector('#gjf-code');
    const warningsContainer = this.container.querySelector('#gjf-warnings');

    // Accept the legacy string[] form too, so any external caller keeps working.
    const issues = Array.isArray(lint)
      ? lint.map((message) => ({ id: 'legacy', severity: 'info', message }))
      : (lint?.issues || []);
    const estimate = Array.isArray(lint) ? null : (lint?.estimate || null);

    if (!gjf || gjf.trim() === '') {
      if (codeBody) codeBody.innerHTML = '<div class="code-placeholder"><span>Configure parameters and load a molecule to generate .gjf</span></div>';
      if (warningsContainer) {
        warningsContainer.classList.add('hidden');
        warningsContainer.innerHTML = '';
      }
      return;
    }

    let htmlContent = '';

    if (validation && !validation.valid && validation.errors && validation.errors.length > 0) {
      htmlContent += `
        <div class="form-warning" style="margin: 12px 16px 0 16px;">
          <div style="font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; color: var(--warning);">
            <span class="warning-icon">⚠️</span> Gaussian Input Verification Warnings
          </div>
          <ul style="margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 11px;">
            ${validation.errors.map(err => `<li style="margin-bottom: 2px;">${this.escapeHtml(err)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    if (issues.length > 0) {
      htmlContent += this.renderLintPanel(issues);
    }

    if (estimate) {
      htmlContent += this.renderCostEstimate(estimate);
    }

    if (htmlContent) {
      if (warningsContainer) {
        warningsContainer.innerHTML = htmlContent;
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
   * Render the severity-tagged lint list (warnings amber, informational notes
   * blue). All message text is escaped.
   */
  renderLintPanel(issues) {
    if (!issues || issues.length === 0) return '';

    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    const infoCount = issues.length - warningCount;
    const accent = warningCount > 0 ? 'var(--warning)' : 'var(--info)';
    const border = warningCount > 0 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(59, 130, 246, 0.2)';
    const background = warningCount > 0 ? 'rgba(245, 158, 11, 0.05)' : 'rgba(59, 130, 246, 0.05)';
    const warningLabel = `${warningCount} warning${warningCount === 1 ? '' : 's'}`;
    const infoLabel = `${infoCount} note${infoCount === 1 ? '' : 's'}`;

    return `
      <div class="form-recommendation" data-lint="preflight" style="margin: 12px 16px 0 16px; padding: 10px 12px; border-radius: var(--radius-md); border: 1px solid ${border}; background: ${background};">
        <div style="font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; color: ${accent};">
          <span class="info-icon">🧪</span> Pre-flight Chemistry Lint
          <span style="font-weight: 400; color: var(--text-tertiary); font-size: 11px;">${warningLabel} · ${infoLabel}</span>
        </div>
        <ul style="margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 11px; line-height: 1.45;">
          ${issues.map((issue) => `
            <li style="margin-bottom: 3px;">
              <span style="font-weight: 600; color: ${issue.severity === 'warning' ? 'var(--warning)' : 'var(--info)'};">${issue.severity === 'warning' ? 'Warning' : 'Info'}:</span>
              ${this.escapeHtml(issue.message)}
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  /**
   * Render the labelled heuristic cost panel. Never present as a benchmark:
   * the headline label and disclaimer are fixed text, and every displayed
   * number is rounded to one significant figure by the estimator.
   */
  renderCostEstimate(estimate) {
    const low = this.formatHours(estimate.coreHours.low);
    const high = this.formatHours(estimate.coreHours.high);
    const coreRange = low === high ? low : `${low}–${high}`;
    let wall = '';
    if (estimate.wallHours) {
      const wallLow = this.formatHours(estimate.wallHours.low);
      const wallHigh = this.formatHours(estimate.wallHours.high);
      const wallRange = wallLow === wallHigh ? wallLow : `${wallLow}–${wallHigh}`;
      const coreWord = estimate.cores === 1 ? 'core' : 'cores';
      wall = `
        <div style="margin-top: 4px; color: var(--text-secondary); font-size: 11px;">
          On ${estimate.cores} ${coreWord}: ≈ ${wallRange} hours wall-clock if scaling were ideal — real parallel efficiency is lower.
        </div>
      `;
    }

    return `
      <div class="form-recommendation" data-lint="cost-estimate" style="margin: 12px 16px 0 16px; padding: 10px 12px; border-radius: var(--radius-md); border: 1px solid rgba(148, 163, 184, 0.25); background: rgba(148, 163, 184, 0.06);">
        <div style="font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; color: var(--text-primary);">
          <span class="info-icon">⏱</span> Cost Estimate (heuristic)
        </div>
        <div style="font-size: 12px; color: var(--text-primary); margin-bottom: 4px;">
          ≈ <strong>${coreRange} core-hours</strong>
          <span style="color: var(--text-tertiary); font-size: 11px;">(one significant figure)</span>
        </div>
        <div style="font-size: 11px; color: var(--warning); margin-bottom: 6px;">
          ${this.escapeHtml(estimate.disclaimer)}
        </div>
        ${wall}
        <div style="margin-top: 6px; font-weight: 600; color: var(--text-secondary); font-size: 11px;">Assumptions behind the estimate</div>
        <ul style="margin: 2px 0 0 0; padding-left: 18px; color: var(--text-secondary); font-size: 11px; line-height: 1.45;">
          ${estimate.assumptions.map((assumption) => `<li style="margin-bottom: 2px;">${this.escapeHtml(assumption)}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  /** Format a core-hour value without inventing precision. */
  formatHours(value) {
    if (!Number.isFinite(value)) return '?';
    if (value > 0 && value < 0.1) return String(value);
    if (value >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return String(value);
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
    // Info-level events don't create notifications
    if (type === 'info') return;
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = type === 'success' ? '✓' : 'ℹ';
    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;
    toast.append(icon, text);
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}
