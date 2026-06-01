/**
 * Additional Gaussian keyword options for calculation setup.
 * Covers job types, SCF convergence, integration grids,
 * dispersion corrections, population analysis, and output verbosity.
 */

export const jobTypes = [
  {
    keyword: 'SP',
    name: 'Single Point Energy',
    description: 'Calculate energy at current geometry',
    popular: true,
  },
  {
    keyword: 'Opt',
    name: 'Geometry Optimization',
    description: 'Find minimum energy structure',
    popular: true,
  },
  {
    keyword: 'Opt Freq',
    name: 'Optimization + Frequency',
    description: 'Optimize then compute vibrational frequencies',
    popular: true,
  },
  {
    keyword: 'Freq',
    name: 'Frequency Analysis',
    description: 'Vibrational frequencies and thermochemistry',
    popular: true,
  },
  {
    keyword: 'Opt=(TS,CalcFC,NoEigenTest)',
    name: 'TS Optimization',
    description: 'Transition state search',
    popular: true,
  },
  {
    keyword: 'IRC=(CalcFC,MaxPoints=50)',
    name: 'IRC Path',
    description: 'Intrinsic reaction coordinate following',
  },
  {
    keyword: 'Scan',
    name: 'PES Scan',
    description: 'Potential energy surface scan',
  },
  {
    keyword: 'TD=(NStates=6)',
    name: 'TD-DFT (Excited States)',
    description: 'Time-dependent DFT for UV-Vis',
    popular: true,
  },
  {
    keyword: 'NMR',
    name: 'NMR Shielding',
    description: 'NMR chemical shift prediction',
  },
  {
    keyword: 'Stable',
    name: 'Stability Analysis',
    description: 'Test wavefunction stability',
  },
  {
    keyword: 'Polar',
    name: 'Polarizability',
    description: 'Polarizability and hyperpolarizability',
  },
  {
    keyword: 'Force',
    name: 'Force Calculation',
    description: 'Compute forces/gradients',
  },
  {
    keyword: 'Volume',
    name: 'Molecular Volume',
    description: 'Calculate molecular volume',
  },
];

export const scfOptions = [
  {
    keyword: '',
    name: 'Default',
    description: 'Default SCF convergence',
  },
  {
    keyword: 'SCF=Tight',
    name: 'Tight',
    description: 'Tighter convergence criteria',
  },
  {
    keyword: 'SCF=(Tight,MaxCycle=200)',
    name: 'Tight + Max 200 cycles',
    description: 'Tight convergence with more iterations',
  },
  {
    keyword: 'SCF=QC',
    name: 'Quadratically Convergent',
    description: 'For difficult convergence cases',
  },
  {
    keyword: 'SCF=XQC',
    name: 'Extra QC',
    description: 'Fallback to QC if normal SCF fails',
  },
];

export const integrationGrids = [
  {
    keyword: '',
    name: 'Default (UltraFine in G16)',
    description: 'Standard integration grid',
  },
  {
    keyword: 'Int=UltraFine',
    name: 'UltraFine',
    description: 'Recommended for DFT (99,590)',
  },
  {
    keyword: 'Int=SuperFine',
    name: 'SuperFine',
    description: 'Extra fine grid for difficult cases',
  },
  {
    keyword: 'Int=FineGrid',
    name: 'Fine',
    description: 'Coarser grid (legacy)',
  },
];

export const dispersionCorrections = [
  {
    keyword: '',
    name: 'None',
    description: 'No dispersion correction',
  },
  {
    keyword: 'EmpiricalDispersion=GD3',
    name: 'GD3',
    description: "Grimme's D3 dispersion",
  },
  {
    keyword: 'EmpiricalDispersion=GD3BJ',
    name: 'GD3BJ',
    description: 'D3 with Becke-Johnson damping (recommended)',
  },
  {
    keyword: 'EmpiricalDispersion=GD2',
    name: 'GD2',
    description: "Grimme's D2 dispersion (older)",
  },
];

export const populationAnalysis = [
  {
    keyword: '',
    name: 'Default (Mulliken)',
    description: 'Standard Mulliken population',
  },
  {
    keyword: 'Pop=Full',
    name: 'Full',
    description: 'Full population analysis with all MO coefficients',
  },
  {
    keyword: 'Pop=NBO',
    name: 'NBO',
    description: 'Natural Bond Orbital analysis',
  },
  {
    keyword: 'Pop=MK',
    name: 'Merz-Kollman',
    description: 'Merz-Kollman ESP charges',
  },
  {
    keyword: 'Pop=CHELPG',
    name: 'CHELPG',
    description: 'CHELPG ESP charges',
  },
  {
    keyword: 'Pop=NPA',
    name: 'NPA',
    description: 'Natural Population Analysis',
  },
];

export const outputVerbosity = [
  {
    prefix: '#N',
    name: 'Normal',
    description: 'Standard output',
  },
  {
    prefix: '#P',
    name: 'Verbose',
    description: 'Additional detail',
  },
  {
    prefix: '#T',
    name: 'Terse',
    description: 'Minimal output',
  },
];
