/**
 * Header component
 * Handles presets dropdown, copy, and export actions from the main app header
 */

import { presets } from '../data/presets.js';

export class Header {
  /**
   * @param {Object} callbacks
   * @param {Function} callbacks.onPresetSelect - Callback when a preset is chosen
   * @param {Function} callbacks.onCopy - Callback when copy button is clicked
   * @param {Function} callbacks.onExport - Callback when export button is clicked
   */
  constructor({ onPresetSelect, onCopy, onExport }) {
    this.onPresetSelect = onPresetSelect;
    this.onCopy = onCopy;
    this.onExport = onExport;

    this.presetBtn = document.getElementById('preset-btn');
    this.presetDropdown = document.getElementById('preset-dropdown');
    this.copyBtn = document.getElementById('copy-btn');
    this.exportBtn = document.getElementById('export-btn');

    this.init();
  }

  init() {
    this.renderPresets();
    this.bindEvents();
  }

  renderPresets() {
    if (!this.presetDropdown) return;

    this.presetDropdown.innerHTML = presets.map(p => `
      <div class="preset-card" data-preset-id="${p.id}" title="${p.description}">
        <div class="preset-icon">${p.icon}</div>
        <div class="preset-info">
          <div class="preset-name">${p.name}</div>
          <div class="preset-desc">${p.description}</div>
        </div>
      </div>
    `).join('');
  }

  bindEvents() {
    // Preset dropdown toggle
    if (this.presetBtn && this.presetDropdown) {
      this.presetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.presetDropdown.classList.toggle('hidden');
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!this.presetDropdown.contains(e.target) && !this.presetBtn.contains(e.target)) {
          this.presetDropdown.classList.add('hidden');
        }
      });
    }

    // Preset selection
    if (this.presetDropdown) {
      this.presetDropdown.addEventListener('click', (e) => {
        const card = e.target.closest('.preset-card');
        if (card) {
          const presetId = card.dataset.presetId;
          const preset = presets.find(p => p.id === presetId);
          if (preset && this.onPresetSelect) {
            this.onPresetSelect(preset);
          }
          this.presetDropdown.classList.add('hidden');
        }
      });
    }

    // Copy action
    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', () => {
        if (this.onCopy) this.onCopy();
      });
    }

    // Export action
    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', () => {
        if (this.onExport) this.onExport();
      });
    }
  }
}
