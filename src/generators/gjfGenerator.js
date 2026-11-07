/**
 * @fileoverview Generator for Gaussian .gjf (Gaussian Job File) input files.
 * Constructs a complete, syntactically valid Gaussian input file from a
 * structured configuration object.
 * @module generators/gjfGenerator
 */

import { methodIncludesDispersion } from '../data/methods.js';
import { basisSets } from '../data/basisSets.js';
import { getBasisEntry } from '../utils/basisCoverage.js';
import { validateFragmentSpec } from '../utils/validation.js';

/**
 * Semi-empirical methods that do not take an external basis set.
 * @type {Set<string>}
 */
const SAFE_CHECKPOINT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}\.chk$/i;
const NO_BASIS_METHODS = new Set([
  'AM1', 'PM3', 'PM6', 'PM7', 'MNDO', 'MINDO3', 'INDO', 'CNDO',
  'ZINDO', 'PDDG', 'RM1',
  'UFF', 'DREIDING', 'AMBER', 'MM2', 'MM3', 'MM4',
  'CBS-QB3', 'CBS-4M', 'CBS-APNO',
  'G1', 'G2', 'G2MP2', 'G3', 'G3B3', 'G3MP2', 'G3MP2B3',
  'G4', 'G4MP2',
  'W1U', 'W1BD', 'W1RO', 'W2U', 'W2BD',
]);

function validateCheckpointName(value) {
  if (typeof value !== 'string' || !SAFE_CHECKPOINT_NAME.test(value.trim())) {
    throw new Error('Checkpoint filename must be a safe .chk basename without path separators or line breaks.');
  }
  return value.trim();
}

/**
 * A single element symbol: one uppercase letter, optionally one lowercase
 * letter (H, C, Pd). Symbols outside the app's H–Xe table are accepted here so
 * heavier elements can still be described; coverage checks report those as
 * unknown rather than guessing.
 */
const ELEMENT_SYMBOL = /^[A-Z][a-z]?$/;

/**
 * Characters allowed in a basis/ECP keyword that is written into an input
 * block or a route token. Mirrors the route-token guard used for basis sets.
 */
const BASIS_TOKEN = /^[A-Za-z0-9()+*,\-]+$/;

/**
 * Whether the route requests the explicit mixed-basis mode.
 *
 * GenECP is equivalent to `Gen Pseudo=Read` (gaussian.com/gen). It is used when
 * different elements need different basis sets and/or an ECP block, e.g.
 * 6-31G(d) on C/O plus LanL2DZ on Pd. The single-keyword ECP bases (SDD,
 * LanL2DZ, CEP-31G) do NOT need this mode: they already carry their ECP.
 *
 * @param {Object} route
 * @returns {boolean}
 */
function isGenECPMode(route) {
  return String(route?.basisMode || '').trim().toLowerCase() === 'genecp';
}

/**
 * Normalise a list of element symbols from a GenECP assignment.
 *
 * @param {string[]|string} elements - Array of symbols, or a whitespace/comma
 *   separated string.
 * @param {string} context - Label used in error messages.
 * @returns {string[]} Canonical symbols, de-duplicated, in input order.
 */
function normalizeElementList(elements, context) {
  const raw = Array.isArray(elements)
    ? elements
    : (typeof elements === 'string' ? elements.split(/[\s,]+/) : null);

  if (!raw || raw.length === 0) {
    throw new Error(`${context} must list at least one element symbol.`);
  }

  const symbols = [];
  for (const value of raw) {
    const rawSymbol = String(value ?? '').trim();
    const canonical = rawSymbol.charAt(0).toUpperCase() + rawSymbol.slice(1).toLowerCase();
    if (!ELEMENT_SYMBOL.test(canonical)) {
      throw new Error(`${context}: "${value}" is not a valid element symbol.`);
    }
    if (!symbols.includes(canonical)) symbols.push(canonical);
  }
  return symbols;
}

