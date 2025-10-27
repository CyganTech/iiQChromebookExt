// TODO: Replace with real popup UI logic wired to incidentIQ APIs.
document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  if (app) {
    app.insertAdjacentHTML(
      'beforeend',
      '<small class="status">Device sync status and ticket shortcuts coming soon.</small>'
    );
  }
});
