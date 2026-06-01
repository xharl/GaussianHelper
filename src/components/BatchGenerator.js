/**
 * BatchGenerator component
 * Manages a batch queue of Gaussian jobs and exports .bcf or .sh scripts.
 */

export class BatchGenerator {
  /**
   * @param {HTMLElement} container - Container element for the batch queue tab
   * @param {Function} getActiveJob - Callback resolving to the current active job { gjfText, inputName, outputName }
   */
  constructor(container, getActiveJob) {
    this.container = container;
    this.getActiveJob = getActiveJob;
    this.queue = [];
    this.format = 'bcf'; // 'bcf' or 'sh'
    this.startIndex = 1;
    this.bcfComment = 'Gaussian Batch Job';
    this.linuxCmd = 'g16';

    this.render();
    this.bindEvents();
  }

  /**
   * Renders the Batch Queue tab interface
   */
  render() {
    const previewContent = this.generateScriptContent();

    this.container.innerHTML = `
      <div class="batch-generator animate-in">
        <!-- Settings Section -->
        <div class="card" style="margin-bottom: var(--space-4);">
          <div class="card-header">
            <span class="card-title">Batch Configuration</span>
          </div>
          <div class="card-body">
            <div class="form-row" style="display: flex; gap: var(--space-4); flex-wrap: wrap;">
              <div class="form-group" style="flex: 1; min-width: 200px;">
                <label class="form-label" style="display: flex; align-items: center; gap: 4px;">
                  Export Format
                  <span class="tooltip" data-tooltip="Switch script target between Windows Batch Control or Linux Bash shell" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
                </label>
                <div class="tab-bar compact" id="batch-format-selector" style="width: fit-content;">
                  <button type="button" class="tab ${this.format === 'bcf' ? 'active' : ''}" data-format="bcf">Windows (.bcf)</button>
                  <button type="button" class="tab ${this.format === 'sh' ? 'active' : ''}" data-format="sh">Linux (.sh)</button>
                </div>
              </div>

              ${this.format === 'bcf' ? `
                <div class="form-group" style="flex: 1; min-width: 100px;">
                  <label class="form-label" for="batch-start-index" style="display: flex; align-items: center; gap: 4px;">
                    Start Index
                    <span class="tooltip" data-tooltip="First execution job index (Gaussian BCF Start command)" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
                  </label>
                  <input type="number" id="batch-start-index" class="form-input" value="${this.startIndex}" min="1" />
                </div>
                <div class="form-group" style="flex: 2; min-width: 200px;">
                  <label class="form-label" for="batch-comment" style="display: flex; align-items: center; gap: 4px;">
                    Comment
                    <span class="tooltip" data-tooltip="Title comment line written inside the BCF file" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
                  </label>
                  <input type="text" id="batch-comment" class="form-input" value="${this.bcfComment}" placeholder="e.g. Gaussian Batch Job" />
                </div>
              ` : `
                <div class="form-group" style="flex: 2; min-width: 200px;">
                  <label class="form-label" for="batch-linux-cmd" style="display: flex; align-items: center; gap: 4px;">
                    Executable / Command
                    <span class="tooltip" data-tooltip="The command name or path representing your local Gaussian command (e.g. g16, g09)" style="cursor: help; opacity: 0.6; font-size: 11px; text-transform: none;">ℹ️</span>
                  </label>
                  <input type="text" id="batch-linux-cmd" class="form-input" value="${this.linuxCmd}" placeholder="e.g. g16, g09, /usr/local/g16/g16" />
                </div>
              `}
            </div>
          </div>
        </div>

        <!-- Queue Section -->
        <div class="card" style="margin-bottom: var(--space-4);">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="card-title">Job Queue (${this.queue.length})</span>
            <div style="display: flex; gap: var(--space-2);">
              <button id="batch-add-current" class="btn btn-secondary btn-sm" title="Add the currently active GJF configuration to the queue">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Add Current Job
              </button>
              <button id="batch-upload-trigger" class="btn btn-secondary btn-sm" title="Upload existing GJF files from your computer to construct a batch control list">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                Upload GJFs
              </button>
              <input type="file" id="batch-file-input" multiple accept=".gjf" style="display: none;" />
            </div>
          </div>
          
          <div class="card-body" style="padding: 0; overflow-x: auto;">
            ${this.queue.length === 0 ? `
              <div style="padding: var(--space-8); text-align: center; color: var(--text-tertiary);">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto var(--space-3) auto; opacity: 0.5;"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 17h6M9 12h6M9 7h6"/></svg>
                <div style="font-weight: 500; font-size: var(--text-base); color: var(--text-secondary); margin-bottom: var(--space-1);">Queue is empty</div>
                <div style="font-size: var(--text-xs);">Load a molecule and parameter settings to add it, or upload existing .gjf files to build a batch.</div>
              </div>
            ` : `
              <table class="batch-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: var(--text-sm);">
                <thead>
                  <tr style="border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary);">
                    <th style="padding: var(--space-3) var(--space-4); width: 50px;">#</th>
                    <th style="padding: var(--space-3) var(--space-4);">Input Filename (.gjf)</th>
                    <th style="padding: var(--space-3) var(--space-4);">Output Filename (.log)</th>
                    <th style="padding: var(--space-3) var(--space-4); width: 120px; text-align: right;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.queue.map((item, idx) => `
                    <tr data-id="${item.id}" style="border-bottom: 1px solid var(--border-subtle); transition: background-color var(--transition-fast);">
                      <td style="padding: var(--space-3) var(--space-4); color: var(--text-tertiary); font-weight: 500;">${idx + 1}</td>
                      <td style="padding: var(--space-2) var(--space-4);">
                        <input type="text" class="form-input form-input-sm batch-input-filename" value="${item.inputName}" data-field="inputName" />
                      </td>
                      <td style="padding: var(--space-2) var(--space-4);">
                        <input type="text" class="form-input form-input-sm batch-output-filename" value="${item.outputName}" data-field="outputName" />
                      </td>
                      <td style="padding: var(--space-2) var(--space-4); text-align: right;">
                        <button class="btn btn-ghost btn-sm batch-btn-view" title="View GJF Code">👁️</button>
                        <button class="btn btn-ghost btn-sm btn-danger batch-btn-delete" title="Delete job">✕</button>
                      </td>
                    </tr>
                    <tr class="batch-gjf-preview-row hidden" data-preview-id="${item.id}" style="background: rgba(8, 9, 13, 0.4); border-bottom: 1px solid var(--border-subtle);">
                      <td colspan="4" style="padding: var(--space-3) var(--space-4);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-2);">
                          <span style="font-weight: 600; color: var(--text-accent);">GJF Content Preview</span>
                          <button class="btn btn-secondary btn-sm batch-btn-close-view">Close Preview</button>
                        </div>
                        <pre style="margin: 0; padding: var(--space-3); background: var(--bg-input); border: 1px solid var(--border-primary); border-radius: var(--radius-md); font-family: var(--font-mono); font-size: var(--text-xs); overflow-x: auto; max-height: 250px; color: var(--text-primary); white-space: pre-wrap; word-break: break-all;">${this.escapeHtml(item.gjfText)}</pre>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              <div style="padding: var(--space-3) var(--space-4); display: flex; justify-content: flex-end; border-top: 1px solid var(--border-subtle);">
                <button id="batch-clear-all" class="btn btn-danger btn-sm">Clear Queue</button>
              </div>
            `}
          </div>
        </div>

        <!-- Script Output Preview -->
        <div class="card">
          <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="card-title">${this.format === 'bcf' ? 'Batch Control File (.bcf)' : 'Bash Script (.sh)'} Preview</span>
            <div style="display: flex; gap: var(--space-2);">
              <button id="batch-download-gjf-all" class="btn btn-secondary btn-sm" ${this.queue.length === 0 ? 'disabled' : ''} title="Download all .gjf files in the queue">
                Download GJFs
              </button>
              <button id="batch-copy-script" class="btn btn-ghost btn-sm" ${this.queue.length === 0 ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                Copy
              </button>
              <button id="batch-download-script" class="btn btn-primary btn-sm" ${this.queue.length === 0 ? 'disabled' : ''}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                Download Script
              </button>
            </div>
          </div>
          <div class="card-body" style="padding: 0;">
            <div class="code-preview" style="border: none; border-radius: 0;">
              <div class="code-body" style="max-height: 300px;">
                <div class="code-content" style="padding: var(--space-4); font-size: var(--text-sm);">
                  ${this.queue.length === 0 ? `
                    <div style="color: var(--text-tertiary); text-align: center; padding: var(--space-4);">
                      Preview will be generated here when calculations are added to the queue.
                    </div>
                  ` : `
                    <code style="font-family: var(--font-mono); color: var(--text-primary); white-space: pre-wrap;">${this.escapeHtml(previewContent)}</code>
                  `}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Bind event listeners to DOM elements
   */
  bindEvents() {
    // Format selector
    const formatButtons = this.container.querySelectorAll('#batch-format-selector .tab');
    formatButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.format = btn.dataset.format;
        this.render();
        this.bindEvents();
      });
    });

    // Start Index input
    const startIndexInput = this.container.querySelector('#batch-start-index');
    if (startIndexInput) {
      startIndexInput.addEventListener('input', (e) => {
        this.startIndex = parseInt(e.target.value, 10) || 1;
        this.updatePreviewBlock();
      });
    }

    // Comment input
    const commentInput = this.container.querySelector('#batch-comment');
    if (commentInput) {
      commentInput.addEventListener('input', (e) => {
        this.bcfComment = e.target.value;
        this.updatePreviewBlock();
      });
    }

    // Linux Cmd input
    const linuxCmdInput = this.container.querySelector('#batch-linux-cmd');
    if (linuxCmdInput) {
      linuxCmdInput.addEventListener('input', (e) => {
        this.linuxCmd = e.target.value;
        this.updatePreviewBlock();
      });
    }

    // Add current job
    const addCurrentBtn = this.container.querySelector('#batch-add-current');
    if (addCurrentBtn) {
      addCurrentBtn.addEventListener('click', () => {
        this.addActiveJobToQueue();
      });
    }

    // Upload GJF trigger
    const uploadTrigger = this.container.querySelector('#batch-upload-trigger');
    const fileInput = this.container.querySelector('#batch-file-input');
    if (uploadTrigger && fileInput) {
      uploadTrigger.addEventListener('click', () => {
        fileInput.click();
      });

      fileInput.addEventListener('change', (e) => {
        this.handleGJFUpload(e.target.files);
        // Clear value so the same file can be uploaded again
        fileInput.value = '';
      });
    }

    // Clear all
    const clearAllBtn = this.container.querySelector('#batch-clear-all');
    if (clearAllBtn) {
      clearAllBtn.addEventListener('click', () => {
        this.queue = [];
        this.render();
        this.bindEvents();
        this.showToast('Batch queue cleared', 'info');
      });
    }

    // Table item input fields (edit in place)
    const tableInputs = this.container.querySelectorAll('.batch-table input');
    tableInputs.forEach(input => {
      input.addEventListener('change', (e) => {
        const tr = e.target.closest('tr');
        const id = tr.dataset.id;
        const field = e.target.dataset.field;
        const value = e.target.value.trim();

        const item = this.queue.find(x => x.id === id);
        if (item && value) {
          item[field] = value;
          this.updatePreviewBlock();
        }
      });
    });

    // Delete buttons
    const deleteButtons = this.container.querySelectorAll('.batch-btn-delete');
    deleteButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        const id = tr.dataset.id;
        this.queue = this.queue.filter(x => x.id !== id);
        this.render();
        this.bindEvents();
      });
    });

    // View GJF buttons
    const viewButtons = this.container.querySelectorAll('.batch-btn-view');
    viewButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tr = e.target.closest('tr');
        const id = tr.dataset.id;
        const previewRow = this.container.querySelector(`tr[data-preview-id="${id}"]`);
        if (previewRow) {
          previewRow.classList.toggle('hidden');
        }
      });
    });

    // Close preview buttons
    const closeViewButtons = this.container.querySelectorAll('.batch-btn-close-view');
    closeViewButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const previewRow = e.target.closest('tr');
        previewRow.classList.add('hidden');
      });
    });

    // Copy script
    const copyBtn = this.container.querySelector('#batch-copy-script');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const script = this.generateScriptContent();
        this.copyToClipboard(script);
      });
    }

    // Download script
    const downloadScriptBtn = this.container.querySelector('#batch-download-script');
    if (downloadScriptBtn) {
      downloadScriptBtn.addEventListener('click', () => {
        this.downloadScriptFile();
      });
    }

    // Download all GJFs
    const downloadGJFallBtn = this.container.querySelector('#batch-download-gjf-all');
    if (downloadGJFallBtn) {
      downloadGJFallBtn.addEventListener('click', () => {
        this.downloadAllGJFFiles();
      });
    }
  }

  /**
   * Adds the currently active GJF job to the queue
   */
  addActiveJobToQueue() {
    const job = this.getActiveJob();
    if (!job || !job.gjfText || job.gjfText.trim() === '') {
      this.showToast('No active GJF. Please load a molecule and setup parameters.', 'warning');
      return;
    }

    // Generate unique filenames to prevent duplicates in the queue
    let inputName = job.inputName || 'calculation.gjf';
    let outputName = job.outputName || 'calculation.log';

    // Simple collision avoidance
    let counter = 1;
    let finalInputName = inputName;
    let finalOutputName = outputName;
    while (this.queue.some(item => item.inputName === finalInputName)) {
      const extIdx = inputName.lastIndexOf('.');
      const base = extIdx !== -1 ? inputName.substring(0, extIdx) : inputName;
      const ext = extIdx !== -1 ? inputName.substring(extIdx) : '.gjf';
      finalInputName = `${base}_${counter}${ext}`;

      const outExtIdx = outputName.lastIndexOf('.');
      const outBase = outExtIdx !== -1 ? outputName.substring(0, outExtIdx) : outputName;
      const outExt = outExtIdx !== -1 ? outputName.substring(outExtIdx) : '.log';
      finalOutputName = `${outBase}_${counter}${outExt}`;
      counter++;
    }

    const newItem = {
      id: Date.now() + Math.random().toString(36).substring(2, 9),
      inputName: finalInputName,
      outputName: finalOutputName,
      gjfText: job.gjfText
    };

    this.queue.push(newItem);
    this.render();
    this.bindEvents();
    this.showToast(`Added ${finalInputName} to batch queue`, 'success');
  }

  /**
   * Handles multi-file uploads of existing GJF files
   * @param {FileList} files 
   */
  handleGJFUpload(files) {
    if (!files || files.length === 0) return;

    let loadedCount = 0;
    const promises = Array.from(files).map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target.result;
          const inputName = file.name;
          const outputName = inputName.replace(/\.gjf$/i, '') + '.log';

          // Avoid duplicate check
          let finalInputName = inputName;
          let finalOutputName = outputName;
          let counter = 1;
          while (this.queue.some(item => item.inputName === finalInputName)) {
            const base = inputName.replace(/\.gjf$/i, '');
            finalInputName = `${base}_${counter}.gjf`;
            finalOutputName = `${base}_${counter}.log`;
            counter++;
          }

          this.queue.push({
            id: Date.now() + Math.random().toString(36).substring(2, 9) + loadedCount++,
            inputName: finalInputName,
            outputName: finalOutputName,
            gjfText: content
          });
          resolve();
        };
        reader.readAsText(file);
      });
    });

    Promise.all(promises).then(() => {
      this.render();
      this.bindEvents();
      this.showToast(`Uploaded ${files.length} GJF file(s) into queue`, 'success');
    });
  }

  /**
   * Generates the batch script string content based on the selected format
   */
  generateScriptContent() {
    if (this.queue.length === 0) return '';

    if (this.format === 'bcf') {
      const lines = [];
      if (this.bcfComment) {
        lines.push(`! ${this.bcfComment}`);
      }
      lines.push(`Start=${this.startIndex}`);
      this.queue.forEach(item => {
        lines.push(`${item.inputName}, ${item.outputName}`);
      });
      return lines.join('\r\n'); // Windows line endings for BCF
    } else {
      // Linux bash script
      const lines = [
        '#!/bin/bash',
        '# Gaussian Batch Job Script',
        '# Generated by GaussianHelper',
        '',
        '# Check if the Gaussian command exists in path',
        `GAUSSIAN_CMD="${this.linuxCmd}"`,
        'if ! command -v "$GAUSSIAN_CMD" &> /dev/null; then',
        '    echo "Error: $GAUSSIAN_CMD could not be found. Please check your execution command or environment."',
        '    exit 1',
        'fi',
        '',
        'echo "============================================="',
        'echo "Starting Gaussian batch execution..."',
        'echo "============================================="',
        ''
      ];

      this.queue.forEach((item, idx) => {
        lines.push(`echo "[Job ${idx + 1}/${this.queue.length}] Running command: $GAUSSIAN_CMD < ${item.inputName} > ${item.outputName}"`);
        lines.push(`$GAUSSIAN_CMD < "${item.inputName}" > "${item.outputName}"`);
        lines.push('if [ $? -eq 0 ]; then');
        lines.push(`    echo "✓ Job ${idx + 1} completed successfully"`);
        lines.push('else');
        lines.push(`    echo "❌ Error: Job ${idx + 1} (${item.inputName}) failed. Continuing batch..."`);
        lines.push('fi');
        lines.push('');
      });

      lines.push('echo "============================================="');
      lines.push('echo "Gaussian batch run finished."');
      lines.push('echo "============================================="');

      return lines.join('\n');
    }
  }

  /**
   * Updates just the live preview code block without fully rebuilding the DOM
   */
  updatePreviewBlock() {
    const codeBlock = this.container.querySelector('code');
    if (codeBlock) {
      codeBlock.textContent = this.generateScriptContent();
    }
  }

  /**
   * Copies text to the clipboard
   */
  async copyToClipboard(text) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.showToast('Copied to clipboard', 'success');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this.showToast('Copied to clipboard', 'success');
    }
  }

  /**
   * Triggers the download of the batch file
   */
  downloadScriptFile() {
    const script = this.generateScriptContent();
    if (!script) return;

    const isBcf = this.format === 'bcf';
    const filename = isBcf ? 'gaussian_batch.bcf' : 'gaussian_batch.sh';
    const mimeType = isBcf ? 'text/plain' : 'application/x-sh';

    const blob = new Blob([script], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    this.showToast(`Downloaded batch script as ${filename}`, 'success');
  }

  /**
   * Triggers download for all .gjf files in the queue
   */
  downloadAllGJFFiles() {
    if (this.queue.length === 0) return;

    this.queue.forEach((item, idx) => {
      // Small timeout delay between downloads so the browser doesn't block multiple files
      setTimeout(() => {
        const blob = new Blob([item.gjfText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = item.inputName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, idx * 200);
    });

    this.showToast(`Triggered download for ${this.queue.length} GJF file(s)`, 'success');
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    }, 2000);
  }
}
