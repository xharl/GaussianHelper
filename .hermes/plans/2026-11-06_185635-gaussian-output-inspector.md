# Gaussian Output Inspector Implementation Plan

> **For Hermes:** Implement task-by-task with regression tests and verify against representative output fixtures.

**Goal:** Add an offline Gaussian `.log` / `.out` inspector that summarizes completion, SCF, optimization, frequencies, and diagnostics across multiple output files, with CSV export.

**Architecture:** Add a pure incremental parser that consumes lines and closes a calculation section when it sees a Gaussian termination marker. Feed it from `File.stream()` with a text decoder so full log files are not retained in memory. Add an `Output Inspector` tab that holds results only in page memory, renders per-file/per-section status, and exports a CSV comparison. No server, account, telemetry, persistence, or new dependency.

**Tech Stack:** Existing Vite/vanilla JavaScript app, browser File/ReadableStream APIs, Vitest.

---

## Product behavior and acceptance criteria

- Accept multiple `.log` and `.out` files through a file picker and drag/drop; remain entirely local/offline.
- Display file-level summary and each detected Gaussian run section; identify `Normal termination`, `Error termination`, and missing termination as `completed`, `error`, and `incomplete` respectively.
- For each section, report only facts directly found in the output: SCF status (`converged` / `failed` / `unknown`), latest `SCF Done` energy and method (Hartree), optimization status (`converged` / `not converged` / `unknown`), frequency count, number and values of negative frequencies, termination line, and bounded warning/error excerpts with line numbers.
- For missing evidence, show `Unknown` / `Not found`; never infer success from absence of an error.
- Summarize all uploaded files together and allow CSV export with one row per section. Quote CSV fields correctly.
- Escape filenames and diagnostic text before rendering. Do not retain raw file contents after parsing; cap stored diagnostics and excerpt length.
- Document that this is a text-pattern inspector, not a validator of scientific correctness. It must show the matching source line for each status/diagnostic.

## Task 1: Add parser regression tests (RED)

**Files:**
- Create: `test/gaussianLogParser.test.js`
- Create: `src/parsers/gaussianLogParser.js`

**Cases:** a normal optimization/frequency output; explicit error termination; incomplete output; unknown/unobserved statuses; scientific notation including `D` exponents; multiple termination-delimited sections; diagnostics with preserved line numbers; bounded excerpts; stream chunk boundaries splitting a line/CRLF.

**Verification:** `npm test -- --run test/gaussianLogParser.test.js` must fail before parser implementation for missing module/behavior, then pass after Task 2.

## Task 2: Implement streaming, incremental parser

**Files:** `src/parsers/gaussianLogParser.js`

- Export an accumulator/parser that accepts one line at a time, and a helper that consumes a `ReadableStream` plus filename.
- Normalize CRLF/CR, retain only the incomplete trailing line between chunks, and cap an individual unterminated line to prevent pathological memory growth.
- Split sections at explicit normal/error Gaussian termination lines. Any trailing section without a termination marker is `incomplete`.
- Recognize `SCF Done`, explicit SCF convergence failure, optimization completed/stopped, `Frequencies --`, and warning/error lines. Store latest SCF energy, methods/count, frequency metrics, markers, and a bounded diagnostic list.
- Make all missing indicators explicit (`unknown` / `null`), and keep line numbers from the original file.
- Avoid assumptions about unsupported output formats; unmatched lines are ignored, not treated as success.

**Verification:** parser unit tests, including a stream split mid-token and mid-CRLF; tests prove incomplete and error fixtures do not pass.

## Task 3: Build the inspector UI

**Files:**
- Create: `src/components/GaussianOutputInspector.js`
- Modify: `src/styles/components.css` (only if existing layout classes do not cover the upload area, status badges, summary cards, and result rows)

- Render multi-file picker/drop area, progress text while processing, clear/reset action, batch summary cards, file cards, section metrics, and expandable line-numbered diagnostics.
- Process selected files sequentially through the stream parser; show per-file parse failures without discarding successful files.
- Use only text-safe DOM insertion/HTML escaping for filenames and log excerpts.
- Provide a CSV download button when results exist; one row per parsed section and safe CSV quoting for commas, quotes, and newlines.
- Avoid storing original log text or sending data anywhere.

**Verification:** add component-level tests with a minimal DOM test dependency only if already available; otherwise keep DOM logic simple and cover escaping/CSV helpers as pure unit functions. Manually inspect the production build or use browser smoke testing if available.

## Task 4: Integrate navigation and documentation

**Files:**
- Modify: `src/main.js`
- Modify: `README.md`
- Modify: `test/app.test.js` or a new integration test as appropriate

- Add `Output Inspector` as a third output tab, preserve existing Current Job / Batch Queue behavior, instantiate the component once, and switch to its content without reinitializing other components.
- Document accepted file types, metrics, local-only handling, status semantics, and known limits.

**Verification:** build and test navigation integration; ensure all tabs still switch and the page starts with its existing default molecule.

## Task 5: End-to-end validation and release artifacts

- Run `npm test`, `npm run build`, and `npm audit --audit-level=moderate`.
- Verify generated `dist.zip` and `dist.tar.gz` are readable and contain the inspector assets.
- Confirm the build’s lazy chunks and asset sizes; report any remaining chunk warning rather than suppressing it.
- Review `git diff --check`, current branch status, and all parser/UI findings before declaring completion.

## Risks and boundaries

- Gaussian logs vary by version, route, and failure mode. The UI must call statuses pattern-based observations and retain an `unknown` state; it must not claim chemical validity.
- Multi-Link1 output can contain multiple termination-delimited sections. Summarize each observed section separately; do not merge energy/frequency values across sections.
- Some files may be truncated or use unrecognized wording. Show `incomplete` / `unknown` and excerpts rather than guessing.
- Large files are handled incrementally; retained diagnostics are bounded and raw contents are discarded.
- No new dependencies or network processing are required.
