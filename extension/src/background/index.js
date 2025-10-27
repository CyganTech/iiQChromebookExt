import {
  handleTelemetryAlarms,
  initializeTelemetryPipeline,
  resetTelemetryConfiguration,
  TELEMETRY_CONFIGURATION_KEYS,
} from './telemetry.js';
import { registerPopupMessageHandlers } from './popup-api.js';

console.log('iiQ Chromebook Companion background service worker initialized.');

chrome.runtime.onInstalled.addListener(() => {
  initializeTelemetryPipeline();
});

chrome.runtime.onStartup.addListener(() => {
  initializeTelemetryPipeline();
});

chrome.alarms.onAlarm.addListener(handleTelemetryAlarms);

if (chrome?.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'managed' && areaName !== 'sync') {
      return;
    }

    const changedKeys = Object.keys(changes ?? {});
    const hasTelemetryChange = changedKeys.some((key) => TELEMETRY_CONFIGURATION_KEYS.has(key));

    if (!hasTelemetryChange) {
      return;
    }

    console.info('Telemetry configuration updated; resetting pipeline.', {
      areaName,
      changedKeys: changedKeys.filter((key) => TELEMETRY_CONFIGURATION_KEYS.has(key)),
    });

    resetTelemetryConfiguration();
  });
}

initializeTelemetryPipeline();
registerPopupMessageHandlers();