/**
 * Find the canonical documented ECP name matching a user-supplied keyword
 * (case-insensitive). Returns null when the name is not an ECP supplied by a
 * basis set this app knows about.
 *
 * @param {string} name
 * @returns {string|null}
 */
function findDocumentedEcpName(name) {
  const upper = String(name || '').trim().toUpperCase();
  if (!upper) return null;
  for (const entry of basisSets) {
    if (entry.ecpIncluded && entry.ecpName && entry.ecpName.toUpperCase() === upper) {
      return entry.ecpName;
    }
  }
  return null;
}

/**
 * Validate a GenECP route configuration and produce the ordered basis and ECP
 * blocks. All checks are structural/documentary: no parameters are invented,
 * and an unknown or mismatched ECP assignment is rejected rather than guessed.
 *
 * @param {Object} route - Route configuration with `elementBasis` and optional `ecp`.
 * @returns {{basisBlocks: Array<{elements: string[], basis: string}>,
 *            ecpBlocks: Array<{elements: string[], ecp: string}>}}
 * @throws {Error} If an assignment is missing, duplicated, orphaned or unknown.
 */
function prepareGenECPBlocks(route) {
  const elementBasis = Array.isArray(route?.elementBasis) ? route.elementBasis : null;
  if (!elementBasis || elementBasis.length === 0) {
    throw new Error('GenECP requires route.elementBasis with at least one { elements, basis } assignment.');
  }

  /** @type {Map<string, string>} */
  const assigned = new Map();
  const basisBlocks = [];

  for (let index = 0; index < elementBasis.length; index += 1) {
    const assignment = elementBasis[index];
    const elements = normalizeElementList(assignment?.elements, `elementBasis[${index}]`);
    const basis = String(assignment?.basis ?? '').trim();

    if (!basis || !BASIS_TOKEN.test(basis)) {
      throw new Error(
        `elementBasis[${index}] has an invalid basis keyword "${assignment?.basis}".`
      );
    }

    for (const element of elements) {
      if (assigned.has(element)) {
        throw new Error(
          `Element ${element} is assigned more than one basis set in route.elementBasis; ` +
          'GenECP needs exactly one basis per element type.'
        );
      }
      assigned.set(element, basis);
    }
    basisBlocks.push({ elements, basis });
  }

  if (route.ecp !== undefined && route.ecp !== null && !Array.isArray(route.ecp)) {
    throw new Error('route.ecp must be an array of { elements, ecp } assignments.');
  }
  const ecpAssignments = Array.isArray(route.ecp) ? route.ecp : [];

  // Refuse to silently emit a basis-only GenECP input when a selected basis
  // stores an ECP: that is the "runs without the ECP they intended" failure.
  // An explicit `ecp: []` is honoured as a deliberate "no ECPs" choice.
  if (route.ecp === undefined && basisBlocks.some((block) => getBasisEntry(block.basis)?.ecpIncluded)) {
    throw new Error(
      'GenECP was given an ECP-bearing basis but no route.ecp assignment. ' +
      'Add the documented ECP explicitly (for example { elements: [\'Pd\'], ecp: \'LanL2DZ\' }), ' +
      'or pass ecp: [] if no ECP is intended.'
    );
  }

  const ecpBlocks = [];
  const ecpAssigned = new Set();

  for (let index = 0; index < ecpAssignments.length; index += 1) {
    const assignment = ecpAssignments[index];
    const elements = normalizeElementList(assignment?.elements, `ecp[${index}]`);
    const requested = String(assignment?.ecp ?? '').trim();
    const documented = findDocumentedEcpName(requested);

    if (!documented) {
      throw new Error(
        `ecp[${index}] requests "${assignment?.ecp}", which is not a Gaussian basis keyword ` +
        'with a stored ECP. Use a documented ECP keyword (for example SDD, LanL2DZ or CEP-31G) ' +
        'instead of raw ECP parameters.'
      );
    }

    for (const element of elements) {
      if (!assigned.has(element)) {
        throw new Error(
          `ecp[${index}] assigns an ECP to ${element}, but ${element} has no route.elementBasis entry.`
        );
      }
      if (ecpAssigned.has(element)) {
        throw new Error(
          `Element ${element} has more than one ECP assignment; GenECP needs exactly one ECP per element type.`
        );
      }

      const elementBasisName = assigned.get(element);
      const expected = getBasisEntry(elementBasisName)?.ecpName;
      if (!expected) {
        throw new Error(
          `ecp[${index}] assigns an ECP to ${element}, but ${elementBasisName} has no documented ECP.`
        );
      }
      if (expected.toUpperCase() !== documented.toUpperCase()) {
        throw new Error(
          `ECP "${requested}" does not belong to basis ${elementBasisName}; use ${expected}.`
        );
      }
      ecpAssigned.add(element);
    }

    ecpBlocks.push({ elements, ecp: documented });
  }

  return { basisBlocks, ecpBlocks };
}

