import { login, register, accountDestination } from './auth.js';

const notice = document.querySelector('[data-backend-notice]');
function setNotice(message, error = false) {
  if (notice) {
    notice.textContent = message;
    notice.className = 'backend-notice' + (error ? ' is-error' : '');
  }
}
function passwords(form) {
  const password = form.elements.password;
  const confirmation = form.elements.confirmPassword;
  password.setCustomValidity(
    Array.from(password.value).length < 12
      ? 'Use at least 12 characters.'
      : new TextEncoder().encode(password.value).length > 72
        ? 'This password is too long. Use at most 72 UTF-8 bytes.'
        : '',
  );
  confirmation.setCustomValidity(
    confirmation.value && confirmation.value !== password.value
      ? 'The passwords do not match.'
      : '',
  );
}
function showError(output, error) {
  output.textContent =
    error?.message || 'The request could not be confirmed. Please retry.';
  output.className = 'seller-message';
}
function setupLogin() {
  const form = document.querySelector('#login-form');
  if (!form || form.dataset.authFormReady) return;
  form.dataset.authFormReady = 'true';
  const button = form.querySelector('[type="submit"]');
  const idleMarkup = button.innerHTML;
  const output = document.querySelector('#login-message');
  const password = form.elements.password;
  form.querySelector('.password-toggle')?.addEventListener('click', (event) => {
    const control = event.currentTarget;
    const visible = password.type === 'text';
    password.type = visible ? 'password' : 'text';
    control.textContent = visible ? 'Show' : 'Hide';
    control.setAttribute('aria-pressed', String(!visible));
  });
  button.disabled = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled || !form.reportValidity()) return;
    button.disabled = true;
    button.textContent = 'Signing in...';
    output.textContent = '';
    try {
      const values = new FormData(form);
      const state = await login({
        email: String(values.get('email') || '')
          .trim()
          .toLowerCase(),
        password: String(values.get('password') || ''),
      });
      password.value = '';
      window.location.assign(accountDestination(state.profile));
    } catch (error) {
      showError(output, error);
    } finally {
      button.disabled = false;
      button.innerHTML = idleMarkup;
    }
  });
}
function setupRegistration() {
  const form = document.querySelector('#register-form');
  if (!form || form.dataset.authFormReady) return;
  form.dataset.authFormReady = 'true';
  const button = form.querySelector('[type="submit"]');
  const idleMarkup = button.innerHTML;
  const output = document.querySelector('#register-message');
  form.elements.password.addEventListener('input', () => passwords(form));
  form.elements.confirmPassword.addEventListener('input', () =>
    passwords(form),
  );
  button.disabled = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    passwords(form);
    if (!form.reportValidity()) {
      output.textContent =
        'Please correct the highlighted fields and try again.';
      return;
    }
    button.disabled = true;
    button.textContent = 'Creating account...';
    output.textContent = '';
    output.className = 'seller-message';
    try {
      const values = new FormData(form);
      const names = String(values.get('fullName') || '')
        .trim()
        .split(/\s+/);
      if (names.length < 2)
        throw new Error('Enter your first name and last name.');
      await register({
        first_name: names.shift(),
        last_name: names.join(' '),
        email: String(values.get('email') || '')
          .trim()
          .toLowerCase(),
        phone: String(values.get('phone') || '').trim(),
        password: String(values.get('password') || ''),
        account_type: 'seller',
      });
      form.elements.password.value = '';
      form.elements.confirmPassword.value = '';
      output.textContent = 'Your account was created. Sign in to continue. ';
      output.className = 'seller-message is-success';
      const link = document.createElement('a');
      link.href = 'login.html';
      link.textContent = 'Sign in';
      output.append(link);
    } catch (error) {
      showError(output, error);
    } finally {
      button.disabled = false;
      button.innerHTML = idleMarkup;
    }
  });
}
export const authFormsReady = Promise.resolve()
  .then(() => {
    setupLogin();
    setupRegistration();
    setNotice('Account access is for sellers and admins. Buyers do not need an account.');
    return true;
  })
  .catch(() => {
    setNotice(
      'Unable to initialize account forms. Reload the page and retry.',
      true,
    );
    document.querySelectorAll('.seller-submit').forEach((button) => {
      button.disabled = true;
    });
    return false;
  });
