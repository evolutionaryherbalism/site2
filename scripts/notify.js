const fs = require('fs');
const yaml = require('js-yaml');

// Parse --mode argument: "failure" (only failed tests), "always" (all tests), or "baseline" (baseline update)
const modeIndex = process.argv.indexOf('--mode');
const mode = modeIndex !== -1 ? process.argv[modeIndex + 1] : 'always';

const MODES = {
  failure: { webhookEnv: 'WEBHOOK_URL', useResults: true, failuresOnly: true, allowFallback: true },
  always: { webhookEnv: 'WEBHOOK_URL_ALWAYS', useResults: true, failuresOnly: false, allowFallback: true },
  baseline: { webhookEnv: 'WEBHOOK_URL_ALWAYS', useResults: false, failuresOnly: false, allowFallback: false },
  'baseline-failure': { webhookEnv: 'WEBHOOK_URL', useResults: false, failuresOnly: false, allowFallback: false }
};

const modeConfig = MODES[mode];
if (!modeConfig) {
  console.log(`Unknown mode: ${mode}. Available modes: ${Object.keys(MODES).join(', ')}`);
  process.exit(1);
}

const webhookUrl = process.env[modeConfig.webhookEnv];
if (!webhookUrl) {
  console.log(`No webhook URL configured for mode: ${mode}`);
  process.exit(0);
}

const reportUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

// Load R2 paths mapping (written by the R2 upload step)
let r2Paths = {};
if (fs.existsSync('r2-paths.json')) {
  r2Paths = JSON.parse(fs.readFileSync('r2-paths.json', 'utf8'));
}
function buildBaselineNotifications() {
  const status = process.env.STATUS || 'unknown';
  const emoji = status === 'success' ? '\u2705' : '\u274C';
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${emoji} Update Baselines: ${status}*\n<${reportUrl}|View Report>`
      }
    }
  ];

  if (status === 'success') {
    const baselineEntries = Object.entries(r2Paths)
      .filter(([key, value]) => key.startsWith('baseline:') && value)
      .sort(([a], [b]) => a.localeCompare(b));

    const total = baselineEntries.length;
    const shown = baselineEntries.slice(0, 20);

    for (const [, url] of shown) {
      blocks.push({ type: 'image', image_url: url, alt_text: 'Baseline screenshot' });
    }

    if (total > 20) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `showing ${shown.length}/${total} baseline screenshots` }]
      });
    }
  }

  return [{ text: `Update Baselines: ${status}`, blocks }];
}

function loadResults() {
  const resultsPath = 'test-results/results.json';
  if (!fs.existsSync(resultsPath)) {
    console.log('No test results found, skipping notification.');
    process.exit(0);
  }
  return JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
}

function loadSitesConfig() {
  const config = process.env.URLS_CONFIG
    ? yaml.load(process.env.URLS_CONFIG)
    : yaml.load(fs.readFileSync('urls.yml', 'utf8'));
  return new Map(config.sites.map(s => [s.name, s.url]));
}

async function sendNotifications(notifications, { allowFallback }) {
  let sent = 0;
  for (const payload of notifications) {
    try {
      console.log(`Sending payload: ${JSON.stringify(payload)}`);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Webhook returned ${response.status}: ${errorText}`);
        if (allowFallback && response.status === 400 && payload.blocks) {
          console.log('Retrying with text-only payload...');
          const fallback = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: payload.text })
          });
          if (fallback.ok) {
            sent++;
            console.log('Text-only fallback succeeded.');
          } else {
            console.error(`Text-only fallback also failed: ${fallback.status}`);
          }
        }
      } else {
        sent++;
      }
    } catch (err) {
      console.error(`Webhook failed for "${payload.text}":`, err.message);
    }
  }
  console.log(`Sent ${sent}/${notifications.length} notification(s) in ${mode} mode.`);
}

if (!modeConfig.useResults) {
  const notifications = buildBaselineNotifications();
  sendNotifications(notifications, { allowFallback: false });
  return;
}

const results = loadResults();

// Load site config for URL lookup
const sitesMap = loadSitesConfig();

// Build notification payloads from test results
const notifications = [];

for (const suite of (results.suites || [])) {
  for (const spec of (suite.specs || [])) {
    const passed = spec.ok;

    // In failure mode, skip passed tests
    if (modeConfig.failuresOnly && passed) continue;

    const match = spec.title.match(/^(.+?) \((.+?)\)$/);
    const name = match ? match[1] : spec.title;
    const url = sitesMap.get(name) || 'unknown';

    const emoji = passed ? '\u2705' : '\u274C';
    const statusText = passed ? 'Passed' : 'Failed';

    const screenshotUrl = r2Paths[`${name}-actual`]
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
      const imageLabel = 'Current';
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

sendNotifications(notifications, { allowFallback: modeConfig.allowFallback });