/**
 * Build the basis and ECP input blocks for a GenECP route.
 *
 * Layout follows Gaussian's documented simplified input format
 * (https://gaussian.com/pseudo/ and https://gaussian.com/gen/): each centre
 * definition block is `elements 0` / a standard basis keyword / `****`, and the
 * ECP section follows after a blank line as `elements 0` / an ECP keyword.
 *
 * @param {Object} route
 * @returns {{basisLines: string[], ecpLines: string[]}}
 */
export function buildGenECPBlocks(route) {
  const { basisBlocks, ecpBlocks } = prepareGenECPBlocks(route);
  const basisLines = [];
  const ecpLines = [];

  for (const block of basisBlocks) {
    basisLines.push(`${block.elements.join(' ')} 0`, block.basis, '****');
  }
  for (const block of ecpBlocks) {
    ecpLines.push(`${block.elements.join(' ')} 0`, block.ecp);
  }

  return { basisLines, ecpLines };
}


/**
 * Format a floating-point coordinate value to 6 decimal places,
 * right-aligned within a 12-character field.
 *
 * @param {number} value - The coordinate value.
 * @returns {string} The formatted string (12 chars wide, 6 decimal places).
 */
export function formatCoordinate(value) {
  if (!Number.isFinite(value)) {
    throw new Error('Atom coordinates must be finite numbers.');
  }
  const formatted = value.toFixed(6);
  return formatted.padStart(12, ' ');
}

/**
 * Build the Gaussian route section from a route configuration object.
 *
 * The route line has the form:
 * ```
 * #N Method/BasisSet JobType [Keyword1 Keyword2 ...]
 * ```
 *
 * - If the method does not need a basis set (semi-empirical, MM, composite),
 *   the `/BasisSet` part is omitted.
 * - Additional keywords (SCF, dispersion, solvation, population, grid, custom)
 *   are appended only when non-empty.
 *
 * @param {Object} route - Route configuration.
 * @param {string} [route.verbosity='#N'] - Verbosity flag (`#N`, `#P`, `#T`).
 * @param {string} route.method - Computational method (e.g. 'B3LYP').
 * @param {string} [route.basisSet=''] - Basis set (e.g. '6-31G(d)').
 * @param {string} [route.jobType=''] - Job type keywords (e.g. 'Opt Freq').
 * @param {string} [route.scf=''] - SCF convergence keyword (e.g. 'SCF=Tight').
 * @param {string} [route.grid=''] - Integration grid keyword.
 * @param {string} [route.dispersion=''] - Dispersion correction (e.g. 'EmpiricalDispersion=GD3BJ').
 * @param {string} [route.solvation=''] - Solvation model keyword (e.g. 'SCRF=(SMD,Solvent=Water)').
 * @param {string} [route.pop=''] - Population analysis keyword.
 * @param {string} [route.custom=''] - Any additional custom keywords.
 * @param {'GenECP'} [route.basisMode] - Explicit mixed-basis mode. Emits
 *   `Method/GenECP` and requires `route.elementBasis`; see {@link buildGenECPBlocks}.
 * @param {Array<{elements: string[], basis: string}>} [route.elementBasis] -
 *   Per-element basis assignments for GenECP (e.g.
 *   `[{ elements: ['C','O'], basis: '6-31G(d)' }, { elements: ['Pd'], basis: 'LanL2DZ' }]`).
 * @param {Array<{elements: string[], ecp: string}>} [route.ecp] - Optional ECP
 *   assignments for GenECP. The ECP must be the documented ECP of the basis
 *   assigned to those elements; raw ECP parameters are not supported.
 * @returns {string} The complete route line (single line, no trailing newline).
 */
