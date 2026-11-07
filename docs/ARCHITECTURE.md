# Architecture

GaussianHelper is a static, client-side application built with Vite. There is no server component, no database, and no network API; every operation is local to the browser tab. This document maps the modules and the data that flows between them.

## Data flow

```
structure input ──► molecule state ──┐
                                      ├──► config snapshot ──► GJF text ──► preview / download / batch / bundle
parameters ──────────────────────────┘          │
                                                └──► workflow task ──► project JSON (.ghproject.json)

Gaussian log ──► streaming parser ──► parsed section ──► gate evaluation ──► pass / fail / unknown ──► task state
```

1. **Structure** enters through `MoleculeInput` (draw, SMILES, file import). Parsers normalise it to an atom list plus an optional MDL molfile for the 3D viewer.
2. **Parameters** are collected by `ParameterPanel` (method, basis, job type, Link 0, SCF, grid, dispersion, solvation, population).
3. `GJFPreview.buildConfig()` merges both into a single config object; `generateGJF()` turns it into the exact `.gjf` text shown in the preview.
4. The **Workflow Workbench** snapshots that config into an immutable task, adds dependencies/checkpoint bindings/gates, and stores it in a versioned project object.
5. Imported logs are parsed incrementally by `GaussianLogParser`; `evaluateWorkflowOutput()` compares the parsed evidence with the task's configured route and gates.

## Module map

### Components (`src/components/`)

| Module | Role |
|---|---|
| `MoleculeInput` | Drawing/SMILES/file input, 3D generation, conformer ensemble panel |
| `ParameterPanel` | Theory/route/Link 0 controls, presets, method-dependent controls |
| `GJFPreview` | Live `.gjf` preview, pre-flight lint panel, cost estimate, route validation toggles |
| `Viewer3D` | Three.js/3Dmol-style viewer, conformer badge |
| `BatchGenerator` | Queue of configs, `.bcf` and `.sh` export |
| `GaussianOutputInspector` | Multi-file log inspection and CSV export |
| `WorkflowWorkbench` | DAG task editor, checkpoint bindings, gates, import/validate, project save/load, bundle export, provenance display, list/graph toggle, canvas interactions |
| `WorkflowGraph` | Graph-view renderers: node cards, edge paths, block library, inspector panels |

Components are deliberately free of business logic where possible; the testable logic lives in `src/utils/` and `src/generators/`.

### Data (`src/data/`)

| Module | Role |
|---|---|
| `methods` | Curated Gaussian method keywords with metadata (`isDft`, `rung`, `alreadyIncludesDispersion`, `isRangeSeparated`, cost exponent) |
| `basisSets` | Curated basis keywords with documented ECP/coverage metadata |
| `keywords` | Job types, SCF/grid/dispersion/population options |
| `solvents` | Solvation models and solvents |
| `presets` | One-click theory/job presets |
| `keywordRegistry` | Machine-readable registry of every route token the app can emit, plus job/option families; seeded from the curated lists |

### Generation (`src/generators/gjfGenerator.js`)

- `buildRouteSection(route)` — route line, including dispersion-conflict checks and GenECP mode.
- `generateGJF(config)` — Link 0, route, title, charge/multiplicity, geometry (or checkpoint omissions), fragment charge lines and `(Fragment=N)` labels, GenECP basis/ECP blocks.
- `buildLink1Input([upstream, continuation])` — two-link input with a Link 0 block per link.
- `buildGenECPBlocks(route)` — documented simplified ECP layout, with structural/orphan checks.

### Parsing (`src/parsers/`)

- `gaussianLogParser` — streaming, bounded-memory parser. One section per calculation (separated by `--Link1--`/termination), each with `termination`, `scf`, `finalEnergy`, `optimization`, `frequencies`, `thermochemistry`, `routeEcho`, and bounded `diagnostics`. Retains only summaries and clipped evidence, never whole logs.
- `xyzParser`, `molParser`, `cdxmlParser`, `smilesHandler` — structure import.

### Domain logic (`src/utils/`)

| Module | Role |
|---|---|
| `validation` | Input completeness, charge/multiplicity parity, fragment spec, method/basis compatibility, theory lint, cost estimate, route token validation |
| `workflowModel` | Task/project creation, schema validation, sanitisation, topological sort, state derivation, invalidation, checkpoint-route detection |
| `workflowGraph` | Pure layout and geometry: topological levels, saved positions, edge Bézier paths, connection legality (self/duplicate/cycle), bounds |
| `workflowLabels` | Shared task-state labels for the list and graph views |
| `workflowGates` | Gate evaluation: termination, SCF, optimisation, frequencies, thermochemistry, final energy, imaginary modes, route echo |
| `workflowInput` | Canonical per-task input builder shared by single downloads, bundle export, and provenance |
| `bundleExport` | ZIP bundle assembly, manifest, SLURM/PBS/plain-bash templates |
| `zipWriter` | Dependency-free store-only ZIP writer (CRC-32, central directory, EOCD) |
| `provenance` | Stable provenance record + SHA-256, WebCrypto and synchronous implementations |
| `conformerEnsemble` | Conformer generation, MMFF94 minimisation, RMSD pruning, Boltzmann ranking |
| `conformerMetadata` | Bounded/validated conformer provenance block |
| `basisCoverage` | Documented element coverage and ECP presence per basis |
| `chemResources` | One-time registration of OpenChemLib's MMFF94/conformer tables |
| `coordGenerator` | 3D coordinate generation with a documented 2D fallback |
| `elements` | Element table, atomic numbers, Hill formula |

## State and persistence

- **No autosave.** A reload loses the active configuration unless the user saved a project.
- The active molecule/parameter state is in memory only.
- A **workflow project** is an explicit `.ghproject.json` file: schema version, project metadata, tasks (config snapshot, filenames, dependencies, checkpoint source, gates, attempts, bounded provenance, optional graph position).
- Save sanitises to a whitelist and serialises; load validates every field, rejects unsupported schema versions, cycles, malformed evidence, and oversized files, then recomputes attempt outcomes from retained evidence rather than trusting stored verdicts.
- Structured config fields (GenECP assignments, fragments, route-validation flags, conformer and provenance records) round-trip through save/load and are re-validated.

## Validation model

Gate evaluation returns one of three results: `pass`, `fail`, `unknown`. Any required `unknown` blocks dependents and is shown as `needs-review`; it is never coerced to pass. See [VALIDATION.md](VALIDATION.md) for the gate-by-gate contract.

## Build and packaging

- `npm run dev` — Vite dev server.
- `npm test` — Vitest, 26 files / 415 tests, no browser required.
- `npm run build` — `vite build` into `dist/`, then `scripts/build-dist.js` creates `dist.zip` and `dist.tar.gz` locally.
- `vite.config.js` defines the app commit (`__APP_COMMIT__`) for provenance and aliases OpenChemLib's `resources.json` so MMFF94 tables are bundled for offline use.
- Build outputs are gitignored; release bundles are attached to GitHub Releases.

## Extension points

- Add a method/basis: update `src/data/methods.js` / `basisSets.js`; the registry/data tests and metadata-driven lint pick it up automatically.
- Add a gate: add the field to the gate schema in `workflowModel.js`, evaluate it in `workflowGates.js`, expose it in the Workbench, and document it in `docs/VALIDATION.md`.
- Add a parser: keep the bounded-evidence discipline (line cap, diagnostic cap) so imported files cannot grow project state without limit.
- Add an export format: build it from `workflowInput.js` and the model, not by re-deriving route/geometry text.
