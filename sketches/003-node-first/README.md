# Node-first application shell (concept)

A static mockup of GaussianHelper rebuilt around the workflow graph instead of a form column. Open [`index.html`](index.html) directly in a browser; there is no build step, dependency, network request, or Gaussian execution.

This is **not** a replacement workflow model. It applies the [node-studio recommendation](../README.md) to the whole application shell: the graph is the workspace, and configuration happens in context over it.

## Why this shape

| Problem in the current shell | Node-first response |
|---|---|
| The Workbench is one column beside molecule/parameter panels, so the graph is squeezed. | The canvas owns the window. Side panels are contextual and collapsible. |
| Every job parameter is a global form, so a project is hard to read as a set of jobs. | Each block owns its parameter snapshot; the inspector exposes the full Current Job set for the selected block. |
| Conditions and loops have no visual representation at all. | Explicit **Condition** (TRUE / FALSE ports) and **Loop** (bottom retry edge) blocks, plus Join, Output, and Note blocks. |
| Editing details pulls attention away from the graph. | Quick edits apply in the inspector; **Wide inspector** gives a two-column parameter layout without leaving the canvas. The molecule drawer is project-level only. |
| A single graph edge type hides whether readiness or checkpoint data is being passed. | Solid dependency, dashed teal checkpoint hand-off, green TRUE / amber FALSE branches, violet loop edges, with a legend. |

## Layout

- **Top bar** — project identity, local-save state, molecule drawer, log import, export.
- **Canvas** — full-bleed dotted workspace. Add-block palette at the top-left; validate, zoom, and fit at the top-right; readiness summary at the bottom.
- **Inspector** — the selected block's full parameter panel by default. It can be docked, overlaid, or widened to two columns. The canvas remains visible in every mode.
- **Molecule drawer** — project-level structure, fragments, charge/multiplicity, and inherited defaults. It slides over the canvas rather than navigating away.
- **Prototype bar** — a clearly-labelled control for comparing docked/overlay/wide inspector behavior and opening the molecule drawer.

## What is interactive

- Select a block, edge, or empty canvas to switch the inspector.
- Drag block headers to arrange the graph; drag empty canvas to pan; zoom from 50–150%; **Fit** resets to the viewport.
- **Add block** opens the palette:
  - Calculations: Optimization, Optimization + frequency, Frequency, IRC, PES scan, Single point, Population analysis.
  - Control flow: Condition (TRUE/FALSE), Loop (retry with max attempts), Join.
  - Project: Output bundle, Note, Checkpoint hand-off hint.
- Drag from a block's output port to another block to create a dependency. The target highlights green/red; ordinary cycles are rejected with a message pointing to a Loop block.
- Drag from a Condition's **T** or **F** port to create a branch. The edge inspector and condition inspector agree on the branch target.
- Drag from a Loop's bottom port to an upstream calculation to create the explicit loop-back edge; edit the target and max attempts in the loop inspector.
- Select a dependency and use **Pass checkpoint** to turn it into a checkpoint hand-off, or **Clear hand-off** to turn it back into a plain dependency.
- The inspector exposes the Current Job parameter set for a calculation block:
  - title, job type, IRC direction, memory + unit, cores, checkpoint file;
  - method, basis, dispersion, SCF, integration grid, population, verbosity;
  - solvation toggle/model/solvent;
  - charge, multiplicity, project structure link;
  - extra route keywords;
  - workflow gates and upstream dependencies.
- **Wide inspector** switches the same parameter set to two columns; the canvas stays visible.
- Condition inspector edits the expression, unknown-value policy, and both branch targets.
- Loop inspector edits max attempts, mode, target, and exit condition.
- Molecule drawer edits the project structure, charge/multiplicity, fragment list, and inherited defaults; **Save changes** updates the project summary.
- **Validate** checks ordinary cycles (ignoring explicit loop edges) and reports the block/connection counts.

## Deliberate model caveat

The current GaussianHelper project model has **one edge type and an acyclic gate model**: a task is blocked until its required gates pass. This mockup proposes the interaction for conditions and loops, but it does not claim the engine can evaluate them yet. A real implementation needs, at minimum:

- a control-flow evaluation contract (what evidence releases TRUE vs FALSE, and what happens on unknown);
- per-attempt state so a loop re-entry does not reuse stale gate results;
- a cycle-safe export and provenance story for looped attempts;
- a decision on whether branch targets are alternative tasks, alternative inputs, or both.

Until those exist, the current app's honest behaviour remains gate-driven blocking, not conditional execution. The mockup labels this explicitly in the project inspector and status bar.

## Mock data

The project is an **illustrative Diels–Alder TS workflow** with 7 blocks and 7 connections. Statuses, output files, and gate values are design states, not calculated results. No energies, frequencies, or geometries are invented. No Gaussian job is run and no file is read or written by the page.

## Verification

Rendered at 1440×900 and 390×844 in headless Chromium. Checked: block selection, inspector parameter edits (method, solvation, imaginary modes), add-block palette, condition and loop inspectors, wide inspector, molecule drawer, drag-to-connect, and validation. No external requests or JavaScript errors.
