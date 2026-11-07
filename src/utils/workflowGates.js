export function evaluateWorkflowOutput(task, section) {
  if (!task || !task.gates || !section) throw new TypeError('A workflow task and parsed output section are required.');
  const gates = [];
  const terminationEvidence = section.termination || firstError(section);

  gates.push(makeGate(
    'Normal termination',
    true,
    section.status === 'completed' && /\bNormal termination of Gaussian\b/i.test(section.termination?.text || '') ? 'pass'
      : section.status === 'error' || /\bError termination\b/i.test(section.termination?.text || '') ? 'fail'
        : 'unknown',
    terminationEvidence?.line ?? null,
    terminationEvidence?.text ?? null,
  ));

  const scfStatus = section.scf?.status || 'unknown';
  const scfIsFailure = scfStatus === 'failed';
  gates.push(makeGate(
    'SCF convergence',
    task.gates.requireScfRecord === true || scfIsFailure,
    scfStatus === 'converged' && Number(section.scf?.records) > 0 ? 'pass'
      : scfIsFailure ? 'fail' : 'unknown',
    section.scf?.line ?? null,
    section.scf?.evidence ?? null,
  ));

  if (task.gates.requireOptimizationComplete) {
    const status = section.optimization?.status || 'unknown';
    gates.push(makeGate(
      'Optimization',
      true,
      status === 'converged' ? 'pass' : status === 'not converged' ? 'fail' : 'unknown',
      section.optimization?.line ?? null,
      section.optimization?.evidence ?? null,
    ));
  }

  if (task.gates.requireFrequencyRecord) {
    const frequencyCount = section.frequencies?.count;
    gates.push(makeGate(
      'Frequency record',
      true,
      Number.isInteger(frequencyCount) && frequencyCount > 0 ? 'pass' : 'unknown',
      section.frequencies?.line ?? null,
      section.frequencies?.evidence ?? null,
    ));
  }

  if (task.gates.expectedImaginaryModes !== null && task.gates.expectedImaginaryModes !== undefined) {
    const frequencyCount = section.frequencies?.count;
    const modeCount = section.frequencies?.imaginaryCount;
    const result = !Number.isInteger(frequencyCount) || !Number.isInteger(modeCount) ? 'unknown'
      : modeCount === task.gates.expectedImaginaryModes ? 'pass' : 'fail';
    gates.push(makeGate(
      'Imaginary-mode count',
      true,
      result,
      section.frequencies?.line ?? null,
      section.frequencies?.evidence ?? null,
    ));
  }

  const required = gates.filter(gate => gate.required);
  const overall = required.some(gate => gate.result === 'fail') ? 'fail'
    : required.some(gate => gate.result === 'unknown') ? 'unknown'
      : 'pass';
  return { overall, gates };
}

function makeGate(name, required, result, line, evidence) {
  return { name, required, result, line, evidence };
}

function firstError(section) {
  return section.diagnostics?.find(item => item.kind === 'error') || null;
}
