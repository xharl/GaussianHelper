import { describe, expect, it } from 'vitest';
import { escapeHtml, formatGaussianResultsCsv, GaussianOutputInspector } from '../src/components/GaussianOutputInspector.js';

describe('Gaussian output report helpers', () => {
  it('HTML-escapes untrusted filenames and log excerpts', () => {
    expect(escapeHtml('<svg/onload="run()"> & text'))
      .toBe('&lt;svg/onload=&quot;run()&quot;&gt; &amp; text');
  });

  it('renders filenames and source excerpts as escaped text', () => {
    const inspector = Object.create(GaussianOutputInspector.prototype);
    const html = inspector.renderFileResult({
      filename: '<img src=x onerror=alert(1)>.log',
      summary: { status: 'completed', completed: 1, errors: 0, incomplete: 0 },
      sections: [{
        index: 1,
        status: 'completed',
        termination: { line: 5, text: 'Normal termination <script>bad</script>' },
        scf: { status: 'unknown', method: null, energyHartree: null, records: 0, line: 2, evidence: '<svg/onload=bad()>' },
        optimization: { status: 'unknown', line: null, evidence: null },
        frequencies: { count: null, imaginaryCount: 0, imaginaryValues: [], minImaginary: null, line: null, evidence: null },
        diagnostics: [],
        omittedDiagnostics: 0,
      }],
    });

    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;.log');
    expect(html).toContain('&lt;svg/onload=bad()&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>bad</script>');
  });

  it('analyzes selected local streams and stores only parsed summaries', async () => {
    const container = { innerHTML: '', querySelector: () => null };
    const inspector = new GaussianOutputInspector(container);
    const file = new Blob(['SCF Done: E(RHF) = -1.0D+00 A.U. after 2 cycles\nNormal termination of Gaussian 16\n']);
    Object.defineProperty(file, 'name', { value: 'local.log' });

    await inspector.processFiles([file]);

    expect(inspector.results).toHaveLength(1);
    expect(inspector.results[0].filename).toBe('local.log');
    expect(inspector.results[0].sections[0].scf.energyHartree).toBe(-1);
    expect(inspector.results[0].summary.status).toBe('completed');
    expect(container.innerHTML).toContain('local.log');
  });

  it('exports one CSV row per section with quoting and formula-injection protection', () => {
    const results = [{
      filename: '=HYPERLINK("https://bad")',
      sections: [{
        index: 1,
        status: 'error',
        termination: { line: 12, text: 'Error termination, via Lnk1e' },
        scf: { status: 'failed', method: 'UB3LYP', energyHartree: -25.5, records: 2 },
        optimization: { status: 'unknown' },
        frequencies: { count: null, imaginaryCount: 0, imaginaryValues: [], minImaginary: null },
        diagnostics: [{ kind: 'error', line: 11, text: 'bad, "quoted" line' }],
      }],
    }];

    const csv = formatGaussianResultsCsv(results);
    const rows = csv.split('\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain('"\'=HYPERLINK(""https://bad"")"');
    expect(rows[1]).toContain('"Error termination, via Lnk1e"');
    expect(rows[1]).toContain('"error (line 11): bad, ""quoted"" line"');
    expect(rows[1]).toContain(',-25.5,');
  });
});
