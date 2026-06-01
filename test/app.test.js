import { describe, it, expect } from 'vitest';
import { getSymbol, getAtomicNumber, getHillFormula } from '../src/utils/elements.js';
import { validateChargeMultiplicity, validateMethodBasis, validateInputCompleteness, getTheoryRecommendations } from '../src/utils/validation.js';
import { generateGJF } from '../src/generators/gjfGenerator.js';
import { parseXYZ } from '../src/parsers/xyzParser.js';
import { parseMOL } from '../src/parsers/molParser.js';

describe('Periodic Table & Formula Utilities', () => {
  it('should look up element symbols correctly', () => {
    expect(getSymbol(1)).toBe('H');
    expect(getSymbol(6)).toBe('C');
    expect(getSymbol(8)).toBe('O');
    expect(getSymbol(999)).toBeNull();
  });

  it('should look up atomic numbers from symbols case-insensitively', () => {
    expect(getAtomicNumber('H')).toBe(1);
    expect(getAtomicNumber('c')).toBe(6);
    expect(getAtomicNumber('He')).toBe(2);
    expect(getAtomicNumber('HE')).toBe(2);
    expect(getAtomicNumber('invalid')).toBeNull();
  });

  it('should generate Hill system molecular formulas', () => {
    // Water: H2O
    const waterAtoms = [
      { symbol: 'O' },
      { symbol: 'H' },
      { symbol: 'H' }
    ];
    expect(getHillFormula(waterAtoms)).toBe('H2O');

    // Ethanol: C2H6O
    const ethanolAtoms = [
      { symbol: 'O' },
      { symbol: 'C' },
      { symbol: 'H' },
      { symbol: 'H' },
      { symbol: 'C' },
      { symbol: 'H' },
      { symbol: 'H' },
      { symbol: 'H' },
      { symbol: 'H' }
    ];
    expect(getHillFormula(ethanolAtoms)).toBe('C2H6O');

    // Benzene: C6H6
    const benzeneAtoms = Array(6).fill({ symbol: 'C' }).concat(Array(6).fill({ symbol: 'H' }));
    expect(getHillFormula(benzeneAtoms)).toBe('C6H6');

    // No atoms
    expect(getHillFormula([])).toBe('molecule');
  });
});

describe('Input Validation Rules', () => {
  it('should validate charge and multiplicity consistency', () => {
    // Neutral water: 10 electrons. Multiplicity must be singlet (1).
    const waterAtoms = [
      { symbol: 'O' },
      { symbol: 'H' },
      { symbol: 'H' }
    ];
    
    // Singlet (1) should be valid
    expect(validateChargeMultiplicity(0, 1, waterAtoms).valid).toBe(true);
    
    // Doublet (2) should be invalid (parity mismatch)
    expect(validateChargeMultiplicity(0, 2, waterAtoms).valid).toBe(false);

    // Singlet (1) on radical/charged (e.g. OH radical: 9 e-) should be invalid
    const ohAtoms = [{ symbol: 'O' }, { symbol: 'H' }];
    expect(validateChargeMultiplicity(0, 1, ohAtoms).valid).toBe(false);
    expect(validateChargeMultiplicity(0, 2, ohAtoms).valid).toBe(true); // doublet valid
  });

  it('should validate methods and basis sets requirements', () => {
    // DFT functional (B3LYP) requires basis set
    expect(validateMethodBasis('B3LYP', '6-31G(d)').valid).toBe(true);
    expect(validateMethodBasis('B3LYP', '').valid).toBe(false);

    // Semi-empirical (AM1) does NOT require basis set
    expect(validateMethodBasis('AM1', '').valid).toBe(true);
    expect(validateMethodBasis('PM6', '6-31G').valid).toBe(false); // PM6 does not take a basis set, so it is invalid
  });

  it('should validate config input completeness', () => {
    const validConfig = {
      title: 'Water calculation',
      route: { method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'Opt' },
      charge: 0,
      multiplicity: 1,
      atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }]
    };

    expect(validateInputCompleteness(validConfig).valid).toBe(true);

    const missingAtoms = {
      title: 'Water calculation',
      route: { method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'Opt' },
      charge: 0,
      multiplicity: 1,
      atoms: []
    };
    expect(validateInputCompleteness(missingAtoms).valid).toBe(false);
  });
});

