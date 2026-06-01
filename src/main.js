/**
 * Main Application Orchestrator
 * Wires together MoleculeInput, ParameterPanel, GJFPreview, Viewer3D, and Header
 */

import './styles/index.css';
import './styles/layout.css';
import './styles/components.css';

import { MoleculeInput } from './components/MoleculeInput.js';
import { ParameterPanel } from './components/ParameterPanel.js';
import { GJFPreview } from './components/GJFPreview.js';
import { Viewer3D } from './components/Viewer3D.js';
import { Header } from './components/Header.js';
import { BatchGenerator } from './components/BatchGenerator.js';
import { getHillFormula } from './utils/elements.js';

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const moleculePanel = document.getElementById('molecule-panel');
  const parameterPanelContainer = document.getElementById('parameter-panel');
  const outputPanel = document.getElementById('output-panel');

  if (!moleculePanel || !parameterPanelContainer || !outputPanel) {
    console.error('Core UI containers not found');
    return;
  }

  // Set up sub-containers in output panel (with tabs)
  outputPanel.innerHTML = `
    <div class="tab-bar" id="output-tabs" style="margin-bottom: var(--space-4);">
      <button type="button" class="tab active" data-output-tab="calc">Current Job</button>
      <button type="button" class="tab" data-output-tab="batch">Batch Queue</button>
    </div>
    <div id="calc-tab-content" class="tab-panel-content animate-in">
      <div id="viewer-container-target" class="animate-in"></div>
      <div id="preview-container-target" class="animate-in" style="animation-delay: 0.05s; margin-top: var(--space-4);"></div>
    </div>
    <div id="batch-tab-content" class="tab-panel-content hidden animate-in"></div>
  `;

  const viewerContainer = document.getElementById('viewer-container-target');
  const previewContainer = document.getElementById('preview-container-target');
  const batchTabContent = document.getElementById('batch-tab-content');

  // Wire up tab switching
  const tabButtons = outputPanel.querySelectorAll('#output-tabs .tab');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const target = btn.dataset.outputTab;
      if (target === 'calc') {
        document.getElementById('calc-tab-content').classList.remove('hidden');
        document.getElementById('batch-tab-content').classList.add('hidden');
        // Redraw 3D viewer if needed because its container size changed
        if (viewer3d && viewer3d.viewer) {
          viewer3d.viewer.zoomTo();
          viewer3d.viewer.render();
        }
      } else {
        document.getElementById('calc-tab-content').classList.add('hidden');
        document.getElementById('batch-tab-content').classList.remove('hidden');
      }
    });
  });

  const showBatchTab = () => {
    tabButtons.forEach(b => {
      if (b.dataset.outputTab === 'batch') {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
    document.getElementById('calc-tab-content').classList.add('hidden');
    document.getElementById('batch-tab-content').classList.remove('hidden');
  };


  // Initialize components
  const viewer3d = new Viewer3D(viewerContainer);
  
  let batchGenerator;

  const gjfPreview = new GJFPreview(previewContainer, () => {
    if (batchGenerator) {
      batchGenerator.addActiveJobToQueue();
      showBatchTab();
    }
  });

  const parameterPanel = new ParameterPanel(parameterPanelContainer, (params) => {
    // When parameters change, update GJF preview
    const moleculeState = moleculeInput.getState();
    gjfPreview.update(params, moleculeState);
  });

  const moleculeInput = new MoleculeInput(moleculePanel, (molState) => {
    // When molecule changes:
    // 1. Update parameter panel (e.g. heavy atom check)
    parameterPanel.updateForAtoms(molState.atoms);

    // 2. Update 3D viewer
    viewer3d.updateMolecule(molState.atoms, molState.molfile);

    // 3. Update GJF preview
    const paramsState = parameterPanel.getState();
    gjfPreview.update(paramsState, molState);
  });

  batchGenerator = new BatchGenerator(batchTabContent, () => {
    const params = parameterPanel.getState();
    const molState = moleculeInput.getState();
    const gjfText = gjfPreview.getGJF();

    let baseName = 'gaussian_input';
    if (params.checkpoint) {
      baseName = params.checkpoint.replace(/\.chk$/, '');
    } else if (molState.atoms && molState.atoms.length > 0) {
      baseName = getHillFormula(molState.atoms).toLowerCase();
    }

    return {
      gjfText: gjfText,
      inputName: `${baseName}.gjf`,
      outputName: `${baseName}.log`
    };
  });

  // Pre-load default simple molecule (Water) on startup
  const smilesInput = document.getElementById('smiles-input');
  if (smilesInput) {
    smilesInput.value = 'O';
    moleculeInput.loadSMILES(true);
  }

  // Header controls
  new Header({
    onPresetSelect: (preset) => {
      parameterPanel.applyPreset(preset);
      showToast(`Loaded preset: ${preset.name}`, 'success');
    },
    onCopy: () => {
      gjfPreview.copyToClipboard();
    },
    onExport: () => {
      const gjfText = gjfPreview.getGJF();
      if (!gjfText || gjfText.trim() === '') {
        showToast('Draw/load a molecule to export GJF file', 'warning');
        return;
      }

      const params = parameterPanel.getState();
      const molState = moleculeInput.getState();
      let filename = 'gaussian_input.gjf';
      if (params.checkpoint) {
        filename = params.checkpoint.replace(/\.chk$/, '') + '.gjf';
      } else if (molState.atoms && molState.atoms.length > 0) {
        filename = `${getHillFormula(molState.atoms).toLowerCase()}.gjf`;
      }

      const blob = new Blob([gjfText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast(`Exported GJF as ${filename}`, 'success');
    }
  });

  // Help Modal Controls
  const helpBtn = document.getElementById('help-btn');
  const helpModal = document.getElementById('help-modal');
  const closeHelpBtn = document.getElementById('close-help-btn');
  const helpCloseFooterBtn = document.getElementById('help-close-footer-btn');

  if (helpBtn && helpModal) {
    const openHelp = () => {
      helpModal.classList.remove('hidden');
    };
    const closeHelp = () => {
      helpModal.classList.add('hidden');
    };

    helpBtn.addEventListener('click', openHelp);
    if (closeHelpBtn) closeHelpBtn.addEventListener('click', closeHelp);
    if (helpCloseFooterBtn) helpCloseFooterBtn.addEventListener('click', closeHelp);

    // Close on overlay click
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        closeHelp();
      }
    });
  }

  // Helper to show global toast notifications
  function showToast(message, type = 'info') {
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
});