export function buildRouteSection(route) {
  const verbosity = (route.verbosity || '#N').trim();
  const method = (route.method || '').trim();

  if (!method) {
    throw new Error('A computational method is required to build the route section.');
  }

  // Some method keywords already include empirical dispersion (B2PLYPD3 is
  // B2PLYP + D3(BJ) in Gaussian 16). Adding EmpiricalDispersion on top would
  // double-count the correction, so refuse to build such a route.
  const dispersion = (route.dispersion || '').trim();
  if (dispersion && methodIncludesDispersion(method)) {
    throw new Error(
      `Method ${method} already includes an empirical dispersion correction; ` +
      `remove ${dispersion} to avoid double-counting dispersion.`
    );
  }

  // Method/Basis or just Method
  const upperMethod = method.toUpperCase();
  const needsBasis = !NO_BASIS_METHODS.has(upperMethod);
  const basisSet = (route.basisSet || '').trim();

  // Explicit mixed-basis mode: `Method/GenECP` plus basis and ECP blocks after
  // the geometry. GenECP is Gaussian's documented equivalent of
  // `Gen Pseudo=Read`, not something to add alongside a self-contained ECP
  // basis such as SDD.
  const basisMode = String(route.basisMode || '').trim();
  const genecp = isGenECPMode(route);
  if (basisMode && !genecp) {
    throw new Error(
      `Unknown basis mode "${route.basisMode}". The only supported value is 'GenECP'.`
    );
  }
  if (genecp) {
    if (!needsBasis) {
      throw new Error(`Method ${method} does not take a basis set; GenECP is not applicable.`);
    }
    if (basisSet) {
      throw new Error(
        'GenECP assigns basis sets per element; remove route.basisSet and use route.elementBasis.'
      );
    }
    if (!Array.isArray(route.elementBasis) || route.elementBasis.length === 0) {
      throw new Error(
        'GenECP requires route.elementBasis with at least one { elements, basis } assignment.'
      );
    }
  }

  let methodPart;
  if (needsBasis && genecp) {
    methodPart = `${method}/GenECP`;
  } else if (needsBasis && basisSet) {
    methodPart = `${method}/${basisSet}`;
  } else {
    methodPart = method;
  }

  // Collect all additional keywords
  const additionalKeys = ['jobType', 'scf', 'grid', 'dispersion', 'solvation', 'pop', 'custom'];
  const extras = additionalKeys
    .map((key) => (route[key] || '').trim())
    .filter((val) => val.length > 0);

  const parts = [verbosity, methodPart, ...extras];
  return parts.join(' ');
}

/**
 * @typedef {Object} FragmentSpec
 * @property {number} charge - Fragment charge (integer).
 * @property {number} multiplicity - Fragment spin multiplicity (integer ≥ 1).
 * @property {[number, number]} atomRange - Inclusive, 0-based
 *   `[startIndex, endIndex]` into `config.atoms`.
 */

