import { handleTelemetryAlarms, initializeTelemetryPipeline, refreshTelemetryConfiguration } from './telemetry.js';
import { SETTINGS_STORAGE_KEY } from '../options/options.js';

console.log('iiQ Chromebook Companion background service worker initialized.');

chrome.runtime.onInstalled.addListener(() => {
  initializeTelemetryPipeline();
});

chrome.runtime.onStartup.addListener(() => {
  initializeTelemetryPipeline();
});

chrome.alarms.onAlarm.addListener(handleTelemetryAlarms);

initializeTelemetryPipeline();

chrome.storage.onChanged.addListener((changes, areaName) => {
  const changedKeys = Object.keys(changes);
  const managedPolicyKeys = new Set([
    SETTINGS_STORAGE_KEY,
    'iiqApiBaseUrl',
    'iiqTelemetryEndpoint',
    'iiqTelemetryIntervalMinutes',
    'iiqTelemetryTimeoutMs',
    'iiqApiKey',
    'iiqServiceToken',
    'iiqTokenLifetimeMinutes',
    'iiqOAuthScopes',
    'iiqTenantSubdomain',
  ]);

  const isOptionsChange =
    (areaName === 'sync' || areaName === 'managed') && Object.prototype.hasOwnProperty.call(changes, SETTINGS_STORAGE_KEY);

  const isManagedPolicyChange =
    areaName === 'managed' && changedKeys.some((key) => managedPolicyKeys.has(key) || key.startsWith('iiq'));

  if (!isOptionsChange && !isManagedPolicyChange) {
    return;
  }

  refreshTelemetryConfiguration().catch((error) => {
    console.error('Failed to refresh telemetry configuration after storage change:', error);
  });
});
