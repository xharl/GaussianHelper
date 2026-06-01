/**
 * ParameterPanel component
 * Handles all Gaussian calculation parameter configuration with custom select dropdown menus
 */

import { methods, methodCategories } from '../data/methods.js';
import { basisSets, basisSetCategories } from '../data/basisSets.js';
import { solvents, solvationModels } from '../data/solvents.js';
import {
  jobTypes,
  scfOptions,
  integrationGrids,
  dispersionCorrections,
  populationAnalysis,
  outputVerbosity
} from '../data/keywords.js';

export class ParameterPanel {
  /**
   * @param {HTMLElement} container
   * @param {Function} onParameterChange - Callback when any parameter changes
   */
  constructor(container, onParameterChange) {
    this.container = container;
    this.onParameterChange = onParameterChange;

    // Current state
    this.state = {
      // Link 0
      memory: '4',
      memoryUnit: 'GB',
      nproc: '4',
      checkpoint: '',

      // Route
      verbosity: '#N',
      method: 'B3LYP',
      methodCategory: 'DFT',
      basisSet: '6-31G(d)',
      basisSetCategory: 'Pople',
      jobType: 'Opt Freq',

      // Additional
      scf: '',
      grid: '',
      dispersion: '',
      pop: '',

      // Solvation
      solvation: false,
      solvationModel: 'SMD',
      solvent: 'Water',

      // Custom
      customKeywords: '',

      // Title
      title: 'Gaussian calculation'
    };

    // Track if heavy atoms detected
    this.hasHeavyAtoms = false;

    this.render();
    this.bindEvents();
  }

  getSelectedJobName() {
    const job = jobTypes.find(j => j.keyword === this.state.jobType);
    return job ? job.name : this.state.jobType || 'Select calculation type';
  }

