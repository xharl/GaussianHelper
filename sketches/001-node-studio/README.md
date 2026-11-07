## Variant: Node studio

### Design stance
A dense, tool-first graph editor for computational chemists who want direct control over dependencies, artifacts, and branching logic.

### Key choices
- Layout: computational block library on the left, an infinite-canvas-style dependency graph in the center, and a contextual logic/configuration inspector on the right.
- Typography: compact Inter-style UI labels with monospace Gaussian routes, evidence fields, and filenames.
- Color: GaussianHelper's existing dark indigo theme; green for validated evidence, amber for conditional branches, and indigo for ready work.
- Interaction: click to add blocks, drag to arrange them, connect output/input ports, select edges to change release conditions, edit the frequency gate, validate the DAG, and preview ready exports.
- Domain model: a realistic transition-state workflow uses parsed `frequencies.imaginaryCount` evidence to branch between IRC and a separate review/recovery attempt.

### Trade-offs
- Strong at: exposing graph topology, parallel branches, checkpoint hand-offs, and the reason a downstream task is blocked.
- Weak at: information density and canvas navigation can become demanding for new users or very large projects.

### Best for
Power users building branching reaction-profile workflows who think in terms of dependency graphs and want the visual editor to map closely to the existing Workbench project model.
