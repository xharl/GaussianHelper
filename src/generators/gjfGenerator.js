/**
 * @fileoverview Generator for Gaussian .gjf (Gaussian Job File) input files.
 * Constructs a complete, syntactically valid Gaussian input file from a
 * structured configuration object.
 * @module generators/gjfGenerator
 */

/**
 * Semi-empirical methods that do not take an external basis set.
 * @type {Set<string>}
 */
const NO_BASIS_METHODS = new Set([
  'AM1', 'PM3', 'PM6', 'PM7', 'MNDO', 'MINDO3', 'INDO', 'CNDO',
  'ZINDO', 'PDDG', 'RM1',
  'UFF', 'DREIDING', 'AMBER', 'MM2', 'MM3', 'MM4',
  'CBS-QB3', 'CBS-4M', 'CBS-APNO',
  'G1', 'G2', 'G2MP2', 'G3', 'G3B3', 'G3MP2', 'G3MP2B3',
  'G4', 'G4MP2',
  'W1U', 'W1BD', 'W1RO', 'W2U', 'W2BD',
]);

/**
 * Format a floating-point coordinate value to 6 decimal places,
 * right-aligned within a 12-character field.
 *
 * @param {number} value - The coordinate value.
 * @returns {string} The formatted string (12 chars wide, 6 decimal places).
 */
export function formatCoordinate(value) {
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
 * @returns {string} The complete route line (single line, no trailing newline).
 */
export function buildRouteSection(route) {
  const verbosity = (route.verbosity || '#N').trim();
  const method = (route.method || '').trim();

  if (!method) {
    throw new Error('A computational method is required to build the route section.');
  }

  // Method/Basis or just Method
  const upperMethod = method.toUpperCase();
  const needsBasis = !NO_BASIS_METHODS.has(upperMethod);
  const basisSet = (route.basisSet || '').trim();

  let methodPart;
  if (needsBasis && basisSet) {
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
 * @typedef {Object} GjfConfig
 * @property {Object} link0 - Link 0 commands.
 * @property {string} [link0.memory] - Memory allocation (e.g. '8GB').
 * @property {number|string} [link0.nproc] - Number of processors.
 * @property {string} [link0.checkpoint] - Checkpoint file name.
 * @property {string} [link0.other] - Any other %commands (one per line).
 * @property {Object} route - Route section configuration (see {@link buildRouteSection}).
 * @property {string} title - Job title / description.
 * @property {number} charge - Molecular charge.
 * @property {number} multiplicity - Spin multiplicity.
 * @property {Array<{symbol: string, x: number, y: number, z: number}>} atoms
 *   Atom coordinates.
 */

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
  if (link0.checkpoint && link0.checkpoint.trim()) {
    sections.push(`%Chk=${link0.checkpoint.trim()}`);
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

  // ── Blank line after route ──
  sections.push('');

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
  sections.push(`${charge} ${multiplicity}`);

  // ── Atom coordinates ──
  if (atoms.length > 0) {
    for (const atom of atoms) {
      const sym = (atom.symbol || 'X').padEnd(2, ' ');
      const x = formatCoordinate(atom.x || 0);
      const y = formatCoordinate(atom.y || 0);
      const z = formatCoordinate(atom.z || 0);
      sections.push(` ${sym}  ${x}${y}${z}`);
    }
  } else {
    sections.push(' ! [Draw or import a structure to add coordinates here]');
  }


  // ── Trailing blank line (required by Gaussian) ──
  sections.push('');

  return sections.join('\n');
}
