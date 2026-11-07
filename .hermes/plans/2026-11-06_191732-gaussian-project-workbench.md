# Gaussian Project Planning Workbench Implementation Plan

> **For Hermes:** Implement task-by-task with regression tests; preserve the existing Output Inspector work and use a separate clean feature branch/worktree before coding.

**Goal:** Let users define dependent Gaussian calculations, export and run one ready step at a time, validate its returned output against explicit gates, and track project progress without falsely treating unknown results as success.

**Architecture:** Add a versioned, local-only workflow model for a dependency DAG of calculation snapshots. Reuse the existing GJF generator and incremental Gaussian log parser; a new Workbench tab manages task readiness, checkpoint links, output assignment, and validation. The browser does not execute Gaussian or upload files: the user runs each exported ready input externally, then imports its output to unlock dependents.

**Tech Stack:** Existing Vite / vanilla JavaScript / Vitest / browser File API. No new runtime dependency, backend, telemetry, or automatic local persistence.

---

## Current context and prerequisite

- Existing relevant pieces are `src/generators/gjfGenerator.js`, `src/components/GJFPreview.js`, `src/components/BatchGenerator.js`, `src/utils/validation.js`, `src/parsers/gaussianLogParser.js`, and `src/components/GaussianOutputInspector.js`.
- The workbench should reuse the parser, not fork Gaussian output pattern matching. `GJFPreview.buildConfig(params, molecule)` already exposes the active calculation snapshot.
- The current checkout is on `fix/input-validation-and-batch-safety`. There are uncommitted Output Inspector source, test, README, archive, and plan changes. Do not stage, reset, or mix those changes into this feature by accident. Before implementation, commit/isolate the Inspector work or create a clean worktree/feature branch that includes the intended base.
- The app only prepares files and reads user-selected files; it does not run Gaussian. Do not label an exported task `running` or claim a calculation ran until its output is imported.

## Product scope and behavior (v1)

### Projects and tasks

- A project contains a name, schema version, task list, and compact per-task attempt summaries. The project file is an explicit user-managed `.ghproject.json`; no background/localStorage autosave.
- A task is an immutable snapshot of the active GJF configuration plus title, input/output filenames, zero or more dependency task IDs, an optional checkpoint source task ID, explicit validation gates, and output-attempt history.
- Add tasks from the current molecule/parameter state, duplicate an existing task, edit task metadata/dependencies/gates, and remove a task only after confirming dependent tasks will be detached or removed.
- Use a DAG, not a visual graph dependency: show a topologically ordered list with dependency names and status. Permit multiple prerequisites, reject missing/self dependencies and cycles, and preserve stable order for otherwise independent tasks.
- A task with dependencies is blocked until *all* dependencies pass their gates. A failed, incomplete, or unknown prerequisite blocks downstream tasks.
- Export only one currently ready task’s `.gjf` at a time. This forces the user to return with output and validate before exporting a dependent task. The workbench never executes Gaussian.

### Checkpoint dependencies

- Support an explicit `checkpointFromTaskId` binding to one direct dependency that produces a checkpoint.
- Emit `%OldChk=<upstream checkpoint>` followed by the current task’s `%Chk=<new checkpoint>`; do not rewrite route or geometry text with brittle regexes.
- When the route uses `Geom=AllCheck`, `Geom=Checkpoint`, or `Guess=Read`, require a valid checkpoint binding and a dependency edge to its source. `Geom=AllCheck` omits the title and molecule specification; `Geom=Checkpoint` retains only the title and charge/multiplicity. Validate checkpoint names and prevent collisions.
- Keep existing output unchanged for configurations that do not request an old checkpoint.

### Output matching and gates

- Import `.log` / `.out` files in the Workbench using the existing streaming parser. Match by the configured output basename; if zero or multiple tasks match, show a manual assignment choice and never silently attach a log.
- Preserve only parsed summaries, bounded evidence lines, source line numbers, filenames, and timestamps in project state; do not retain full log text.
- Default gate policy:
  - Normal Gaussian termination is required for every task.
  - A job whose route requests `Opt` must have an optimization-completion marker.
  - A job whose route requests `Freq` must have a frequency record.
  - SCF convergence is `pass` when a `SCF Done` record exists, `fail` on explicit SCF-failure text, otherwise `unknown`; make requiring an SCF record an explicit per-task option so non-SCF methods are not guessed.
  - Imaginary-mode count is informational unless the user explicitly sets an expected count. Do not infer a minimum/transition-state goal.
