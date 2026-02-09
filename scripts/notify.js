const fs = require('fs');
const yaml = require('js-yaml');

// Parse --mode argument: "failure" (only failed tests) or "always" (all tests)
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex !== -1 ? process.argv[modeIndex + 1] : 'always';

const webhookUrl = mode === 'failure'
  ? process.env.WEBHOOK_URL
  : process.env.WEBHOOK_URL_ALWAYS;

if (!webhookUrl) {
  console.log(`No webhook URL configured for mode: ${mode}`);
  process.exit(0);
}

const resultsPath = 'test-results/results.json';
if (!fs.existsSync(resultsPath)) {
  console.log('No test results found, skipping notification.');
  process.exit(0);
}

const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
const reportUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

// Load R2 paths mapping (written by the R2 upload step)
let r2Paths = {};
if (fs.existsSync('r2-paths.json')) {
  r2Paths = JSON.parse(fs.readFileSync('r2-paths.json', 'utf8'));
}

// Load site config for URL lookup
const config = process.env.URLS_CONFIG
  ? yaml.load(process.env.URLS_CONFIG)
  : yaml.load(fs.readFileSync('urls.yml', 'utf8'));

const sitesMap = new Map(config.sites.map(s => [s.name, s.url]));

// Build notification payloads from test results
const notifications = [];

for (const suite of (results.suites || [])) {
  for (const spec of (suite.specs || [])) {
    const passed = spec.ok;

    // In failure mode, skip passed tests
    if (mode === 'failure' && passed) continue;

    const match = spec.title.match(/^(.+?) \((.+?)\)$/);
    const name = match ? match[1] : spec.title;
    const url = sitesMap.get(name) || 'unknown';

    const emoji = passed ? '\u2705' : '\u274C';
    const statusText = passed ? 'Passed' : 'Failed';

    const screenshotUrl = r2Paths[`${name}-diff`]
      || r2Paths[`${name}-actual`]
      || r2Paths[`${name}-current`]
      || null;
    const baselineUrl = r2Paths[`${name}-baseline`] || null;

    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${emoji} Visual Regression ${statusText}: ${name}*\n<${url}|View Page> | <${reportUrl}|View Report>`
        }
      }
    ];

    if (baselineUrl) {
      blocks.push(
        { type: 'image', image_url: baselineUrl, alt_text: 'Baseline screenshot' },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '_Baseline_' }] }
      );
    }

    if (screenshotUrl) {
      const imageLabel = passed ? 'Current' : 'Current (with diff)';
      blocks.push(
        { type: 'image', image_url: screenshotUrl, alt_text: imageLabel },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `_${imageLabel}_` }] }
      );
    }

    notifications.push({
      text: `Visual Regression ${statusText}: ${name}`,
      blocks
    });
  }
}

if (notifications.length === 0) {
  console.log(`No notifications to send (mode: ${mode}).`);
  process.exit(0);
}

// Send notifications sequentially with proper await
async function sendNotifications() {
  let sent = 0;
  for (const payload of notifications) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        console.error(`Webhook returned ${response.status}: ${await response.text()}`);
      } else {
        sent++;
      }
    } catch (err) {
      console.error(`Webhook failed for "${payload.text}":`, err.message);
    }
  }
  console.log(`Sent ${sent}/${notifications.length} notification(s) in ${mode} mode.`);
}

sendNotifications();