/**
 * Resolve and validate `config.fragments`.
 *
 * Returns `null` when no explicit fragment specification is supplied. That is
 * the default path: the molecule is written as a single `charge multiplicity`
 * line plus one untagged atom block, byte-identical to the output before
 * fragment support existed.
 *
 * Malformed specifications are rejected rather than repaired, because a
 * silently "fixed" fragment assignment changes the chemistry of the job.
 *
 * @param {Object} config - The GJF configuration.
 * @param {Array<{symbol: string, x: number, y: number, z: number}>} atoms
 * @returns {FragmentSpec[]|null}
 * @throws {Error} If the fragment specification is invalid or cannot be applied.
 */
function resolveFragmentSpec(config, atoms) {
  const fragments = config.fragments;
  if (fragments === undefined || fragments === null) return null;

  if (!Array.isArray(fragments) || fragments.length === 0) {
    throw new Error(
      'config.fragments must be a non-empty array of { charge, multiplicity, atomRange }.'
    );
  }
  if (atoms.length === 0) {
    throw new Error(
      'config.fragments requires an explicit atom list; fragment atom ranges cannot be resolved ' +
      'from a checkpoint geometry.'
    );
  }
  if (!Number.isInteger(config.charge)) {
    throw new Error(
      'config.charge must be an integer total molecular charge when fragments are specified.'
    );
  }

  const { valid, errors } = validateFragmentSpec(fragments, atoms, config.charge);
  if (!valid) {
    throw new Error(`Invalid fragment specification: ${errors.join(' ')}`);
  }
  return fragments;
}

/**
 * Build the charge and spin line for a multi-fragment molecule specification.
 *
 * Gaussian 16 documents the layout as the total pair followed by one pair per
 * fragment, comma-separated within a pair and space-separated between pairs:
 *
 * ```
 * total_charge,total_spin frag1_charge,frag1_spin frag2_charge,frag2_spin
 * ```
 *
 * https://gaussian.com/molspec/ — see the "Fragments" section and the
 * biphenyl / counterpoise examples. Fragment numbers are 1-based and must run
 * consecutively for Guess=Fragment and Counterpoise, which the atom ranges
 * already guarantee (fragment `i` is written with `Fragment=i+1`).
 *
 * @param {FragmentSpec[]} fragments
 * @param {number} charge - Total molecular charge.
 * @param {number} multiplicity - Total spin multiplicity.
 * @returns {string}
 */
export function buildFragmentChargeLine(fragments, charge, multiplicity) {
  const pairs = fragments.map((fragment) => `${fragment.charge},${fragment.multiplicity}`);
  return [`${charge},${multiplicity}`, ...pairs].join(' ');
}

/**
 * Map each atom index to its 1-based Gaussian fragment number.
 *
 * @param {FragmentSpec[]} fragments - Validated, gap-free, ordered fragments.
 * @param {number} atomCount
 * @returns {number[]}
 */
export function buildFragmentAssignment(fragments, atomCount) {
  const assignment = new Array(atomCount).fill(0);
  fragments.forEach((fragment, index) => {
    for (let atom = fragment.atomRange[0]; atom <= fragment.atomRange[1]; atom += 1) {
      assignment[atom] = index + 1;
    }
  });
  return assignment;
}

/**
 * @typedef {Object} GjfConfig
 * @property {Object} link0 - Link 0 commands.
 * @property {string} [link0.memory] - Memory allocation (e.g. '8GB').
 * @property {number|string} [link0.nproc] - Number of processors.
 * @property {string} [link0.oldCheckpoint] - Existing checkpoint file to read.
 * @property {string} [link0.checkpoint] - Checkpoint file name.
 * @property {string} [link0.other] - Any other %commands (one per line).
 * @property {Object} route - Route section configuration (see {@link buildRouteSection}).
 * @property {string} title - Job title / description.
 * @property {number} charge - Molecular charge.
 * @property {number} multiplicity - Spin multiplicity.
 * @property {Array<{symbol: string, x: number, y: number, z: number}>} atoms
 *   Atom coordinates.
 * @property {FragmentSpec[]} [fragments] - Optional explicit fragment
 *   specification. When two or more fragments are given, the molecule
 *   specification is written in Gaussian's fragment-separated form: one
 *   `total_charge,total_spin frag1_charge,frag1_spin …` line and
 *   `Symbol(Fragment=N)` atom labels (https://gaussian.com/molspec/). Omitted
 *   or a single fragment keeps the plain `charge multiplicity` layout.
 */

