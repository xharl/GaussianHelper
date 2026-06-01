/**
 * Viewer3D component
 * Wraps 3Dmol.js for interactive 3D molecular visualization
 */

export class Viewer3D {
  /**
   * @param {HTMLElement} container
   */
  constructor(container) {
    this.container = container;
    this.viewer = null;
    this.currentStyle = 'stick';
    this.render();
  }

  render() {
    this.container.innerHTML = `
      <div class="viewer-wrapper">
        <div class="viewer-container" id="viewer-3d">
          <div class="viewer-placeholder" id="viewer-placeholder">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.25">
              <circle cx="12" cy="12" r="3"/>
              <circle cx="5" cy="5" r="2"/>
              <circle cx="19" cy="5" r="2"/>
              <circle cx="5" cy="19" r="2"/>
              <circle cx="19" cy="19" r="2"/>
              <line x1="7" y1="7" x2="10" y2="10"/>
              <line x1="14" y1="10" x2="17" y2="7"/>
              <line x1="10" y1="14" x2="7" y2="17"/>
              <line x1="14" y1="14" x2="17" y2="17"/>
            </svg>
            <span>Load a molecule to view in 3D</span>
          </div>
        </div>
        <div class="viewer-controls">
          <button class="btn btn-ghost btn-icon btn-sm viewer-style-btn active" data-style="stick" title="Stick">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm viewer-style-btn" data-style="ballstick" title="Ball & Stick">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="7" cy="17" r="3"/><circle cx="17" cy="7" r="3"/><line x1="9" y1="15" x2="15" y2="9"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm viewer-style-btn" data-style="sphere" title="Spacefill">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>
          </button>
          <div class="viewer-divider"></div>
          <button class="btn btn-ghost btn-icon btn-sm" id="viewer-reset" title="Reset view">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
          </button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Style buttons
    this.container.querySelectorAll('.viewer-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.currentStyle = btn.dataset.style;
        this.container.querySelectorAll('.viewer-style-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyStyle();
      });
    });

    // Reset
    const resetBtn = this.container.querySelector('#viewer-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (this.viewer) {
          this.viewer.zoomTo();
          this.viewer.render();
        }
      });
    }
  }

  /**
   * Initialize or reinitialize the 3Dmol viewer
   */
  initViewer() {
    if (typeof $3Dmol === 'undefined') {
      console.warn('3Dmol.js not loaded yet');
      return false;
    }

    const viewerDiv = this.container.querySelector('#viewer-3d');
    if (!viewerDiv) return false;

    // Hide placeholder
    const placeholder = this.container.querySelector('#viewer-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    // Clear and recreate viewer
    if (this.viewer) {
      // Remove old canvas
      const oldCanvas = viewerDiv.querySelector('canvas');
      if (oldCanvas) oldCanvas.remove();
      const oldDiv = viewerDiv.querySelector('.viewer-canvas-container');
      if (oldDiv) oldDiv.remove();
    }

    try {
      this.viewer = $3Dmol.createViewer(viewerDiv, {
        backgroundColor: '0x0a0b10',
        antialias: true,
        disableFog: true
      });
      return true;
    } catch (err) {
      console.error('Failed to create 3Dmol viewer:', err);
      return false;
    }
  }

  /**
   * Update the displayed molecule
   * @param {Array} atoms - Array of {symbol, x, y, z}
   * @param {string} [molfile] - Optional MOL file content
   */
  updateMolecule(atoms, molfile = '') {
    if (!atoms || atoms.length === 0) {
      this.pendingUpdate = null;
      return;
    }

    this.pendingUpdate = { atoms, molfile };

    if (!this.viewer) {
      if (!this.initViewer()) {
        // 3Dmol.js not loaded yet (deferred CDN), start polling
        if (!this.isPolling3Dmol) {
          this.isPolling3Dmol = true;
          const poll = () => {
            if (this.initViewer()) {
              this.isPolling3Dmol = false;
              if (this.pendingUpdate) {
                this.updateMolecule(this.pendingUpdate.atoms, this.pendingUpdate.molfile);
              }
            } else {
              setTimeout(poll, 150);
            }
          };
          setTimeout(poll, 150);
        }
        return;
      }
    }

    this.viewer.removeAllModels();

    if (molfile) {
      // Use MOL file for better bond info
      try {
        this.viewer.addModel(molfile, 'mol');
      } catch (e) {
        // Fallback to XYZ
        this.addAtomsAsXYZ(atoms);
      }
    } else {
      this.addAtomsAsXYZ(atoms);
    }

    this.applyStyle();
    this.viewer.zoomTo();
    this.viewer.render();
  }

  /**
   * Add atoms as XYZ format to the viewer
   */
  addAtomsAsXYZ(atoms) {
    const xyzLines = [
      atoms.length.toString(),
      'GaussianHelper molecule',
      ...atoms.map(a => `${a.symbol} ${a.x.toFixed(6)} ${a.y.toFixed(6)} ${a.z.toFixed(6)}`)
    ];
    this.viewer.addModel(xyzLines.join('\n'), 'xyz');
  }

  /**
   * Apply the current visualization style
   */
  applyStyle() {
    if (!this.viewer) return;

    this.viewer.setStyle({}, {}); // Clear styles

    switch (this.currentStyle) {
      case 'stick':
        this.viewer.setStyle({}, {
          stick: { radius: 0.15, colorscheme: 'Jmol' }
        });
        break;
      case 'ballstick':
        this.viewer.setStyle({}, {
          stick: { radius: 0.12, colorscheme: 'Jmol' },
          sphere: { scale: 0.25, colorscheme: 'Jmol' }
        });
        break;
      case 'sphere':
        this.viewer.setStyle({}, {
          sphere: { colorscheme: 'Jmol' }
        });
        break;
    }

    // Add labels on hover is handled by 3Dmol internally
    this.viewer.render();
  }
}
