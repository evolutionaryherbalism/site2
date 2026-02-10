const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Load URL configuration from env var (CI) or file (local)
function loadConfig() {
  if (process.env.URLS_CONFIG) {
    return yaml.load(process.env.URLS_CONFIG);
  }
  const configPath = path.join(__dirname, '..', 'urls.yml');
  return yaml.load(fs.readFileSync(configPath, 'utf8'));
}

// Parse period string (15m, 2h, 3d) to minutes
function periodToMinutes(period) {
  const match = period.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid period format: ${period}`);

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  switch (unit) {
    case 'm': return num;
    case 'h': return num * 60;
    case 'd': return num * 60 * 24;
    default: throw new Error(`Invalid period unit: ${unit}`);
  }
}

// Check if current time matches period (within 15-minute window)
function shouldRunNow(period) {
  const minutes = periodToMinutes(period);
  const now = new Date();
  const minutesSinceEpoch = Math.floor(now.getTime() / 60000);

  const remainder = minutesSinceEpoch % minutes;
  return remainder < 15;
}

const config = loadConfig();

// Manual runs or local: always test everything
if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' || !process.env.CI) {
  console.log(`All ${config.sites.length} site(s) eligible (manual/local run)`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', 'has_tests=true\n');
  process.exit(0);
}

// Scheduled runs: check if any sites match
const matched = config.sites.filter(site => shouldRunNow(site.period));

if (matched.length > 0) {
  console.log(`${matched.length} site(s) due for testing: ${matched.map(s => s.name).join(', ')}`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT, 'has_tests=true\n');
} else {
  console.log('No sites due for testing in this time window');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, 'has_tests=false\n');
}
