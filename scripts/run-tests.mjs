import fs from 'node:fs';
import path from 'node:path';
import createJiti from 'jiti';

const jiti = createJiti(process.cwd() + '/');
const testsDir = path.join(process.cwd(), 'tests');

if (!fs.existsSync(testsDir)) {
  console.error('No tests directory found.');
  process.exit(1);
}

const testFiles = fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.mjs') || f.endsWith('.test.ts'));

console.log(`\n=== Running ${testFiles.length} Test Suites ===\n`);

for (const file of testFiles) {
  const fullPath = path.join(testsDir, file);
  console.log(`▶ Executing: ${file}`);
  try {
    jiti(fullPath);
  } catch (err) {
    console.error(`✖ Error loading test ${file}:`, err);
    process.exitCode = 1;
  }
}