/**
 * Parse the options of every `Geom=` occurrence in the route text.
 *
 * Gaussian accepts both `Geom=Checkpoint` and the parenthesised list form
 * `Geom=(Checkpoint,Step=3)` (https://gaussian.com/geom/). Matching the whole
 * `Geom=` value, rather than requiring the wanted option to come first, keeps
 * `Geom=(Step=3,Checkpoint)` from being mistaken for a route without a
 * checkpoint source.
 *
 * @param {Object} route
 * @returns {string[]} Lower-cased option names, without their `=value` part.
 */
function routeGeomOptions(route) {
  const routeText = `${route?.jobType || ''} ${route?.custom || ''}`;
  const options = [];
  const pattern = /\bGeom\s*=\s*(?:\(([^)]*)\)|([^\s]+))/gi;
  let match;
  while ((match = pattern.exec(routeText)) !== null) {
    const value = match[1] ?? match[2] ?? '';
    for (const item of value.split(',')) {
      const option = item.trim().replace(/=.*$/, '').toLowerCase();
      if (option) options.push(option);
    }
  }
  return options;
}

function routeHasGeomOption(route, option) {
  return routeGeomOptions(route).includes(String(option).toLowerCase());
}

/**
 * Whether the route retrieves geometry from the checkpoint.
 *
 * `Check` is the legacy spelling of `Checkpoint` (Gaussian 09 and earlier;
 * Gaussian's current keyword pages still refer to `Geom=Check` as the
 * Checkpoint option). `Geom=Step=N` only reads a checkpoint geometry when
 * combined with `Checkpoint`/`AllCheck`, but the parenthesised form is parsed
 * as a whole, so `Geom=(Step=3,Checkpoint)` is recognised too.
 *
 * @param {Object} route
 * @returns {boolean}
 */
function routeUsesCheckpointGeometry(route) {
  const options = routeGeomOptions(route);
  return options.includes('checkpoint') || options.includes('check');
}

/**
 * Generate a complete Gaussian .gjf input file from a configuration object.
 *
 * Output structure:
 * ```
 * %Mem=8GB
 * %NProcShared=4
 * %Chk=molecule.chk
 * # B3LYP/6-31G(d) Opt Freq
 *
 * Title
 *
 * 0 1
 * C     0.000000    0.000000    0.000000
 * H     0.000000    0.000000    1.089000
 *
 * ```
 * (file always ends with a trailing blank line)
 *
 * @param {GjfConfig} config - The calculation configuration.
 * @returns {string} The complete .gjf file content.
 * @throws {Error} If required configuration fields are missing.
 */
