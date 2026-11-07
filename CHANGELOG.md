# Changelog

All notable changes to GaussianHelper. The project uses pre-release versions while the file format and gate set are still evolving.

## Unreleased

### Workflow view

- **Node view** — a graph canvas over the existing DAG: topological auto-layout with per-task saved positions and collision-free auto-placement, drag-to-connect dependencies (self-links, duplicates, and cycles rejected, with drop-target feedback), edge/task inspection, quick edits (title, imaginary-mode gates), checkpoint hand-offs created or cleared from an edge, block-library presets that snapshot the active job, zoom/fit, and an expanded-by-default canvas. Gate evaluation, exports, and project persistence are unchanged. Conditional TRUE/FALSE branches remain unmodelled; readiness is still decided by gates.
- Fixed the header version label to `v0.3-alpha`.

## v0.3-alpha — 2026-11-07

This release turns the app from a form that emits text into a workbench that checks its own output. It closes the 18 tracked issues for v0.3 and adds the documentation set (`README`, `docs/ARCHITECTURE.md`, `docs/VALIDATION.md`).

### Input preparation and generation

- **Basis-set keywords** — corrected the Karlsruhe family to Gaussian's unhyphenated tokens (`def2SVP`, `def2TZVP`, `def2TZVPP`, `def2QZVP`, `def2QZVPP`); added a data guard that rejects route-unsafe keywords and a family rule that keeps the `def2*` tokens hyphen-free (#1).
- **Dispersion semantics** — `B2PLYPD3` is a valid Gaussian 16 keyword that already includes D3(BJ). The misleading `B2PLYP-D3` display name was corrected, the method now carries `alreadyIncludesDispersion`, and selecting it blocks or warns on a second `EmpiricalDispersion` request (#4).
- **Heavy elements / GenECP** — documented ECP and element-coverage metadata for every basis; self-contained ECP bases (`SDD`, `LanL2DZ`, `CEP-*`) no longer invite a bogus `Pseudo=Read`; explicit `GenECP` mode emits per-element basis and ECP blocks in Gaussian's documented simplified format, with no fabricated parameters (#12).
- **Multi-fragment inputs** — optional `fragments` config emits Gaussian's total-plus-per-fragment charge/spin line and `(Fragment=N)` labels, validates ranges/parity/charge sum, and keeps single-fragment output byte-identical. The UI editor remains a follow-up (#13).
- **Conformer ensembles** — generate, MMFF94-minimise, RMSD-prune, and Boltzmann-rank up to 50 conformers; show energy/ΔE/population/RMSD; warn above a 2 kcal/mol spread; record the chosen conformer; queue top-k as sibling tasks (#15). This also fixed a pre-existing silent 2D fallback caused by unregistered OpenChemLib tables.
- **`--Link1--` chains** — two-link export for a continuation task, with the documented blank line and a Link 0 block per link; legacy `Geom=Check` and `Geom=Step=N` are recognised, and `Step=N` requires a checkpoint binding (#11).

### Validation and theory

- **Pre-flight chemistry lint** — replaced the hardcoded functional list with method metadata (`isDft`, `rung`, `alreadyIncludesDispersion`, `isRangeSeparated`, cost exponent) and added rules for missing dispersion, hybrid on a double-zeta Pople basis, `Freq` without T/P, `Opt=TS` without a Hessian, `TD` on a non-range-separated functional, transition metals with default SCF, heavy elements without an ECP, and basis sets on no-basis methods (#16).
- **Cost estimate** — an order-of-magnitude core-hour range with stated assumptions and an explicit "estimate, not a benchmark" label (#16).
- **Route keyword registry** — a documented registry of methods, bases, job types, and option families; unknown tokens are quoted warnings, route-unsafe characters are errors, and `allowUnknownRouteTokens` / `strictRouteTokens` provide the documented escape hatches (#18).
- **Imaginary-mode magnitude gate** — saddle searches must clear `minImaginaryMagnitude` (default 50 cm⁻¹); non-TS `Freq` jobs default to expecting zero imaginary modes; the verdict carries the offending value as evidence (#9).
- **Workflow gate invariant** — `requireNormalTermination` is declared once, after the caller spread, with its always-on intent documented (#5).

### Output inspection

- **Thermochemistry** — parse ZPE, thermal corrections, H/G totals, and temperature/pressure from `Freq` output; new `requireThermochemistry` gate (default on for `Freq`), inspector rows and CSV columns; missing values stay `unknown` (#7).
- **Post-HF and composite energies** — parse the labelled method total (`E(MP2)`, `CCSD(T)=`, `E(CBS-QB3)`, `G4(0 K)=`, `W1BD=`, …) separately from the SCF reference; new method-implied `requireFinalEnergy` gate and inspector/CSV fields (#8).
- **Route echo verification** — capture the log's route tokens and echoed `%Chk`/`%OldChk` names, compare them with the configured route as a normalised token set, and fail a mismatch with a readable diff (#10).

### Workflow and reproducibility

- **Provenance manifests** — every export writes `<input>.provenance.json` with app version/commit, timestamp, route, molecule, geometry source, conformer/ensemble, task ids, and the SHA-256 of the exact `.gjf`; the compact record is stored per task and shown in the Workbench (#17).
- **Workflow bundles** — export every task's input, a data-only DAG manifest, per-task provenance, and SLURM/PBS/plain-bash templates in a dependency-free ZIP; the diamond dependency graph is encoded with `afterok` chains, and the scripts explicitly do not validate results (#14).
- **Project persistence** — GenECP assignments, fragment specs, route-validation flags, conformer provenance, and provenance records now survive `.ghproject.json` save/load and are re-validated; the Workbench also exposes the final-energy gate and the saddle-threshold input.
- **Packaging** — build archives are no longer committed; `dist.zip`/`dist.tar.gz` are gitignored and published as release assets named by build commit. `package.json` remains `"private": true` on purpose, and the README documents why (#6).

### Batch execution

- **BCF export** — the Windows batch control file now writes `! Start=n` as Gaussian's format requires, instead of a bare keyword (#2).
- **Linux runner** — success is classified by Gaussian's termination markers, not the process exit code, which is `0` even on `Error termination`; the script distinguishes normal, error, and unknown outcomes and states that it is not a substitute for the Workbench gates (#3).

### Testing

- 388 tests across 25 files (from 74 tests across 7 files at v0.2-alpha). New suites cover every issue above, including exact-text golden tests, a real ZIP round-trip validated by Python's `zipfile`, and project save/load re-validation.

## v0.2-alpha — 2026-06-01

- Offline Output Inspector: multi-file log summaries, SCF/optimisation/frequency evidence, warnings and errors, CSV export.
- Workflow Workbench: dependency DAG, `%OldChk`/`%Chk` checkpoint binding, explicit gates, project save/load.
- Portable launchers and release bundles.

## v0.1-alpha — 2026-06-01

- Initial public release: GJF preparation, 3D viewer, coordinate parsers, batch generator, presets.
