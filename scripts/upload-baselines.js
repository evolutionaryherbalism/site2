const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const snapshotsDir = 'tests/visual-regression.spec.js-snapshots';
const manifestPath = 'r2-paths.json';
const bucket = process.env.BUCKET;
const endpoint = process.env.AWS_ENDPOINT_URL;
const publicUrl = process.env.R2_PUBLIC_URL;

if (!bucket || !endpoint) {
  console.log('Missing BUCKET or AWS_ENDPOINT_URL. Skipping baseline upload.');
  process.exit(0);
}

function walkPngFiles(dir, results) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkPngFiles(fullPath, results);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.png')) {
      results.push(fullPath);
    }
  }
}

const pngFiles = [];
walkPngFiles(snapshotsDir, pngFiles);

if (pngFiles.length === 0) {
  console.log('No baseline snapshots found to upload.');
  fs.writeFileSync(manifestPath, JSON.stringify({}, null, 2));
  process.exit(0);
}

const r2Paths = {};
const uniqueSuffix = process.env.RUN_ID || `${Date.now()}`;

for (const file of pngFiles) {
  const baseName = path.basename(file, '.png');
  const sitename = baseName.replace(/-chromium-[a-z]*$/, '');
  const stablePath = `baselines/${sitename}.png`;
  const uniquePath = `baselines/${sitename}-${uniqueSuffix}.png`;

  execFileSync(
    'aws',
    ['s3', 'cp', file, `s3://${bucket}/${stablePath}`, '--endpoint-url', endpoint],
    { stdio: 'inherit', env: process.env }
  );

  execFileSync(
    'aws',
    ['s3', 'cp', file, `s3://${bucket}/${uniquePath}`, '--endpoint-url', endpoint],
    { stdio: 'inherit', env: process.env }
  );

  console.log(`Uploaded baseline: ${stablePath}`);
  console.log(`Uploaded baseline (unique): ${uniquePath}`);

  if (publicUrl) {
    r2Paths[`baseline:${sitename}`] = `${publicUrl}/${uniquePath}`;
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(r2Paths, null, 2));