export function generateGJF(config) {
  if (!config) {
    throw new Error('Configuration object is required.');
  }
  if (!config.route || !config.route.method) {
    throw new Error('Route section with a method is required.');
  }
  const atoms = Array.isArray(config.atoms) ? config.atoms : [];


  const sections = [];

  // ── Link 0 commands ──
  const link0 = config.link0 || {};

  if (link0.memory && link0.memory.trim()) {
    sections.push(`%Mem=${link0.memory.trim()}`);
  }
  if (link0.nproc !== undefined && link0.nproc !== null && String(link0.nproc).trim()) {
    sections.push(`%NProcShared=${String(link0.nproc).trim()}`);
  }
  if (link0.oldCheckpoint !== undefined && link0.oldCheckpoint !== null && String(link0.oldCheckpoint).trim()) {
    sections.push(`%OldChk=${validateCheckpointName(link0.oldCheckpoint)}`);
  }
  if (link0.checkpoint !== undefined && link0.checkpoint !== null && String(link0.checkpoint).trim()) {
    sections.push(`%Chk=${validateCheckpointName(link0.checkpoint)}`);
  }
  if (link0.other && link0.other.trim()) {
    // Support multi-line additional Link0 commands
    const otherLines = link0.other.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of otherLines) {
      // Ensure each line starts with %
      sections.push(line.startsWith('%') ? line : `%${line}`);
    }
  }

  // ── Route section ──
  const routeLine = buildRouteSection(config.route);
  sections.push(routeLine);

  // Explicit mixed-basis/ECP mode. Built up-front so an invalid assignment
  // fails before any partial output and before the Geom=AllCheck shortcut.
  const genecp = isGenECPMode(config.route);
  const genecpBlocks = genecp ? buildGenECPBlocks(config.route) : null;

  // Fragment-separated molecule specification. Resolved here so that an
  // invalid fragment assignment fails before any partial output.
  const hasFragmentSpec = config.fragments !== undefined && config.fragments !== null;

  // Geom=AllCheck reuses the title, charge, multiplicity, and geometry from the checkpoint.
  sections.push('');
  if (routeHasGeomOption(config.route, 'AllCheck')) {
    if (genecp) {
      throw new Error(
        'GenECP cannot be combined with Geom=AllCheck: the basis and ECP sections must follow an explicit geometry.'
      );
    }
    if (hasFragmentSpec) {
      throw new Error(
        'Fragment specifications cannot be combined with Geom=AllCheck: the molecule specification ' +
        'is read from the checkpoint, so the fragment charge/spin pairs would be ignored.'
      );
    }
    sections.push('');
    return sections.join('\n');
  }

  const fragments = resolveFragmentSpec(config, atoms);
  const multiFragment = Array.isArray(fragments) && fragments.length > 1;

  // Geom=Checkpoint omits the atom lines, which are what carry (Fragment=N).
  if (multiFragment && routeUsesCheckpointGeometry(config.route)) {
    throw new Error(
      'Fragment specifications cannot be combined with Geom=Checkpoint: the atom lines that ' +
      'carry (Fragment=N) are not written.'
    );
  }

  // ── Title ──
  const title = (config.title || 'Gaussian calculation').trim();
  sections.push(title);

  // ── Blank line after title ──
  sections.push('');

  // ── Charge and multiplicity ──
  const charge = Number.isInteger(config.charge) ? config.charge : 0;
  const multiplicity = Number.isInteger(config.multiplicity) && config.multiplicity >= 1
    ? config.multiplicity
    : 1;
  // No explicit fragments (or a single one): the historic `charge mult` line,
  // byte-identical to the output before fragment support existed.
  // Multi-fragment: Gaussian's documented
  // `total_charge,total_spin frag1_charge,frag1_spin …` line, because a bare
  // list of numbers cannot be delimited unambiguously.
  sections.push(
    multiFragment
      ? buildFragmentChargeLine(fragments, charge, multiplicity)
      : `${charge} ${multiplicity}`
  );

  // Geom=Checkpoint retrieves atomic positions but still requires charge/multiplicity.
  if (!routeUsesCheckpointGeometry(config.route)) {
    if (atoms.length > 0) {
      if (multiFragment) {
        // Atoms carry their fragment number in a parenthesized parameter, the
        // documented way to assign fragments (https://gaussian.com/molspec/).
        const fragmentOfAtom = buildFragmentAssignment(fragments, atoms.length);
        const labels = atoms.map(
          (atom, index) => `${atom.symbol || 'X'}(Fragment=${fragmentOfAtom[index]})`
        );
        const width = Math.max(...labels.map((label) => label.length));
        for (let index = 0; index < atoms.length; index += 1) {
          const x = formatCoordinate(atoms[index].x);
          const y = formatCoordinate(atoms[index].y);
          const z = formatCoordinate(atoms[index].z);
          sections.push(` ${labels[index].padEnd(width)}  ${x}${y}${z}`);
        }
      } else {
        for (const atom of atoms) {
          const sym = (atom.symbol || 'X').padEnd(2, ' ');
          const x = formatCoordinate(atom.x);
          const y = formatCoordinate(atom.y);
          const z = formatCoordinate(atom.z);
          sections.push(` ${sym}  ${x}${y}${z}`);
        }
      }
    } else {
      sections.push(' ! [Draw or import a structure to add coordinates here]');
    }
  }


  // ── Explicit GenECP basis and ECP sections ──
  // Gaussian reads these after the molecule specification: basis centre blocks
  // (each terminated by `****`), a blank line, then ECP centre blocks (the
  // section is terminated by a blank line).
  if (genecp) {
    sections.push(''); // terminates the geometry
    for (const line of genecpBlocks.basisLines) sections.push(line);
    sections.push(''); // terminates the basis section
    for (const line of genecpBlocks.ecpLines) sections.push(line);
    if (genecpBlocks.ecpLines.length > 0) sections.push(''); // terminates the ECP section
    return sections.join('\n');
  }

  // ── Trailing blank line (required by Gaussian) ──
  sections.push('');

  return sections.join('\n');
}

