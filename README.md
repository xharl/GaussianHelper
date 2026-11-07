# GaussianHelper

**Current version: v0.2-alpha**

GaussianHelper is a modern, responsive web application designed for computational chemists to prepare Gaussian Job Files (`.gjf`) and construct/manage sequential batch calculation workflows.

It runs entirely client-side, providing a fast, graphical tool for setting up inputs without any software dependencies. It also supports zero-installation local server launching to bypass CORS security policies.

![GaussianHelper Screenshot](public/screenshot.png)

---

## 🌟 Key Features

- **3D Structure Viewer**: Interactive, premium 3D visualization using ball-and-stick, stick, or spacefill models.
- **Conformer Ensemble Generator**: Generate up to 50 conformers (10 by default) from a SMILES string or MOL file, minimise each with MMFF94, prune duplicate geometries by heavy-atom RMSD, and rank the survivors by Boltzmann population at 298.15 K. See [Conformer Ensembles](#-conformer-ensembles).
- **Multi-Format Coordinate Parser**: Import structures from `.xyz` coordinate files, standard `.mol` / `.sdf` structures, or ChemDraw `.cdxml` drawings (extracting atomic positions, scaling coords, and handling implicit hydrogens).
- **Theory Level Recommendations**: Smart recommendations for method/basis set combinations based on the calculation type (geometry optimization, energy, frequency, etc.) — helps users pick the right level of theory without deep DFT expertise.
- **理论 & Parameter Setups**: Visual inputs for standard Link 0 commands (memory, processors, checkpoints), job types, method functionalities, basis sets, SCF models, integration grids, dispersion, solvation, and population analyses.
- **Batch Generator & Queue**: Compile multiple calculation configs in a sequence queue, customize inputs/outputs inline, and export them as:
  - **Windows Batch Control Files** (`.bcf`) for Gaussian's native queuing.
  - **Linux Shell Scripts** (`.sh`) for sequential terminal executions (includes start/end timestamp echoes and completion checks).
- **Gaussian Output Inspector**: Inspect multiple `.log` / `.out` files locally. Summarize termination, SCF energy/convergence, optimization markers, frequencies, thermochemistry (ZPE and H/G totals with temperature/pressure), warnings, and errors with source line evidence; export a batch CSV report.
- **Workflow Workbench**: Organize calculation snapshots as a dependency graph, link checkpoint files with `%OldChk`, export only ready steps, export the whole workflow as a `.zip` bundle with a DAG manifest and scheduler templates, import logs for explicit validation gates, and save/load a portable local project file.
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

## 🧬 Conformer Ensembles

Loading a molecule still produces one 3D structure immediately. **Generate ensemble** in the *Conformer Ensemble* panel does the more honest thing: it generates up to the requested number of conformers with OpenChemLib's ETKDG-style generator (10 by default, hard cap 50, deterministic seed), minimises every conformer with **MMFF94**, prunes duplicate geometries by heavy-atom RMSD (0.5 Å), and sorts what remains by energy.

The table shows each retained conformer's MMFF94 energy, its energy relative to the lowest conformer, its Boltzmann population at 298.15 K, and its heavy-atom RMSD to the lowest conformer. Choose a row with the radio button to load that geometry into the 3D viewer and the `.gjf` preview. When the spread across retained conformers exceeds **2 kcal/mol**, the panel warns that the reported value depends on conformer choice — because it does.

The chosen conformer, its energy, its population, and the ensemble spread are recorded in the workflow task configuration (`conformer`), so a `.ghproject.json` file says which geometry produced which input. This block is provenance only: it is validated and bounded, and the generated Gaussian input is byte-identical with or without it. **Queue top-k conformers** in the Workflow Workbench creates one task per retained conformer, all sharing the same dependencies, so alternatives can be computed as siblings in the DAG.

Limitations, stated plainly:

- **Tautomers and protonation states are not enumerated.** OpenChemLib 9.22 has no tautomer generator (only canonicalisation flags), so the ensemble follows exactly the structure you enter. Charge and multiplicity define the species; a different protomer must be entered as a different structure. This is out of scope for the conformer feature rather than approximated with guessed chemistry.
- MMFF94 energies are gas-phase force-field energies, not free energies, and the population table ranks a finite stochastic search — it is not a proof that the global minimum was found. If MMFF94 cannot type an atom (for example platinum) or minimisation does not converge, the energy is reported as **unavailable** and no populations are shown; nothing is estimated or filled in.
- The MMFF94 parameter tables ship inside `openchemlib/dist/resources.json`, which the package does not expose as a subpath. `vite.config.js` aliases that file as `openchemlib-resources` so the portable offline build can rank conformers without a network fetch; this adds roughly 0.5 MB gzipped to the bundle.

## 🔬 Gaussian Output Inspector

Open the **Output Inspector** tab and drop or select multiple Gaussian `.log` / `.out` files. Files are read locally in the browser; the app does not upload or persist them. The inspector reports termination markers, SCF energies and explicit convergence text, optimization markers, frequencies (including negative-mode values), the echoed route keywords with their source line, the `%Chk` / `%OldChk` filenames echoed in the log header, and matching warnings/errors with line references. Export the section-level comparison as CSV.

Statuses are text-derived findings, not proof of scientific correctness. Missing or unrecognized markers remain **unknown** or **incomplete**; absence of a warning is not proof of a successful or valid calculation.

## 🧭 Workflow Workbench

Open **Workflow Workbench** to snapshot the current Gaussian job as a task. Add prerequisites to form a directed acyclic workflow; the list is topologically ordered and rejects cycles. A downstream task stays blocked until every prerequisite output passes. Tasks using `Geom=AllCheck`, `Geom=Checkpoint`, or `Guess=Read` must explicitly depend on a task with a checkpoint; `Geom=AllCheck` inputs omit title/charge/geometry, while `Geom=Checkpoint` inputs retain charge/multiplicity but omit atom coordinates. Generated inputs include `%OldChk` plus a distinct `%Chk`.

For each ready task, download its `.gjf`, run it outside GaussianHelper, then import the resulting `.log` / `.out`. A unique filename match is assigned automatically only when that task is awaiting output; unmatched files and multi-section logs require an explicit task/section choice. The Workbench checks normal termination, that the log's route echo matches the configured method, basis (including GenECP), job type, dispersion, solvation, grid, SCF and population keywords as a normalised token set, route-required optimization/frequency/thermochemistry evidence (ZPE, H, and G totals), optional SCF evidence, and optional expected imaginary-mode count. A missing route echo is `unknown`, never a pass; harmless extras such as `Test` or `MaxDisk` are ignored, while a conflicting method, basis, or job-type keyword fails with the missing/unexpected diff as evidence. The echoed `%Chk` / `%OldChk` filename is reported even when the route matches, so a stale checkpoint run stays visible. Unknown required evidence does not pass and does not unlock dependent work. Failed steps can be retried; changing inputs/dependencies/gates invalidates affected downstream results.

The browser does **not** run Gaussian or stop an external batch job. It exports one ready task at a time so the user can validate each result before requesting its dependent input. **Save project** / **Open project** use a versioned `.ghproject.json` file that stores task configurations and bounded parsed evidence, not raw log contents; nothing is uploaded or autosaved.

**Export bundle** downloads one `<project>.workflow.zip` containing the inputs for **every** task, including blocked or already-exported tasks. This intentionally differs from the single-task download, which offers only a `ready` step so validation stays sequential; exporting a bundle does not mark any task as awaiting output. The archive contains:

- every task's `.gjf`, named per its `inputName`;
- `manifest.json` — data only: schema version, generation timestamp, project name, task ids/titles/dependencies, input/output/checkpoint filenames, checkpoint sources, configured gates, and the DAG edges. No gate logic is embedded;
- `submit-slurm.sh` plus one `task-<id>.slurm` per task, and `submit-pbs.sh` plus one `task-<id>.pbs` per task. Both submit scripts capture each job id and chain dependents with `afterok`, so a diamond `A → B, A → C, B + C → D` is submitted as B and C after A, then D after both;
- `run-all.sh`, a fully commented plain-bash sequence for running the inputs in topological order.

The exported scripts are inert templates: they run Gaussian but **do not validate results** and make no gate claims. After the jobs finish, import the `.log` / `.out` files into the Workflow Workbench; the browser applies the same gates as for a single task.

## 🧾 Route Keyword Validation

Every method, basis-set, calculation-type and option keyword that GaussianHelper writes into the route section is checked against a machine-readable registry of Gaussian 16 keywords in `src/data/keywordRegistry.js`. The method and basis entries are seeded from `src/data/methods.js` and `src/data/basisSets.js`, so the curated lists and the registry cannot drift apart; a data test fails if a listed keyword is missing from the registry, appears twice, or the two disagree.

`validateRouteTokens()` in `src/utils/validation.js` classifies problems by severity:

- **Unknown keyword → warning.** The message quotes the offending token (for example `"FOO-2X"`), because Gaussian may accept a functional, `IOp`, or keyword newer than this app's list. Warnings appear in the preview's pre-flight lint panel and never block generation.
- **Route-unsafe characters → error.** Whitespace, `/`, `=`, `#`, `%`, or a control character inside a single token (for example a method field containing `B3LYP/def2`) cannot be emitted safely and is always reported as an error.

The free-text **Extra Keywords** field is pasted verbatim, so it is skipped by default. Two advanced switches sit below the preview header, and the same fields can be set on the route object when configuring a job programmatically:

| Route field | Effect |
|---|---|
| `allowUnknownRouteTokens: true` | Suppresses unknown-keyword warnings. It does **not** suppress route-unsafe-character errors. |
| `strictRouteTokens: true` | Also validates the free-text Extra Keywords field against the registry. |

Only the keyword that owns a parenthesised list is token-checked: `SCF=(Tight,MaxCycle=200)` validates `SCF`. Documented sub-options such as `Tight`, `Solvent=Water`, and `GD3BJ` are recorded in the registry metadata but are not individually rejected, because Gaussian has many legitimate sub-options beyond this app's list.

## 🤖 AI Disclaimer
* **Note**: This project has been developed with the assistance of agentic artificial intelligence (AI) models. While the application, files parsers, and input generators have been tested, users are advised to verify their generated Gaussian Job Files (`.gjf`) and execution scripts before running calculations on production clusters.

---

## 📄 License & Credits
* **Developer & Credits**: Developed by **xharl**.
* **License**: Released under the **GNU General Public License v3 (GPLv3)**. See `LICENSE` for details.
