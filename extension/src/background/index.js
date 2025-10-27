import { handleTelemetryAlarms, initializeTelemetryPipeline } from './telemetry.js';
import { registerPopupMessageHandlers } from './popup-api.js';

console.log('iiQ Chromebook Companion background service worker initialized.');

chrome.runtime.onInstalled.addListener(() => {
  initializeTelemetryPipeline();
});

chrome.runtime.onStartup.addListener(() => {
  initializeTelemetryPipeline();
});

chrome.alarms.onAlarm.addListener(handleTelemetryAlarms);

initializeTelemetryPipeline();
registerPopupMessageHandlers();
