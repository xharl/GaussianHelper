# Validation model

GaussianHelper separates three questions that are easy to conflate:

1. **Is the input well-formed?** — `validation.js` checks the configuration before generation.
2. **Does the output contain the evidence the calculation claims?** — `workflowGates.js` evaluates a parsed log section against the task's gates.
3. **Is the chemistry correct?** — the app cannot answer this. Gates are text-derived evidence, not proof.

Every gate returns `pass`, `fail`, or `unknown`. A required `unknown` yields `needs-review` and blocks dependent tasks. Nothing is coerced to `pass`.

## Input checks (before generation)

| Check | Failure mode |
|---|---|
| Charge/multiplicity parity | The electron count and multiplicity are inconsistent for the molecule or a fragment |
| Method/basis compatibility | A method that needs a basis has none; a method that defines its own basis is given one; GenECP has no element assignments or also sets `basisSet` |
| Fragments | Ranges do not tile the atom list, parity fails per fragment, or fragment charges do not sum to the total |
| Route tokens | Unknown keyword (warning, quoted), route-unsafe character (error) |
| Theory lint | Advisory warnings: missing dispersion, hybrid on a small Pople basis, `Freq` without T/P, `Opt=TS` without Hessian, `TD` on a non-range-separated functional, transition metal with default SCF, heavy element without ECP, basis on a no-basis method |
| Cost estimate | Always labelled heuristic; never a measured runtime |

## Output gates (after import)

| Gate | Required | Pass | Fail | Unknown |
|---|---|---|---|---|
| Normal termination | always | section completed and `Normal termination of Gaussian` present | explicit `Error termination` or error status | no termination marker |
| Route echo matches | always | every expected token present; no conflicting method/basis/job-type token | a conflicting token is present | no route echo found |
| SCF convergence | optional / on explicit failure | `SCF Done` record present | explicit SCF failure text | no SCF record |
| Optimisation | `Opt` routes | optimisation-converged marker | explicit non-convergence | marker absent |
| Frequency record | `Freq` routes | a frequency record exists | — | no record |
| Thermochemistry | `Freq` routes | ZPE, H, and G totals present | explicit thermochemistry failure | any total missing |
| Method final energy | post-HF / double-hybrid / composite | a family-matching final-energy label present | label mismatch or method-step failure | label absent or unmappable |
| Imaginary modes | optional; 0 for non-TS `Freq` | count matches and every mode clears the magnitude floor | count mismatch or a mode below the floor | frequency data missing |
| Saddle threshold | part of the imaginary gate | all stored modes ≥ `minImaginaryMagnitude` (default 50 cm⁻¹) | weakest mode below the floor, with its value as evidence | data insufficient |

### Route-echo comparison

The parser captures the `#`-prefixed route lines after `Entering Link 1`, normalises them to an uppercase token set, and records the source line. The expected set is derived from the task's configured route: method, basis (including GenECP), job type, dispersion, solvation, grid, SCF, population, and custom keywords. Ordering, case, and harmless extras (`Test`, `MaxDisk`) are ignored; a conflicting functional, basis, or job type fails with a missing/unexpected diff. A missing echo is `unknown`, not a pass.

### Energies

- `SCF Done` is always the **reference** energy.
- For post-HF and composite methods the **method** energy is the last match from a documented label table (`E(MP2)`, `CCSD(T)=`, `E(CBS-QB3)`, `G4(0 K)=`, `W1BD=`, …). The inspector shows both, labelled; the CSV carries both columns.
- A method energy that cannot be mapped keeps the gate at `unknown`. It is never inferred from the SCF value.

### Thermochemistry

`Freq` output is parsed for the zero-point correction, thermal corrections to E/H/G, the corresponding totals, and the temperature/pressure. The gate requires the ZPE, enthalpy, and Gibbs totals; missing values are `unknown`. Values are finite-checked and evidence-capped when a project is loaded.

### Imaginary modes

The parser stores every negative frequency up to a 100-value cap and maintains `minImaginary` for **all** modes before the cap. The gate:

1. requires a frequency record and an integer count;
2. compares the count with `expectedImaginaryModes` (0 by default for non-TS `Freq` routes; unset for `Opt=TS/QST2/QST3`, where the user states the expected count);
3. for saddle searches, requires every stored mode and `minImaginary` to clear `minImaginaryMagnitude` (default 50 cm⁻¹; `null` disables the floor).

A −4 cm⁻¹ artefact therefore fails a TS gate with `-4 cm-1 < 50 cm-1` as evidence.

## Project re-validation

On load, the app:

- validates the schema version, every id/name/route/filename, gate types, and evidence bounds;
- recomputes each attempt's verdict from the retained parsed evidence instead of trusting the stored `overall`;
- re-derives route-implied gate defaults for files written before a gate existed;
- rejects the file rather than repairing malformed state.

## What a pass does not mean

- The log may be from a different molecule with the same route (checkpoint contents are not inspected).
- Basis aliases are compared literally (`6-31G*` vs `6-31G(d)`), so an alias may be reported as a mismatch.
- Extra keywords outside the compared families are not judged.
- The route echo proves what Gaussian says it read, not what it did with it.
- MMFF94 conformer populations are force-field rankings, not free energies.
- No gate substitutes for checking the science.