/**
 * Build one Gaussian input file containing two job steps separated by the
 * documented `--Link1--` line.
 *
 * Gaussian 16 documents multistep input as complete job steps separated by a
 * line containing `--Link1--`, with a blank line required before that line,
 * and Link 0 commands given per step:
 * https://gaussian.com/input/ . `%OldChk` copies the named file into the
 * current step's `%Chk` at the start of that step, which is how the second link
 * picks up the first link's checkpoint:
 * https://gaussian.com/link0/ .
 *
 * Link 0 commands therefore are not a first-link-only preamble: the upstream
 * step names its `%Chk`, and the continuation names `%OldChk` (the upstream
 * file) plus its own distinct `%Chk`. Both blocks are emitted so the file is
 * valid when each step is read in turn.
 *
 * @param {[GjfConfig, GjfConfig]} configs - `[upstream, continuation]`.
 * @returns {string} A single input file ready for one `g16` invocation.
 * @throws {Error} If the pair does not form a checkpoint continuation.
 */
export function buildLink1Input(configs) {
  if (!Array.isArray(configs) || configs.length !== 2) {
    throw new Error('Link1 input requires exactly two configurations: [upstream, continuation].');
  }
  const [upstream, continuation] = configs;
  const upstreamCheckpoint = String(upstream?.link0?.checkpoint || '').trim();
  const continuationOldCheckpoint = String(continuation?.link0?.oldCheckpoint || '').trim();
  const continuationCheckpoint = String(continuation?.link0?.checkpoint || '').trim();

  if (!upstreamCheckpoint) {
    throw new Error('The upstream job must name a checkpoint file (%Chk) so the continuation can read it.');
  }
  if (!continuationOldCheckpoint) {
    throw new Error('The continuation job must set %OldChk to the upstream checkpoint file.');
  }
  if (continuationOldCheckpoint.toLowerCase() !== upstreamCheckpoint.toLowerCase()) {
    throw new Error(
      `The continuation job's %OldChk (${continuationOldCheckpoint}) must name the upstream checkpoint (${upstreamCheckpoint}).`
    );
  }
  if (continuationCheckpoint && continuationCheckpoint.toLowerCase() === upstreamCheckpoint.toLowerCase()) {
    throw new Error(
      'The continuation job must write a distinct checkpoint file; %Chk cannot equal the upstream %OldChk file.'
    );
  }

  const upstreamText = generateGJF(upstream).replace(/\n+$/, '');
  // Keep the continuation's own section terminator: an AllCheck step ends with
  // a blank line after its route section, and stripping it would merge that
  // section into EOF.
  const continuationText = generateGJF(continuation);
  const terminated = continuationText.endsWith('\n') ? continuationText : `${continuationText}\n`;
  return `${upstreamText}\n\n--Link1--\n${terminated}`;
}
