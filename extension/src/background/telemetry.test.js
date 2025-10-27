import { afterEach, describe, expect, it, vi } from 'vitest';

const userAgent = 'Mozilla/5.0 (X11; CrOS x86_64 14816.66.0) AppleWebKit/537.36';

function createChromeMock(overrides = {}) {
  const storageState = { lastTelemetryCheckin: '2024-01-01T00:00:00.000Z' };

  const base = {
    enterprise: {
      deviceAttributes: {
        getDeviceAssetId: (cb) => cb('ASSET-123'),
        getDeviceSerialNumber: (cb) => cb('SERIAL-123'),
        getDirectoryDeviceId: (cb) => cb('DEVICE-123'),
        getDeviceUser: (cb) => cb('user@example.com'),
        getOsVersion: (cb) => cb('ChromeOS 14816.66.0')
      }
    },
    runtime: {
      lastError: undefined,
      getPlatformInfo: (cb) => cb({ os: 'CrOS' })
    },
    system: {
      network: {
        getNetworkInterfaces: (cb) =>
          cb([
            { name: 'eth0', address: '192.168.0.10' },
            { name: 'lo', address: '127.0.0.1' }
          ])
      }
    },
    storage: {
      local: {
        get: (_keys, cb) => cb({ lastTelemetryCheckin: storageState.lastTelemetryCheckin }),
        set: (items, cb) => {
          storageState.lastTelemetryCheckin = items.lastTelemetryCheckin;
          cb();
        }
      }
    }
  };

  return { ...base, ...overrides, __storageState: storageState };
}

async function loadTelemetry(chromeMock) {
  vi.resetModules();
  globalThis.chrome = chromeMock;
  globalThis.navigator = { userAgent };
  return import('./telemetry.js');
}

describe('telemetry helpers', () => {
  afterEach(() => {
    delete globalThis.chrome;
    delete globalThis.navigator;
  });

  it('collectDeviceTelemetry returns expected device snapshot', async () => {
    const chromeMock = createChromeMock();
    const telemetryModule = await loadTelemetry(chromeMock);
    const telemetry = await telemetryModule.collectDeviceTelemetry();

    expect(telemetry).toMatchObject({
      assetTag: 'ASSET-123',
      serialNumber: 'SERIAL-123',
      deviceId: 'DEVICE-123',
      currentUser: 'user@example.com',
      localIpAddress: '192.168.0.10',
      osVersion: 'ChromeOS 14816.66.0',
      lastCheckinTime: '2024-01-01T00:00:00.000Z'
    });
  });

  it('handleTelemetryAlarms invokes pushDeviceTelemetry for the expected alarm', async () => {
    const chromeMock = createChromeMock();
    const telemetryModule = await loadTelemetry(chromeMock);

    telemetryModule.handleTelemetryAlarms({ name: 'other-alarm' });
    expect(chromeMock.__storageState.lastTelemetryCheckin).toBe('2024-01-01T00:00:00.000Z');

    telemetryModule.handleTelemetryAlarms({ name: 'iiq-telemetry-sync' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(chromeMock.__storageState.lastTelemetryCheckin).not.toBe('2024-01-01T00:00:00.000Z');
  });
});
