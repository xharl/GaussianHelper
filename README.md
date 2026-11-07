# GaussianHelper

**Current version: v0.2-alpha**

GaussianHelper is a modern, responsive web application designed for computational chemists to prepare Gaussian Job Files (`.gjf`) and construct/manage sequential batch calculation workflows.

It runs entirely client-side, providing a fast, graphical tool for setting up inputs without any software dependencies. It also supports zero-installation local server launching to bypass CORS security policies.

![GaussianHelper Screenshot](public/screenshot.png)

---

## 🌟 Key Features

- **3D Structure Viewer**: Interactive, premium 3D visualization using ball-and-stick, stick, or spacefill models.
- **Conformer Generator**: Generate 3D coordinates instantly from any chemical SMILES string.
- **Multi-Format Coordinate Parser**: Import structures from `.xyz` coordinate files, standard `.mol` / `.sdf` structures, or ChemDraw `.cdxml` drawings (extracting atomic positions, scaling coords, and handling implicit hydrogens).
- **Theory Level Recommendations**: Smart recommendations for method/basis set combinations based on the calculation type (geometry optimization, energy, frequency, etc.) — helps users pick the right level of theory without deep DFT expertise.
- **理论 & Parameter Setups**: Visual inputs for standard Link 0 commands (memory, processors, checkpoints), job types, method functionalities, basis sets, SCF models, integration grids, dispersion, solvation, and population analyses.
- **Batch Generator & Queue**: Compile multiple calculation configs in a sequence queue, customize inputs/outputs inline, and export them as:
  - **Windows Batch Control Files** (`.bcf`) for Gaussian's native queuing.
  - **Linux Shell Scripts** (`.sh`) for sequential terminal executions (includes start/end timestamp echoes and completion checks).
- **Gaussian Output Inspector**: Inspect multiple `.log` / `.out` files locally. Summarize termination, SCF energy/convergence, optimization markers, frequencies, warnings, and errors with source line evidence; export a batch CSV report.
- **Workflow Workbench**: Organize calculation snapshots as a dependency graph, link checkpoint files with `%OldChk`, export only ready steps, import their logs for explicit validation gates, and save/load a portable local project file.
- **CORS-Bypassing Portable Launchers**:
  - `run.bat` for Windows (uses native PowerShell and .NET listener).
  - `run.sh` for Linux (uses system-native Python 3/2 HTTP server).

---

## 🛠️ Developer Setup & Commands

To set up the development environment, make sure you have [Node.js](https://nodejs.org) installed on your system.

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Local Development Server
Starts a hot-reloading dev server using Vite:
```bash
npm run dev
```

### 3. Run Unit Test Suite
Runs Vitest headlessly to verify element/formula utilities, validation, GJF generation, coordinate parsers, the output inspector, and workflow planning/validation:
```bash
npm test
```

### 4. Build and Package Production Assets
Compiles the client-side code and generates portable distribution archives (`dist.zip`, `dist.tar.gz`) locally via our custom postbuild step:
```bash
npm run build
```

These archives are build outputs and are **not committed** to the repository — `dist/`, `dist.zip` and `dist.tar.gz` are gitignored. Prebuilt bundles are published as GitHub Release assets; see [How to Launch the Portable App](#-how-to-launch-the-portable-app-offline--zero-install).

> **Distribution intent:** `package.json` deliberately keeps `"private": true`. GaussianHelper is a browser application, not an npm library, so an accidental `npm publish` is blocked. Distribution happens through GitHub Releases and source builds.

---

## 🚀 How to Launch the Portable App (Offline / Zero-Install)

No software installation is required. Download `dist.zip` (Windows) or `dist.tar.gz` (Linux) from the [latest release](https://github.com/xharl/GaussianHelper/releases/latest). Release assets are named with the commit they were built from (for example `gaussian-helper-bundle-<sha>.zip`), so a bundle can always be traced back to its source. To build the bundle yourself instead, run `npm run build` as described above.

### 💻 Windows
1. Extract the `dist.zip` archive.
2. Double-click the `run.bat` script.
3. This opens `http://localhost:8080` in your default browser. Close the console when done to stop the local server.

### 🐧 Linux
1. Extract `dist.tar.gz` or `dist.zip`.
2. Open a terminal inside the directory and run:
   ```bash
   ./run.sh
   ```
3. This spins up Python's built-in server and opens the browser. Hit `Ctrl+C` to terminate the server.

## 🔬 Gaussian Output Inspector

Open the **Output Inspector** tab and drop or select multiple Gaussian `.log` / `.out` files. Files are read locally in the browser; the app does not upload or persist them. The inspector reports termination markers, SCF energies and explicit convergence text, optimization markers, frequencies (including negative-mode values), and matching warnings/errors with line references. Export the section-level comparison as CSV.

Statuses are text-derived findings, not proof of scientific correctness. Missing or unrecognized markers remain **unknown** or **incomplete**; absence of a warning is not proof of a successful or valid calculation.

## 🧭 Workflow Workbench

Open **Workflow Workbench** to snapshot the current Gaussian job as a task. Add prerequisites to form a directed acyclic workflow; the list is topologically ordered and rejects cycles. A downstream task stays blocked until every prerequisite output passes. Tasks using `Geom=AllCheck`, `Geom=Checkpoint`, or `Guess=Read` must explicitly depend on a task with a checkpoint; `Geom=AllCheck` inputs omit title/charge/geometry, while `Geom=Checkpoint` inputs retain charge/multiplicity but omit atom coordinates. Generated inputs include `%OldChk` plus a distinct `%Chk`.

For each ready task, download its `.gjf`, run it outside GaussianHelper, then import the resulting `.log` / `.out`. A unique filename match is assigned automatically only when that task is awaiting output; unmatched files and multi-section logs require an explicit task/section choice. The Workbench checks normal termination, route-required optimization/frequency evidence, optional SCF evidence, and optional expected imaginary-mode count. Unknown required evidence does not pass and does not unlock dependent work. Failed steps can be retried; changing inputs/dependencies/gates invalidates affected downstream results.

The browser does **not** run Gaussian or stop an external batch job. It exports one ready task at a time so the user can validate each result before requesting its dependent input. **Save project** / **Open project** use a versioned `.ghproject.json` file that stores task configurations and bounded parsed evidence, not raw log contents; nothing is uploaded or autosaved.

## 🤖 AI Disclaimer
* **Note**: This project has been developed with the assistance of agentic artificial intelligence (AI) models. While the application, files parsers, and input generators have been tested, users are advised to verify their generated Gaussian Job Files (`.gjf`) and execution scripts before running calculations on production clusters.

---

## 📄 License & Credits
* **Developer & Credits**: Developed by **xharl**.
* **License**: Released under the **GNU General Public License v3 (GPLv3)**. See `LICENSE` for details.
