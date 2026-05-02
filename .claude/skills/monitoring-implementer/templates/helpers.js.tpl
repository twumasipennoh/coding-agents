/**
 * {{PROJECT_DISPLAY_NAME}} — Monitoring Helpers (GCP API Wrappers)
 *
 * Idempotent helpers for GCP Cloud Monitoring v3 and Cloud Logging v2.
 * All functions support --dry-run mode and retry with exponential backoff.
 */

const { AlertPolicyServiceClient, NotificationChannelServiceClient, UptimeCheckServiceClient } =
  require("@google-cloud/monitoring");
const { v2: { MetricsServiceV2Client } } = require("@google-cloud/logging");

const TRANSIENT_CODES = new Set([8, 14]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;

async function withRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try { return await fn(); } catch (err) {
      lastErr = err;
      if (!TRANSIENT_CODES.has(err.code)) throw err;
      if (attempt < MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

let _channelClient, _alertClient, _uptimeClient, _metricsClient;
function channelClient() { return (_channelClient ??= new NotificationChannelServiceClient()); }
function alertClient()   { return (_alertClient   ??= new AlertPolicyServiceClient()); }
function uptimeClient()  { return (_uptimeClient  ??= new UptimeCheckServiceClient()); }
function metricsClient() { return (_metricsClient ??= new MetricsServiceV2Client()); }

async function ensureNotificationChannel(projectId, email, dryRun) {
  if (dryRun) { console.log(`[dry-run] Would ensure email channel for ${email}`); return `dry-run:channel:${email}`; }
  const client = channelClient();
  const name = client.projectPath(projectId);
  const [channels] = await withRetry(() => client.listNotificationChannels({ name, filter: `type = "email" AND labels.email_address = "${email}"` }));
  if (channels.length > 0) { console.log(`Found channel: ${channels[0].name}`); return channels[0].name; }
  const [created] = await client.createNotificationChannel({ name, notificationChannel: { type: "email", displayName: `Email — ${email}`, labels: { email_address: email } } });
  console.log(`Created channel: ${created.name}`); return created.name;
}

async function ensureAlertPolicy(projectId, policy, dryRun) {
  if (dryRun) { console.log(`[dry-run] Would ensure alert: ${policy.displayName}`); return; }
  const client = alertClient();
  const name = client.projectPath(projectId);
  const [existing] = await withRetry(() => client.listAlertPolicies({ name, filter: `display_name = "${policy.displayName}"` }));
  if (existing.length > 0) {
    const [updated] = await client.updateAlertPolicy({ alertPolicy: { ...policy, name: existing[0].name } });
    console.log(`Updated alert: ${updated.name}`); return updated.name;
  }
  const [created] = await client.createAlertPolicy({ name, alertPolicy: policy });
  console.log(`Created alert: ${created.name}`); return created.name;
}

async function ensureUptimeCheck(projectId, config, dryRun) {
  if (dryRun) { console.log(`[dry-run] Would ensure uptime: ${config.displayName}`); return; }
  const client = uptimeClient();
  const parent = client.projectPath(projectId);
  const [checks] = await withRetry(() => client.listUptimeCheckConfigs({ parent }));
  const match = checks.find((c) => c.displayName === config.displayName);
  if (match) {
    const [updated] = await client.updateUptimeCheckConfig({ uptimeCheckConfig: { ...config, name: match.name } });
    console.log(`Updated uptime: ${updated.name}`); return updated.name;
  }
  const [created] = await client.createUptimeCheckConfig({ parent, uptimeCheckConfig: config });
  console.log(`Created uptime: ${created.name}`); return created.name;
}

async function ensureLogMetric(projectId, metric, dryRun) {
  if (dryRun) { console.log(`[dry-run] Would ensure metric: ${metric.name}`); return; }
  const client = metricsClient();
  const metricName = `projects/${projectId}/metrics/${encodeURIComponent(metric.name)}`;
  let exists = false;
  try { await client.getLogMetric({ metricName }); exists = true; } catch (err) { if (err.code !== 5) throw err; }
  if (exists) {
    await client.updateLogMetric({ metricName, metric: { ...metric, name: metricName } });
    console.log(`Updated metric: ${metric.name}`); return;
  }
  await client.createLogMetric({ parent: `projects/${projectId}`, metric });
  console.log(`Created metric: ${metric.name}`);
}

async function createEscalationAlerts(projectId, featureName, metricFilter, tiers, notificationChannel, opts = {}, dryRun = false) {
  for (const tier of tiers) {
    const alertStrategy = opts.autoCloseSeconds ? { autoClose: { seconds: opts.autoCloseSeconds } } : {};
    const policy = {
      displayName: `{{METRIC_PREFIX}} — ${featureName} ${tier.label}`,
      combiner: "OR",
      notificationChannels: [notificationChannel],
      ...(Object.keys(alertStrategy).length > 0 && { alertStrategy }),
      documentation: { mimeType: "text/markdown", content: opts.documentation || `${featureName} — ${tier.label}: >${tier.threshold} in ${tier.windowSeconds}s.` },
      conditions: [{ displayName: `${featureName} — ${tier.label}`, conditionThreshold: { filter: metricFilter, comparison: "COMPARISON_GT", thresholdValue: tier.threshold, duration: { seconds: 0 }, aggregations: [{ alignmentPeriod: { seconds: tier.windowSeconds }, perSeriesAligner: "ALIGN_SUM" }] } }],
    };
    await ensureAlertPolicy(projectId, policy, dryRun);
  }
}

module.exports = { ensureNotificationChannel, ensureAlertPolicy, ensureUptimeCheck, ensureLogMetric, createEscalationAlerts };
