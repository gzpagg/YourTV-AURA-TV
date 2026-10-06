import { existsSync, readFileSync, appendFileSync } from 'node:fs';

const file = 'playwright-results.json';
if (!existsSync(file)) {
  console.log('No Playwright result file was produced; inspect the preceding setup step.');
  process.exit(0);
}
const report = JSON.parse(readFileSync(file, 'utf8'));
const failures = [];
function visit(suites) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        if (!['unexpected', 'flaky'].includes(test.status)) continue;
        const errors = test.results.flatMap(result => result.errors ?? []).map(error => error.message ?? String(error));
        failures.push({ title: spec.title, file: spec.file, line: spec.line, text: errors.join('\n') });
      }
    }
    visit(suite.suites);
  }
}
visit(report.suites);
const clean = value => String(value).replace(/\u001b\[[0-9;]*m/g, '');
const escapeCommand = value => clean(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
for (const failure of failures.slice(0, 10)) {
  console.log(`::error title=Browser test failure::${escapeCommand(`${failure.title}\n${failure.file}:${failure.line}\n${failure.text.slice(0, 6000)}`)}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const escapeHtml = value => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Browser test results\n\n${failures.length} failing tests.\n\n${failures.map(f => `<details><summary>${escapeHtml(f.title)}</summary><pre>${escapeHtml(f.text)}</pre></details>`).join('\n')}\n`);
}
console.log(JSON.stringify({ passed: report.stats?.expected, failed: report.stats?.unexpected, skipped: report.stats?.skipped }));
