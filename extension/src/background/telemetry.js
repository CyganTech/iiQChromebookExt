const TELEMETRY_ALARM_NAME = 'iiq-telemetry-sync';
const TELEMETRY_PUSH_INTERVAL_MINUTES = 60;

let pipelineInitialized = false;

const deviceAttributes = chrome?.enterprise?.deviceAttributes;

function isDeviceAttributesAvailable() {
  return Boolean(deviceAttributes);
}

function promisifyDeviceAttribute(methodName) {
  if (!isDeviceAttributesAvailable() || typeof deviceAttributes[methodName] !== 'function') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      deviceAttributes[methodName]((value) => {
        resolve(value ?? null);
      });
    } catch (error) {
      console.warn(`Failed to call chrome.enterprise.deviceAttributes.${methodName}:`, error);
      resolve(null);
    }
  });
}

async function getAssetTag() {
  return promisifyDeviceAttribute('getDeviceAssetId');
}

async function getSerialNumber() {
  return promisifyDeviceAttribute('getDeviceSerialNumber');
}

async function getDirectoryDeviceId() {
  return promisifyDeviceAttribute('getDirectoryDeviceId');
}

async function getDeviceUser() {
  return promisifyDeviceAttribute('getDeviceUser');
}

async function getOsVersionFromDeviceAttributes() {
  return promisifyDeviceAttribute('getOsVersion');
}

async function getOsVersionFromUserAgent() {
  const userAgent = globalThis.navigator?.userAgent || '';
  const match = userAgent.match(/CrOS [^\s]+ ([^\s]+)/i);
  return match ? match[1] : null;
}

function getPlatformInfo() {
  return new Promise((resolve) => {
    chrome.runtime.getPlatformInfo((info) => resolve(info));
  });
}

async function getOsVersion() {
  const deviceAttributesVersion = await getOsVersionFromDeviceAttributes();
  if (deviceAttributesVersion) {
    return deviceAttributesVersion;
  }

  const platformInfo = await getPlatformInfo();
  if (platformInfo && platformInfo.os) {
    const userAgentVersion = await getOsVersionFromUserAgent();
    if (userAgentVersion) {
      return `${platformInfo.os} ${userAgentVersion}`;
    }
    return platformInfo.os;
  }

  return null;
}

function getNetworkInterfaces() {
  return new Promise((resolve, reject) => {
    if (!chrome?.system?.network?.getNetworkInterfaces) {
      resolve([]);
      return;
    }

    try {
      chrome.system.network.getNetworkInterfaces((interfaces) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(interfaces || []);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function getLocalIpAddress() {
  if (!chrome?.system?.network?.getNetworkInterfaces) {
    return null;
  }

  try {
    const interfaces = await getNetworkInterfaces();
    const prioritized = interfaces.find(
      (iface) => Boolean(iface.address) && !iface.address.startsWith('127.')
    );
    return prioritized ? prioritized.address : (interfaces[0]?.address ?? null);
  } catch (error) {
    console.warn('Failed to read network interfaces:', error);
    return null;
  }
}

async function getLastTelemetryCheckin() {
  try {
    const lastTelemetryCheckin = await new Promise((resolve, reject) => {
      chrome.storage.local.get('lastTelemetryCheckin', (items) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve(items.lastTelemetryCheckin ?? null);
      });
    });

    return lastTelemetryCheckin;
  } catch (error) {
    console.warn('Unable to read last telemetry check-in from storage:', error);
    return null;
  }
}

async function setLastTelemetryCheckin(timestamp) {
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ lastTelemetryCheckin: timestamp }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        resolve();
      });
    });
  } catch (error) {
    console.warn('Unable to persist telemetry check-in timestamp:', error);
  }
}

export async function collectDeviceTelemetry() {
  const [
    assetTag,
    serialNumber,
    directoryDeviceId,
    currentUser,
    osVersion,
    localIpAddress,
    lastCheckinTime
  ] = await Promise.all([
    getAssetTag(),
    getSerialNumber(),
    getDirectoryDeviceId(),
    getDeviceUser(),
    getOsVersion(),
    getLocalIpAddress(),
    getLastTelemetryCheckin()
  ]);

  return {
    assetTag,
    serialNumber,
    deviceId: directoryDeviceId,
    currentUser,
    localIpAddress,
    osVersion,
    lastCheckinTime
  };
}

async function transmitTelemetryToIiq(telemetry) {
  // TODO: Replace with authenticated request to iiQ backend once API contract is available.
  console.log('Preparing to transmit telemetry payload to iiQ:', telemetry);
  await new Promise((resolve) => setTimeout(resolve, 0));
  console.log('Telemetry payload logged for future transmission.');
}

export async function pushDeviceTelemetry() {
  const telemetry = await collectDeviceTelemetry();
  const timestamp = new Date().toISOString();
  telemetry.lastCheckinTime = timestamp;

  await transmitTelemetryToIiq(telemetry);
  await setLastTelemetryCheckin(timestamp);
}

export function scheduleRecurringTelemetryPush() {
  chrome.alarms.create(TELEMETRY_ALARM_NAME, {
    periodInMinutes: TELEMETRY_PUSH_INTERVAL_MINUTES,
    delayInMinutes: 1
  });
}

export function handleTelemetryAlarms(alarm) {
  if (alarm.name !== TELEMETRY_ALARM_NAME) {
    return;
  }

  pushDeviceTelemetry().catch((error) => {
    console.error('Device telemetry push failed:', error);
  });
}

export function initializeTelemetryPipeline() {
  if (pipelineInitialized) {
    return;
  }

  pipelineInitialized = true;
  pushDeviceTelemetry().catch((error) => {
    console.error('Initial telemetry push failed:', error);
  });

  scheduleRecurringTelemetryPush();
}