describe('Gaussian Job File (GJF) Generator', () => {
  it('should generate valid GJF text from config', () => {
    const config = {
      link0: { memory: '4GB', nproc: 4, checkpoint: 'water.chk' },
      route: { verbosity: '#N', method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'Opt', dispersion: 'EmpiricalDispersion=GD3BJ', scf: 'SCF=Tight' },
      title: 'Water optimization',
      charge: 0,
      multiplicity: 1,
      atoms: [
        { symbol: 'O', x: 0.0, y: 0.0, z: 0.1197 },
        { symbol: 'H', x: 0.0, y: 0.7615, z: -0.4789 },
        { symbol: 'H', x: 0.0, y: -0.7615, z: -0.4789 }
      ]
    };

    const gjf = generateGJF(config);
    expect(gjf).toContain('%Mem=4GB');
    expect(gjf).toContain('%NProcShared=4');
    expect(gjf).toContain('%Chk=water.chk');
    expect(gjf).toContain('#N B3LYP/6-31G(d) Opt SCF=Tight EmpiricalDispersion=GD3BJ');
    expect(gjf).toContain('Water optimization');
    expect(gjf).toContain('0 1');
    expect(gjf).toContain(' O       0.000000    0.000000    0.119700');
    expect(gjf).toContain(' H       0.000000    0.761500   -0.478900');
    expect(gjf.endsWith('\n\n')).toBe(true); // Must end with a blank line
  });
});

describe('Chemical File Parsers', () => {
  it('should parse standard XYZ file contents', () => {
    const xyzContent = `3
Water Molecule
O   0.000000   0.000000   0.119700
H   0.000000   0.761500  -0.478900
H   0.000000  -0.761500  -0.478900
`;
    const parsed = parseXYZ(xyzContent);
    expect(parsed.atoms).toHaveLength(3);
    expect(parsed.title).toBe('Water Molecule');
    expect(parsed.atoms[0].symbol).toBe('O');
    expect(parsed.atoms[0].z).toBe(0.1197);
    expect(parsed.atoms[1].y).toBe(0.7615);
  });

  it('should parse MOL file V2000 format contents', () => {
    const molContent = `Methane
  ChemDraw06012620452D

  5  4  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    0.0000    0.0000    1.0890 H   0  0  0  0  0  0  0  0  0  0  0  0
    1.0260    0.0000   -0.3630 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.5130   -0.8885   -0.3630 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.5130    0.8885   -0.3630 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0      
  1  3  1  0      
  1  4  1  0      
  1  5  1  0      
M  END
`;
    const parsed = parseMOL(molContent);
    expect(parsed.atoms).toHaveLength(5);
    expect(parsed.bonds).toHaveLength(4);
    expect(parsed.name).toBe('Methane');
    expect(parsed.atoms[0].symbol).toBe('C');
    expect(parsed.atoms[1].symbol).toBe('H');
    expect(parsed.atoms[1].z).toBe(1.0890);
    expect(parsed.bonds[0].from).toBe(1);
    expect(parsed.bonds[0].to).toBe(2);
    expect(parsed.bonds[0].order).toBe(1);
  });
});

describe('Theory Level Recommendations', () => {
  it('should recommend ECP basis sets for heavy elements or transition metals', () => {
    const configWithHeavy = {
      route: { method: 'B3LYP', basisSet: '6-31G(d)' },
      atoms: [{ symbol: 'I', x: 0, y: 0, z: 0 }]
    };
    const recs = getTheoryRecommendations(configWithHeavy);
    expect(recs.some(r => r.includes('Heavy elements') && r.includes('ECP'))).toBe(true);

    const configWithTM = {
      route: { method: 'B3LYP', basisSet: '6-31G(d)' },
      atoms: [{ symbol: 'Fe', x: 0, y: 0, z: 0 }]
    };
    const recsTM = getTheoryRecommendations(configWithTM);
    expect(recsTM.some(r => r.includes('Transition metals') && r.includes('ECP'))).toBe(true);
  });

  it('should recommend diffuse functions for anions and excited states', () => {
    const configAnion = {
      route: { method: 'B3LYP', basisSet: '6-31G(d)' },
      charge: -1,
      atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }]
    };
    const recs = getTheoryRecommendations(configAnion);
    expect(recs.some(r => r.includes('diffuse functions') && r.includes('anions'))).toBe(true);

    const configExcited = {
      route: { method: 'B3LYP', basisSet: '6-31G(d)', jobType: 'TD' },
      atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }]
    };
    const recsExcited = getTheoryRecommendations(configExcited);
    expect(recsExcited.some(r => r.includes('diffuse functions') && r.includes('excited-state'))).toBe(true);
  });

  it('should recommend dispersion corrections for DFT functionals lacking them', () => {
    const configDFT = {
      route: { method: 'B3LYP', basisSet: '6-31G(d)', dispersion: '' },
      atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }]
    };
    const recs = getTheoryRecommendations(configDFT);
    expect(recs.some(r => r.includes('dispersion correction') && r.includes('EmpiricalDispersion=GD3BJ'))).toBe(true);
  });

  it('should recommend larger basis sets for electron correlation methods', () => {
    const configMP2 = {
      route: { method: 'MP2', basisSet: '6-31G' },
      atoms: [{ symbol: 'O', x: 0, y: 0, z: 0 }]
    };
    const recs = getTheoryRecommendations(configMP2);
    expect(recs.some(r => r.includes('Electron correlation methods') && r.includes('cc-pVTZ'))).toBe(true);
  });
});