  render() {
    this.container.innerHTML = `
      <!-- Resources (Link 0) -->
      <div class="section animate-in">
        <div class="section-header collapsible" data-section="link0-content">
          <div class="section-title">
            <span class="section-icon">💻</span>
            Resources
          </div>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-content" id="link0-content">
          <div class="form-row">
            <div class="form-group" style="flex:2">
              <label class="form-label" for="memory-input" style="display: flex; align-items: center; gap: 4px;">
                Memory
                <span class="tooltip" data-tooltip="Gaussian %Mem value (max RAM allocatable)" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
              </label>
              <div class="input-group">
                <input type="number" id="memory-input" class="form-input" value="${this.state.memory}" min="1" max="512" />
                <select id="memory-unit" class="form-select form-select-sm">
                  <option value="MB">MB</option>
                  <option value="GB" selected>GB</option>
                  <option value="TB">TB</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="flex:1">
              <label class="form-label" for="nproc-input" style="display: flex; align-items: center; gap: 4px;">
                CPUs
                <span class="tooltip" data-tooltip="Gaussian %NProcShared value (number of CPU cores)" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
              </label>
              <input type="number" id="nproc-input" class="form-input" value="${this.state.nproc}" min="1" max="256" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="chk-input" style="display: flex; align-items: center; gap: 4px;">
              Checkpoint file
              <span class="tooltip" data-tooltip="Gaussian %Chk filename for checkpoint recovery files" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <input type="text" id="chk-input" class="form-input" value="${this.state.checkpoint}" placeholder="molecule.chk (optional)" />
          </div>
        </div>
      </div>

      <!-- Calculation Type -->
      <div class="section animate-in" style="animation-delay: 0.05s">
        <div class="section-header collapsible" data-section="job-content">
          <div class="section-title">
            <span class="section-icon">🎯</span>
            Calculation
          </div>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-content" id="job-content">
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
              Calculation Type
              <span class="tooltip" data-tooltip="Determines calculation type (e.g. geometry optimization vs. single point)" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <div class="custom-select-wrap" id="job-select-wrap">
              <button type="button" class="custom-select-trigger" id="job-trigger">
                <span class="trigger-val">${this.getSelectedJobName()}</span>
                <svg class="trigger-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="custom-select-dropdown hidden" id="job-dropdown" style="background-color: #12151e !important; background: #12151e !important; opacity: 1 !important; z-index: 9999 !important;">
                <div class="dropdown-search-wrap">
                  <input type="text" class="form-input dropdown-search" id="job-search" placeholder="Search calculation types..." autocomplete="off" spellcheck="false" />
                </div>
                <div class="dropdown-list" id="job-list">
                  ${this.renderJobList()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Method -->
      <div class="section animate-in" style="animation-delay: 0.1s">
        <div class="section-header collapsible" data-section="method-content">
          <div class="section-title">
            <span class="section-icon">🔬</span>
            Theory
          </div>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-content" id="method-content">
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
              Method / Level of Theory
              <span class="tooltip" data-tooltip="Theoretical model, density functional functional, or post-HF theory" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <div class="custom-select-wrap" id="method-select-wrap">
              <button type="button" class="custom-select-trigger" id="method-trigger">
                <span class="trigger-val">
                  ${this.state.method}
                  <span class="trigger-val-badge">${this.state.methodCategory}</span>
                </span>
                <svg class="trigger-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="custom-select-dropdown hidden" id="method-dropdown" style="background-color: #12151e !important; background: #12151e !important; opacity: 1 !important; z-index: 9999 !important;">
                <div class="dropdown-tabs-search">
                  <div class="tab-bar compact" id="method-tabs">
                    ${methodCategories.map(cat => `
                      <button type="button" class="tab ${this.state.methodCategory === cat ? 'active' : ''}" data-method-cat="${cat}">${cat}</button>
                    `).join('')}
                  </div>
                  <input type="text" class="form-input dropdown-search" id="method-search" placeholder="Search methods..." autocomplete="off" spellcheck="false" />
                </div>
                <div class="dropdown-list method-list-scrollable" id="method-list">
                  ${this.renderMethodList(this.state.methodCategory)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Basis Set -->
      <div class="section animate-in" style="animation-delay: 0.15s">
        <div class="section-header collapsible" data-section="basis-content">
          <div class="section-title">
            <span class="section-icon">📐</span>
            Basis Set
          </div>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-content" id="basis-content">
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
              Basis Set
              <span class="tooltip" data-tooltip="Mathematical functions representing molecular orbitals" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <div class="custom-select-wrap" id="basis-select-wrap">
              <button type="button" class="custom-select-trigger" id="basis-trigger" ${this.state.basisSet === '' ? 'disabled' : ''}>
                <span class="trigger-val">
                  ${this.state.basisSet || 'N/A'}
                  ${this.state.basisSet ? `<span class="trigger-val-badge">${this.state.basisSetCategory}</span>` : ''}
                </span>
                <svg class="trigger-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="custom-select-dropdown hidden" id="basis-dropdown" style="background-color: #12151e !important; background: #12151e !important; opacity: 1 !important; z-index: 9999 !important;">
                <div class="dropdown-tabs-search">
                  <div class="tab-bar compact" id="basis-tabs">
                    ${basisSetCategories.map(cat => `
                      <button type="button" class="tab ${this.state.basisSetCategory === cat ? 'active' : ''}" data-basis-cat="${cat}">${cat}</button>
                    `).join('')}
                  </div>
                  <input type="text" class="form-input dropdown-search" id="basis-search" placeholder="Search basis sets..." autocomplete="off" spellcheck="false" />
                </div>
                <div class="dropdown-list basis-list-scrollable" id="basis-list">
                  ${this.renderBasisList(this.state.basisSetCategory)}
                </div>
              </div>
            </div>
            <div id="heavy-atom-notice" class="form-notice hidden" style="margin-top: 8px;">
              <span class="notice-icon">⚠️</span>
              <span>Heavy atoms detected. Consider using an <strong>ECP basis set</strong> (LanL2DZ, SDD) for transition metals.</span>
            </div>
          </div>
        </div>
      </div>


      <!-- Additional Options -->
      <div class="section animate-in" style="animation-delay: 0.2s">
        <div class="section-header collapsible" data-section="options-content">
          <div class="section-title">
            <span class="section-icon">🔧</span>
            Additional Options
          </div>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-content" id="options-content">
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
              Dispersion Correction
              <span class="tooltip" data-tooltip="Empirical dispersion models (e.g. D3, D3BJ) to model non-covalent forces" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <select id="dispersion-select" class="form-select">
              ${dispersionCorrections.map(d => `
                <option value="${d.keyword}" ${this.state.dispersion === d.keyword ? 'selected' : ''}>${d.name}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
              SCF Convergence
              <span class="tooltip" data-tooltip="Self-Consistent Field convergence settings" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <select id="scf-select" class="form-select">
              ${scfOptions.map(s => `
                <option value="${s.keyword}" ${this.state.scf === s.keyword ? 'selected' : ''}>${s.name}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
              Integration Grid
              <span class="tooltip" data-tooltip="Numerical integration grid density for DFT calculations" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <select id="grid-select" class="form-select">
              ${integrationGrids.map(g => `
                <option value="${g.keyword}" ${this.state.grid === g.keyword ? 'selected' : ''}>${g.name}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
              Population Analysis
              <span class="tooltip" data-tooltip="Method to compute atomic charges & electrostatic properties" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <select id="pop-select" class="form-select">
              ${populationAnalysis.map(p => `
                <option value="${p.keyword}" ${this.state.pop === p.keyword ? 'selected' : ''}>${p.name}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
              Output Verbosity
              <span class="tooltip" data-tooltip="Volume of detail generated in the final Gaussian log output" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
            </label>
            <select id="verbosity-select" class="form-select">
              ${outputVerbosity.map(v => `
                <option value="${v.prefix}" ${this.state.verbosity === v.prefix ? 'selected' : ''}>${v.name} (${v.prefix})</option>
              `).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Solvation -->
      <div class="section animate-in" style="animation-delay: 0.25s">
        <div class="section-header collapsible" data-section="solv-content">
          <div class="section-title">
            <span class="section-icon">💧</span>
            Solvation
          </div>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-content" id="solv-content">
          <div class="form-group">
            <label class="toggle-row" style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="solvation-toggle" class="form-checkbox" ${this.state.solvation ? 'checked' : ''} />
              <span class="toggle-label">Enable implicit solvation</span>
              <span class="tooltip" data-tooltip="Simulate solvent environments instead of gas phase" style="cursor: help; opacity: 0.6; font-size: 11px;">ℹ️</span>
            </label>
          </div>
          <div id="solvation-options" class="${this.state.solvation ? '' : 'hidden'}">
            <div class="form-group">
              <label class="form-label">Solvation Model</label>
              <select id="solv-model-select" class="form-select">
                ${solvationModels.map(m => `
                  <option value="${m.keyword}" ${this.state.solvationModel === m.keyword ? 'selected' : ''}>${m.name}</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Solvent</label>
              <input type="text" id="solvent-search" class="form-input search-input" placeholder="Search solvents..." />
              <div class="solvent-list" id="solvent-list">
                ${this.renderSolventList()}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Title & Custom -->
      <div class="section animate-in" style="animation-delay: 0.3s">
        <div class="section-header collapsible" data-section="title-content">
          <div class="section-title">
            <span class="section-icon">📝</span>
            Title & Custom
          </div>
          <svg class="section-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="section-content" id="title-content">
          <div class="form-group">
            <label class="form-label" for="title-input">Job Title</label>
            <input type="text" id="title-input" class="form-input" value="${this.state.title}" placeholder="Description of calculation" />
          </div>
          <div class="form-group">
            <label class="form-label" for="custom-keywords">Extra Keywords</label>
            <input type="text" id="custom-keywords" class="form-input" value="${this.state.customKeywords}" placeholder="e.g. NoSymm GFPrint" />
            <span class="form-hint">Added verbatim to the route section</span>
          </div>
        </div>
      </div>
    `;

    // Re-check heavy atoms alert to preserve correct warning visibility state after render
    this.updateForAtoms(this.hasHeavyAtoms ? [{ symbol: 'Sc' }] : []);
  }

  renderJobList(search = '') {
    let filtered = jobTypes;
    if (search) {
      const s = search.toLowerCase();
      filtered = jobTypes.filter(j => j.name.toLowerCase().includes(s) || j.keyword.toLowerCase().includes(s));
    }

    if (filtered.length === 0) {
      return '<div class="list-empty">No matching job types found</div>';
    }

    return filtered.map(j => `
      <button type="button" class="dropdown-list-item ${this.state.jobType === j.keyword ? 'active' : ''}" data-job="${j.keyword}" title="${j.description}">
        <div class="dropdown-item-meta">
          <span class="dropdown-item-title">${j.name}</span>
          <span class="dropdown-item-subtitle">${j.keyword}</span>
        </div>
        <div class="dropdown-item-desc">${j.description}</div>
      </button>
    `).join('');
  }

  renderMethodList(category, search = '') {
    let filtered = methods.filter(m => m.category === category);
    if (search) {
      const s = search.toLowerCase();
      filtered = methods.filter(m =>
        (m.category === category) &&
        (m.keyword.toLowerCase().includes(s) || m.name.toLowerCase().includes(s))
      );
    }

    if (filtered.length === 0) {
      return '<div class="list-empty">No methods found</div>';
    }

    // Group by subcategory
    const groups = {};
    filtered.forEach(m => {
      const key = m.subcategory || 'General';
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });

    return Object.entries(groups).map(([subcat, items]) => `
      <div class="dropdown-list-group">
        <div class="dropdown-list-group-label">${subcat}</div>
        ${items.map(m => `
          <button type="button" class="dropdown-list-item ${this.state.method === m.keyword ? 'active' : ''}" 
                  data-method="${m.keyword}" title="${m.description || m.name}">
            <div class="dropdown-item-meta">
              <span class="dropdown-item-title">${m.keyword}</span>
              <span class="dropdown-item-subtitle">${m.name}</span>
            </div>
            ${m.popular ? '<span class="badge badge-popular">★</span>' : ''}
          </button>
        `).join('')}
      </div>
    `).join('');
  }

  renderBasisList(category, search = '') {
    let filtered = basisSets.filter(b => b.category === category);
    if (search) {
      const s = search.toLowerCase();
      filtered = basisSets.filter(b =>
        (b.category === category) &&
        (b.keyword.toLowerCase().includes(s) || b.name.toLowerCase().includes(s))
      );
    }

    if (filtered.length === 0) {
      return '<div class="list-empty">No basis sets found</div>';
    }

    return filtered.map(b => `
      <button type="button" class="dropdown-list-item ${this.state.basisSet === b.keyword ? 'active' : ''}" 
              data-basis="${b.keyword}" title="${b.description || b.name}">
        <div class="dropdown-item-meta">
          <span class="dropdown-item-title">${b.keyword}</span>
          <span class="dropdown-item-subtitle">${b.name}</span>
        </div>
        <div class="basis-meta-wrap">
          <span class="basis-size-bar">
            ${Array(5).fill(0).map((_, i) => `<span class="size-dot ${i < b.size ? 'filled' : ''}"></span>`).join('')}
          </span>
          ${b.popular ? '<span class="badge badge-popular">★</span>' : ''}
        </div>
      </button>
    `).join('');
  }

  renderSolventList(search = '') {
    let filtered = solvents;
    if (search) {
      const s = search.toLowerCase();
      filtered = solvents.filter(sv =>
        sv.name.toLowerCase().includes(s) || sv.keyword.toLowerCase().includes(s)
      );
    }

    // Show popular first
    const popular = filtered.filter(s => s.popular);
    const rest = filtered.filter(s => !s.popular);
    const sorted = [...popular, ...rest];

    return sorted.map(s => `
      <button type="button" class="list-item solvent-item ${this.state.solvent === s.keyword ? 'active' : ''}"
              data-solvent="${s.keyword}">
        <span class="list-item-name">${s.name}</span>
        <span class="list-item-desc">ε=${s.dielectric}</span>
        ${s.popular ? '<span class="badge badge-popular">★</span>' : ''}
      </button>
    `).join('');
  }

  setupDropdownToggle(triggerSelector, dropdownSelector, otherDropdownSelectors) {
    const trigger = this.container.querySelector(triggerSelector);
    const dropdown = this.container.querySelector(dropdownSelector);
    const wrap = trigger ? trigger.closest('.custom-select-wrap') : null;
    if (trigger && dropdown && wrap) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const willShow = dropdown.classList.contains('hidden');

        // Close others
        otherDropdownSelectors.forEach(selector => {
          const otherDropdown = this.container.querySelector(selector);
          const otherTrigger = this.container.querySelector(selector.replace('-dropdown', '-trigger'));
          const otherWrap = otherTrigger ? otherTrigger.closest('.custom-select-wrap') : null;
          if (otherDropdown) otherDropdown.classList.add('hidden');
          if (otherTrigger) otherTrigger.classList.remove('active');
          if (otherWrap) otherWrap.classList.remove('active');
        });

        if (willShow) {
          dropdown.classList.remove('hidden');
          trigger.classList.add('active');
          wrap.classList.add('active');
        } else {
          dropdown.classList.add('hidden');
          trigger.classList.remove('active');
          wrap.classList.remove('active');
        }
      });
    }
  }

  bindEvents() {
    // Collapsible sections
    this.container.querySelectorAll('.section-header.collapsible').forEach(header => {
      header.addEventListener('click', () => {
        const sectionId = header.dataset.section;
        const content = this.container.querySelector(`#${sectionId}`);
        if (content) {
          content.classList.toggle('collapsed');
          header.classList.toggle('collapsed');
        }
      });
    });

    // Custom select dropdown triggers
    this.setupDropdownToggle('#job-trigger', '#job-dropdown', ['#method-dropdown', '#basis-dropdown']);
    this.setupDropdownToggle('#method-trigger', '#method-dropdown', ['#job-dropdown', '#basis-dropdown']);
    this.setupDropdownToggle('#basis-trigger', '#basis-dropdown', ['#job-dropdown', '#method-dropdown']);

    // Outside clicks close dropdowns
    document.addEventListener('click', (e) => {
      ['job', 'method', 'basis'].forEach(key => {
        const dropdown = this.container.querySelector(`#${key}-dropdown`);
        const trigger = this.container.querySelector(`#${key}-trigger`);
        const wrap = trigger ? trigger.closest('.custom-select-wrap') : null;
        if (dropdown && !dropdown.contains(e.target) && trigger && !trigger.contains(e.target)) {
          dropdown.classList.add('hidden');
          if (trigger) trigger.classList.remove('active');
          if (wrap) wrap.classList.remove('active');
        }
      });
    });

    // Bind item selection clicks
    this.bindJobClicks();
    this.bindMethodClicks();
    this.bindBasisClicks();
    this.bindSolventClicks();

    // Setup input searches
    const jobSearch = this.container.querySelector('#job-search');
    if (jobSearch) {
      jobSearch.addEventListener('click', (e) => e.stopPropagation());
      jobSearch.addEventListener('input', () => {
        const query = jobSearch.value.trim();
        this.container.querySelector('#job-list').innerHTML = this.renderJobList(query);
        this.bindJobClicks();
      });
    }

    const methodSearch = this.container.querySelector('#method-search');
    if (methodSearch) {
      methodSearch.addEventListener('click', (e) => e.stopPropagation());
      methodSearch.addEventListener('input', () => {
        const query = methodSearch.value.trim();
        this.container.querySelector('#method-list').innerHTML = this.renderMethodList(this.state.methodCategory, query);
        this.bindMethodClicks();
      });
    }

    const basisSearch = this.container.querySelector('#basis-search');
    if (basisSearch) {
      basisSearch.addEventListener('click', (e) => e.stopPropagation());
      basisSearch.addEventListener('input', () => {
        const query = basisSearch.value.trim();
        this.container.querySelector('#basis-list').innerHTML = this.renderBasisList(this.state.basisSetCategory, query);
        this.bindBasisClicks();
      });
    }

    // Method category tabs
    this.container.querySelectorAll('#method-tabs [data-method-cat]').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.methodCategory = tab.dataset.methodCat;
        this.container.querySelectorAll('#method-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.container.querySelector('#method-list').innerHTML = this.renderMethodList(this.state.methodCategory, methodSearch.value.trim());
        this.bindMethodClicks();
      });
    });

    // Basis category tabs
    this.container.querySelectorAll('#basis-tabs [data-basis-cat]').forEach(tab => {
      tab.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.basisSetCategory = tab.dataset.basisCat;
        this.container.querySelectorAll('#basis-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.container.querySelector('#basis-list').innerHTML = this.renderBasisList(this.state.basisSetCategory, basisSearch.value.trim());
        this.bindBasisClicks();
      });
    });

    // Solvent search
    const solventSearch = this.container.querySelector('#solvent-search');
    if (solventSearch) {
      solventSearch.addEventListener('input', () => {
        const search = solventSearch.value.trim();
        this.container.querySelector('#solvent-list').innerHTML = this.renderSolventList(search);
        this.bindSolventClicks();
      });
    }

    // Solvation toggle
    const solvToggle = this.container.querySelector('#solvation-toggle');
    if (solvToggle) {
      solvToggle.addEventListener('change', () => {
        this.state.solvation = solvToggle.checked;
        const options = this.container.querySelector('#solvation-options');
        if (options) options.classList.toggle('hidden', !solvToggle.checked);
        this.notifyChange();
      });
    }

    this.bindSelect('#dispersion-select', 'dispersion');
    this.bindSelect('#scf-select', 'scf');
    this.bindSelect('#grid-select', 'grid');
    this.bindSelect('#pop-select', 'pop');
    this.bindSelect('#verbosity-select', 'verbosity');
    this.bindSelect('#solv-model-select', 'solvationModel');

    // Link 0 inputs
    this.bindInput('#memory-input', 'memory');
    this.bindSelect('#memory-unit', 'memoryUnit');
    this.bindInput('#nproc-input', 'nproc');
    this.bindInput('#chk-input', 'checkpoint');

    // Title & custom
    this.bindInput('#title-input', 'title');
    this.bindInput('#custom-keywords', 'customKeywords');
  }

  bindSelect(selector, key) {
    const el = this.container.querySelector(selector);
    if (el) {
      el.addEventListener('change', () => {
        this.state[key] = el.value;
        this.notifyChange();
      });
    }
  }

  bindInput(selector, key) {
    const el = this.container.querySelector(selector);
    if (el) {
      el.addEventListener('input', () => {
        this.state[key] = el.value;
        this.notifyChange();
      });
    }
  }

  bindJobClicks() {
    this.container.querySelectorAll('#job-list [data-job]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.jobType = item.dataset.job;
        
        // Close dropdown
        const dropdown = this.container.querySelector('#job-dropdown');
        const trigger = this.container.querySelector('#job-trigger');
        const wrap = trigger ? trigger.closest('.custom-select-wrap') : null;
        if (dropdown) dropdown.classList.add('hidden');
        if (trigger) {
          trigger.classList.remove('active');
          trigger.querySelector('.trigger-val').textContent = this.getSelectedJobName();
        }
        if (wrap) wrap.classList.remove('active');

        // Update active class
        this.container.querySelectorAll('#job-list .dropdown-list-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        this.notifyChange();
      });
    });
  }

  bindMethodClicks() {
    this.container.querySelectorAll('#method-list [data-method]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.method = item.dataset.method;

        // Close dropdown
        const dropdown = this.container.querySelector('#method-dropdown');
        const trigger = this.container.querySelector('#method-trigger');
        const wrap = trigger ? trigger.closest('.custom-select-wrap') : null;
        if (dropdown) dropdown.classList.add('hidden');
        if (trigger) {
          trigger.classList.remove('active');
          trigger.querySelector('.trigger-val').innerHTML = `
            ${this.state.method}
            <span class="trigger-val-badge">${this.state.methodCategory}</span>
          `;
        }
        if (wrap) wrap.classList.remove('active');

        // Update active class
        this.container.querySelectorAll('#method-list .dropdown-list-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Check if method needs basis set
        const methodDef = methods.find(m => m.keyword === this.state.method);
        const basisTrigger = this.container.querySelector('#basis-trigger');
        if (methodDef && methodDef.needsBasis === false) {
          this.state.basisSet = '';
          if (basisTrigger) {
            basisTrigger.setAttribute('disabled', 'true');
            basisTrigger.querySelector('.trigger-val').innerHTML = 'N/A';
          }
        } else {
          if (basisTrigger) {
            basisTrigger.removeAttribute('disabled');
            if (this.state.basisSet === '') {
              this.state.basisSet = '6-31G(d)';
              this.state.basisSetCategory = 'Pople';
            }
            basisTrigger.querySelector('.trigger-val').innerHTML = `
              ${this.state.basisSet}
              <span class="trigger-val-badge">${this.state.basisSetCategory}</span>
            `;
          }
        }

        this.notifyChange();
      });
    });
  }

  bindBasisClicks() {
    this.container.querySelectorAll('#basis-list [data-basis]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.basisSet = item.dataset.basis;

        // Close dropdown
        const dropdown = this.container.querySelector('#basis-dropdown');
        const trigger = this.container.querySelector('#basis-trigger');
        const wrap = trigger ? trigger.closest('.custom-select-wrap') : null;
        if (dropdown) dropdown.classList.add('hidden');
        if (trigger) {
          trigger.classList.remove('active');
          trigger.querySelector('.trigger-val').innerHTML = `
            ${this.state.basisSet}
            <span class="trigger-val-badge">${this.state.basisSetCategory}</span>
          `;
        }
        if (wrap) wrap.classList.remove('active');

        // Update active class
        this.container.querySelectorAll('#basis-list .dropdown-list-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        this.notifyChange();
      });
    });
  }

  bindSolventClicks() {
    this.container.querySelectorAll('#solvent-list [data-solvent]').forEach(item => {
      item.addEventListener('click', () => {
        this.state.solvent = item.dataset.solvent;
        this.container.querySelectorAll('#solvent-list .list-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        this.notifyChange();
      });
    });
  }

  notifyChange() {
    if (this.onParameterChange) {
      this.onParameterChange(this.getState());
    }
  }

  /** Update heavy atom notice based on molecule atoms */
  updateForAtoms(atoms) {
    const heavyMetals = ['Sc','Ti','V','Cr','Mn','Fe','Co','Ni','Cu','Zn',
                         'Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd','Ag','Cd',
                         'Hf','Ta','W','Re','Os','Ir','Pt','Au','Hg',
                         'La','Ce','Pr','Nd','Pm','Sm','Eu','Gd','Tb','Dy','Ho','Er','Tm','Yb','Lu'];
    this.hasHeavyAtoms = atoms.some(a => heavyMetals.includes(a.symbol));
    const notice = this.container.querySelector('#heavy-atom-notice');
    if (notice) {
      notice.classList.toggle('hidden', !this.hasHeavyAtoms);
    }
  }

  /** Apply a preset configuration */
  applyPreset(preset) {
    const s = preset.settings;
    if (s.method !== undefined) this.state.method = s.method;
    if (s.basisSet !== undefined) this.state.basisSet = s.basisSet;
    if (s.jobType !== undefined) this.state.jobType = s.jobType;
    if (s.dispersion !== undefined) this.state.dispersion = s.dispersion;
    if (s.scf !== undefined) this.state.scf = s.scf;
    if (s.grid !== undefined) this.state.grid = s.grid;
    if (s.solvation !== undefined) this.state.solvation = s.solvation;
    if (s.solvationModel !== undefined) this.state.solvationModel = s.solvationModel;
    if (s.solvent !== undefined) this.state.solvent = s.solvent;
    if (s.pop !== undefined) this.state.pop = s.pop;

    // Check method subcategory to set methodCategory correctly
    const methodDef = methods.find(m => m.keyword === this.state.method);
    if (methodDef) {
      this.state.methodCategory = methodDef.category;
    }

    // Check basis set category to set basisSetCategory correctly
    const basisDef = basisSets.find(b => b.keyword === this.state.basisSet);
    if (basisDef) {
      this.state.basisSetCategory = basisDef.category;
    }

    // Re-render to update UI
    this.render();
    this.bindEvents();
    this.notifyChange();
  }

  /** Get current state for GJF generation */
  getState() {
    return { ...this.state };
  }
}
