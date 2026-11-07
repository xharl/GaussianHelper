# Variant 2: Guided Runbook

## Design stance
Treat the workflow as a chemistry protocol with a deliberate order of operations, not a canvas of nodes: the scientist reads the evidence chain from geometry to verified transition state, with decision logic nested exactly where it applies.

## Key choices
- **Layout:** A three-pane workbench pairs a compact computational block library with a vertical, nested recipe and a persistent run-readiness/next-action inspector.
- **Chemistry narrative:** A realistic cyclopentadiene + acrylonitrile endo Diels–Alder workflow uses B3LYP/6-31G(d) TS optimization and frequencies, an imaginary-mode gate, bidirectional IRC, and a CCSD(T)/6-311++G(d,p) single point.
- **Dependencies:** Labelled connectors identify passed artifacts such as `ts_opt.chk`; blocked states name the exact missing result both inline and in the inspector.
- **Logic:** The condition has editable operator/count controls, live TRUE/FALSE labels, and a terminal Review & refine path that explicitly requires a new attempt rather than drawing a loop.
- **Interaction:** Palette clicks insert steps after the selection, selection updates step details and blocked reasons, move controls reorder within the current sequence/branch, and Validate recipe reports dependency or branch issues in a toast.
- **Visual system:** The existing dark indigo/violet workbench theme is retained, with green passed states, an indigo next step, restrained amber dependency warnings, and monospaced routes and expressions.

## Trade-offs
- **Strong at:** Explaining execution order, evidence handoffs, TS-specific acceptance criteria, recovery semantics, and the single next action to computational chemists; the nested recipe also keeps the happy path and failure path visible together.
- **Weak at:** Representing fan-out, converging dependencies, reusable subworkflows, or several independent branches as clearly as a graph; deeply nested or frequently reordered protocols would become tall and harder to survey.

## Best for
- Guided TS-verification and other mostly linear computational protocols where one well-defined decision gates downstream work.
- Researchers who value methodological guardrails and an unblocked-next-step checklist over freeform workflow composition.
- Comparing a recipe/runbook interaction model against a freeform node studio before any production integration. Open `index.html` directly; this self-contained concept never runs or submits Gaussian jobs.
