// Keep initialization failures visible even if a module or the SDK CDN fails.
(() => {
  const notice = document.querySelector('[data-backend-notice]');
  const button = document.querySelector(
    '#login-form [type="submit"], #register-form [type="submit"]',
  );
  const showError = (message) => {
    if (notice) {
      notice.textContent = message;
      notice.className = 'backend-notice is-error';
    }
    if (button) button.disabled = true;
  };
  const timeout = window.setTimeout(() => {
    showError(
      '[AUTH] Account setup is taking too long. Check your connection and reload this page.',
    );
  }, 15000);

  import('./auth-forms.js')
    .then((module) => module.authFormsReady)
    .catch(() => {
      showError(
        '[AUTH] Unable to initialize account forms. Check your connection and reload this page.',
      );
    })
    .finally(() => window.clearTimeout(timeout));
})();
