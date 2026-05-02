/**
 * {{PROJECT_DISPLAY_NAME}} — Monitoring Setup Orchestrator
 *
 * Usage: node setup-monitoring.js --tier=all --project={{DEFAULT_PROJECT_ID}} --dry-run
 */

const { ensureNotificationChannel } = require("./helpers");
const { setupCritical } = require("./critical");
const { setupHigh } = require("./high");
const { setupMedium } = require("./medium");
const { setupLow } = require("./low");

const NOTIFICATION_EMAIL = "twumasi.pennoh@gmail.com";
const TIER_ORDER = ["critical", "high", "medium", "low"];
const TIER_MAP = { critical: setupCritical, high: setupHigh, medium: setupMedium, low: setupLow };

async function run({ project, tier = "all", dryRun = false } = {}) {
  if (!project) throw new Error("--project is required");
  const validTiers = new Set([...TIER_ORDER, "all"]);
  if (!validTiers.has(tier)) throw new Error(`Invalid --tier: "${tier}"`);

  console.log(`\n=== {{PROJECT_DISPLAY_NAME}} Monitoring Setup ===`);
  console.log(`Project: ${project}  Tier: ${tier}  Dry-run: ${dryRun}\n`);

  const channelName = await ensureNotificationChannel(project, NOTIFICATION_EMAIL, dryRun);
  const tiersToRun = tier === "all" ? TIER_ORDER : [tier];
  for (const t of tiersToRun) {
    console.log(`\n--- ${t.charAt(0).toUpperCase() + t.slice(1)} Tier ---`);
    await TIER_MAP[t](project, channelName, dryRun);
  }
  console.log(`\n=== Setup complete ===\n`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const opts = {};
  for (const arg of args) {
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg.startsWith("--tier=")) opts.tier = arg.split("=")[1];
    else if (arg.startsWith("--project=")) opts.project = arg.split("=")[1];
  }
  run(opts).then(() => process.exit(0)).catch((err) => { console.error(`Error: ${err.message}`); process.exitCode = 1; });
}

module.exports = { run };