- Gate outcomes are `pass`, `fail`, or `unknown`, each with evidence. Any required `unknown` yields `needs-review`, not pass. No implicit manual override in v1; users may change a gate and re-evaluate with an audit note in a future enhancement.

### Status and progress

- Derived task states: `blocked`, `ready`, `awaiting-output`, `passed`, `failed`, `incomplete`, and `needs-review`.
- Downloading a ready task changes it to `awaiting-output`, not `running`. A successful output moves it to `passed`; only then may dependents become `ready`.
- Editing a task’s input, dependency, checkpoint binding, or gate policy invalidates its active validation and marks downstream task results stale. Keep prior attempt summaries for audit, but never use an old pass to unlock changed inputs.
- Project overview shows total/passed/ready/blocked/awaiting-output/failed/needs-review counts, a topologically ordered task list, the next actionable task, and per-attempt validation evidence.
- Save/load project JSON explicitly. Validate the schema version and all task IDs, edges, status enums, filenames, and limits on import; reject cycles and malformed state rather than silently repairing it.

### Explicit v1 boundary

The Workbench gates *which input the app makes available next*. It does not stop a separately submitted Gaussian batch job from continuing after a failed task. Do not add a “run all” script with ad hoc `grep` checks; a fail-fast executor needs a separately tested validator with parity against the browser rules and is a future feature.

## Data model

```js
WorkflowProject = {
  schemaVersion: 1,
  id: string,
  name: string,
  tasks: WorkflowTask[],
  createdAt: string,
  updatedAt: string
}

WorkflowTask = {
  id: string,
  title: string,
  config: GjfConfig,
  inputName: string,
  outputName: string,
  dependencies: string[],
  checkpointFromTaskId: string | null,
  gates: {
    requireNormalTermination: true,
    requireScfRecord: boolean,
    requireOptimizationComplete: boolean,
    requireFrequencyRecord: boolean,
    expectedImaginaryModes: number | null
  },
  activeAttemptId: string | null,
  lastExportedAt: string | null,
  attempts: WorkflowAttempt[]
}

WorkflowAttempt = {
  id: string,
  outputFilename: string,
  importedAt: string,
  overall: 'pass' | 'fail' | 'unknown',
  gates: Array<{name: string, result: 'pass' | 'fail' | 'unknown', line: number | null, evidence: string | null}>,
  summary: GaussianSectionSummary
}
```

Keep project JSON compact: no raw `.log` contents, no derived rendered HTML, and no browser-specific blob URLs.

## Implementation tasks (TDD order)

### Task 1: Workflow graph and project validation

**Create:** `src/utils/workflowModel.js`, `test/workflowModel.test.js`.

Implement pure helpers for project creation/schema validation, cycle detection, stable topological sorting, dependency status derivation, and downstream invalidation. Tests must cover empty projects, missing/self edges, duplicate IDs, cycles, multiple prerequisites, stable sort, and stale downstream statuses after edits. Test every negative guard with an input that makes it fail.

### Task 2: Checkpoint-aware GJF generation

**Modify:** `src/generators/gjfGenerator.js`, `src/utils/workflowModel.js`.
**Test:** existing `test/app.test.js` plus new cases in `test/workflowModel.test.js` or `test/workflowGates.test.js`.

Add optional `link0.oldCheckpoint`; emit `%OldChk` in the correct Link 0 position without changing output when absent. Validate checkpoint dependencies, filename safety, and `Geom=AllCheck` / `Geom=Checkpoint` / `Guess=Read` requirements. Ensure `Geom=AllCheck` omits title/charge/geometry and `Geom=Checkpoint` emits only title plus charge/multiplicity. Test exact generated GJF text and invalid/missing bindings.

