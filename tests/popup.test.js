import { jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/dom';

// Prevent the popup from auto-initializing when the module is imported.
window.__IIQ_DISABLE_POPUP_AUTO_INIT__ = true;

import { createPopupController } from '../extension/src/popup/popup.js';

const TEMPLATE = `
  <main data-role="app">
    <section data-role="status-card" data-health="unknown">
      <p data-role="status-message">Checking…</p>
      <p data-role="status-meta">Last sync —</p>
    </section>
    <section data-role="ticket-card">
      <p data-role="ticket-description">Open an iiQ ticket with your device details.</p>
      <button type="button" data-role="primary-action" disabled>Submit Ticket</button>
    </section>
    <section data-role="shortcut-section" hidden>
      <ul data-role="shortcut-list"></ul>
    </section>
    <div data-role="feedback" hidden>
      <p data-role="feedback-message"></p>
      <button type="button" data-role="retry-button">Try Again</button>
    </div>
  </main>
`;

function setupDom() {
  document.body.innerHTML = TEMPLATE;
}

describe('popup controller', () => {
  beforeEach(() => {
    setupDom();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders healthy device status and enables the ticket button', async () => {
    const now = new Date('2024-01-01T12:00:00Z').getTime();
    const runtime = {
      sendMessage: jest.fn((message, callback) => {
        callback({
          ok: true,
          data: {
            deviceStatus: {
              health: 'healthy',
              summary: 'Device is syncing normally.',
              lastSuccessfulSyncTime: '2024-01-01T11:30:00Z',
            },
            ticketShortcuts: [
              {
                id: 'submit-ticket',
                label: 'Submit Ticket',
                description: 'Open ticket',
                url: 'https://tenant.incidentiq.com/app/tickets/new',
                featured: true,
              },
            ],
          },
        });
      }),
    };

    const tabs = { create: jest.fn() };

    const controller = createPopupController({
      document,
      runtime,
      tabs,
      windowRef: window,
      now: () => now,
    });

    controller.init();

    await waitFor(() => expect(screen.getByText('Device is syncing normally.')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /submit ticket/i })).toBeEnabled();
    expect(screen.getByText(/30 minutes ago/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /submit ticket/i }));
    expect(tabs.create).toHaveBeenCalledWith({ url: 'https://tenant.incidentiq.com/app/tickets/new' });
  });

  it('shows error feedback when telemetry fails to load', async () => {
    const runtime = {
      sendMessage: jest.fn((message, callback) => {
        callback({ ok: false, error: { message: 'Managed policy missing' } });
      }),
    };

    const controller = createPopupController({ document, runtime, windowRef: window });
    controller.init();

    await waitFor(() => expect(screen.getByText(/managed policy missing/i)).toBeVisible());
    expect(screen.getByRole('button', { name: /submit ticket/i })).toBeDisabled();
  });

  it('disables ticket submission when shortcuts are unavailable', async () => {
    const runtime = {
      sendMessage: jest.fn((message, callback) => {
        callback({
          ok: true,
          data: {
            deviceStatus: {
              health: 'degraded',
              summary: 'Device sync is stale. A new check-in is recommended.',
              lastSuccessfulSyncTime: null,
            },
            ticketShortcuts: [],
          },
        });
      }),
    };

    const controller = createPopupController({ document, runtime, windowRef: window, tabs: null });
    controller.init();

    await waitFor(() => expect(screen.getByText(/Device sync is stale/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /submit ticket/i })).toBeDisabled();
  });
});
