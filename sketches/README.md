# Workbench visual-programming sketches

Two disposable workflow-interaction concepts and one application-shell mockup for the GaussianHelper project workbench. Open any `index.html` directly in a browser; there is no build step, external dependency, or Gaussian execution.

| Dimension | [Node studio](001-node-studio/index.html) | [Guided runbook](002-guided-runbook/index.html) |
|---|---|---|
| Primary model | Freeform directed graph | Ordered protocol with nested branches |
| Best at | Fan-out, joins, artifact flow, topology | Explainability, sequential methods, next action |
| Composition | Add, drag, and connect blocks | Insert and reorder recipe steps |
| Logic display | Condition node with typed branch edges | Inline condition with TRUE/FALSE columns |
| Inspector | Block or connection configuration | Readiness, blocked reasons, external handoff |
| Main cost | Canvas density and navigation | Tall recipes and weaker multi-branch visibility |

## Recommendation

Use **Node studio** as the primary design direction. Its graph maps directly to the existing Workbench DAG, checkpoint bindings, and output gates. Borrow the runbook's **next-action card, explicit blocked reasons, and external-handoff checklist** for the right inspector. A later read-only "Runbook" view could explain the same project model without introducing a second workflow representation.

## Node-first application shell (003)

[Open the shell mockup](003-node-first/index.html) — applies the Node studio direction to the whole application: full-bleed canvas, add-block palette, contextual inspector that exposes the full Current Job parameter set, condition/loop blocks, and a project molecule drawer. This is an application-shell proposal, not a third workflow model; its README states the control-flow caveats explicitly.

## Shared domain rules illustrated

- A calculation block snapshots a Gaussian input configuration and its declared artifacts.
- A dependency controls readiness; a checkpoint binding separately declares `%OldChk` hand-off.
- Conditions use parsed output evidence such as `frequencies.imaginaryCount`, not a job's exit status alone.
- Missing or unknown required evidence does not release either conditional branch.
- The graph remains acyclic. Recovery creates a separate attempt rather than drawing a loop back to an earlier calculation.
- Gaussian runs externally. These concepts neither submit nor monitor calculations.

## Verification

Both variants were rendered at 1440×900 in headless Chromium and visually reviewed. Browser interaction checks covered block insertion, selection, reordering or dragging, condition editing, dependency-order validation, and inspector behavior. The node studio additionally covered dependency creation, cycle rejection, edge editing, deletion, search, and export-modal behavior. Both completed with no JavaScript errors or external requests.