### Task 3: Output-gate evaluation

**Create:** `src/utils/workflowGates.js`, `test/workflowGates.test.js`.

Map an existing parsed Gaussian section to the task’s configured gates. Test normal termination, explicit error, truncated output, SCF missing/failure, Opt without completion, Freq without records, expected imaginary-mode mismatch, and unknown text. Ensure only explicit required evidence can produce `pass`; all failures include line/evidence where available.

### Task 4: Workbench task UI and active-job snapshots

**Create:** `src/components/WorkflowWorkbench.js`.
**Modify:** `src/main.js`, `src/styles/components.css`.

Add a fourth output tab. Pass a callback that snapshots the current `GJFPreview.buildConfig(...)`; implement add-from-current, duplicate, dependency/checkpoint/gate editors, topologically ordered task list, progress summary, and “Download ready input” action. Show blocked reasons and do not render arbitrary imported strings unsafely. Test pure rendering/escaping helpers and tab/state logic without introducing a dependency unless a browser-test package already exists.

### Task 5: Output association and progression

**Modify:** `src/components/WorkflowWorkbench.js`; reuse `src/parsers/gaussianLogParser.js` and `src/utils/workflowGates.js`.

Add multi-file `.log` / `.out` import. Exact basename match may auto-select only when unique; zero/multiple matches require a visible task selector. On assigning an output, store only the parsed result, evaluate gates, update active attempt, and recompute dependents. Test exact/ambiguous/unmatched names, successful unlock, failure/incomplete blocking, and changed-input invalidation.

### Task 6: Project save/load and safe import

**Modify:** `src/components/WorkflowWorkbench.js`, `src/utils/workflowModel.js`.

Add explicit download/load of `.ghproject.json`. Validate version, maximum project size/task count, IDs, dependencies, enums, and bounded evidence before use. Render imported content as text. Round-trip tests must preserve configs, DAG, gate settings, statuses, and attempts while excluding log contents; reject unsupported schema versions and malicious/malformed input.

### Task 7: Documentation and output artifacts

**Modify:** `README.md` and, if needed, `test/app.test.js`.

Document project creation, dependency/checkpoint semantics, log matching, gate meanings, explicit external-run limitation, save/load behavior, privacy, and unknown/needs-review states. Rebuild the tracked `dist.zip` and `dist.tar.gz` through the existing `npm run build` only after the feature passes tests.

## Verification and acceptance

1. For each model/parser/generator/gate rule, write the smallest failing test first and confirm it fails on the pre-fix implementation.
2. Run `npm test`; require all prior input/output-inspector tests and new workflow tests to pass.
3. Run `npm run build`; confirm the fourth tab, project UI, and generated artifacts are in the build. Do not hide chunk warnings.
4. Run `npm audit --audit-level=moderate`, `git diff --check`, and archive integrity checks.
5. Browser smoke test the project creation → add two dependent tasks → export step 1 → import passing log → step 2 unlock → edit step 1 → step 2 relocks flow. If the browser tool cannot reach localhost, report that limitation; do not claim UI E2E was verified.
6. Check `git status` before staging: keep the prior Output Inspector feature and this workbench plan/implementation separated intentionally; never accidentally stage unrelated/generated personal data.

## Risks / tradeoffs

- Gaussian log text varies by version and route; unknown markers must remain unknown. Gate rules should be explicit and evidence-backed, not chemical-quality claims.
- Checkpoint artifacts live outside the browser. The workbench can reference/check expected filenames but cannot prove a `.chk` exists; require user-run output import and clearly label the external file prerequisite.
- A project JSON contains molecular structures and calculation settings. Keep it user-controlled and local; never auto-upload or write logs/structures to a remote service.
- Dependent tasks need reproducible checkpoint filenames. Detect collisions and invalidate descendant results when a checkpoint source changes.
- A generic generated script that “checks success” can drift from the browser parser. Keep automatic execution and shell-side gate parity out of v1.
- Current output-inspector work is uncommitted on the active branch. Implementation must first isolate that work to avoid mixing unrelated changes.
