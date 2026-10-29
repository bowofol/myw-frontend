import { api, ApiError } from './api-client.js';
import {
  account,
  getCurrentAccount,
  subscribeAccount,
  profileName,
} from './auth.js';

const SAVED_MESSAGE = 'Your enquiry has been submitted successfully.';
function requiredText(value, label, max, multiline = false) {
  const controls = multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value.trim()).length > max ||
    controls.test(value)
  )
    throw new Error(`${label} must contain 1 to ${max} valid characters.`);
  return value.trim();
}

export function enquiryBody(product, values) {
  if (
    !Number.isSafeInteger(product?.id) ||
    product.id < 1 ||
    product.id > 4294967295 ||
    product.status !== 'published'
  )
    throw new Error('This product is not available for enquiries.');
  const rawPhone = requiredText(values.phone, 'Phone', 32);
  const phone = rawPhone.replace(/[ ()-]/g, '');
  if (!/^\+?[0-9 ()-]+$/.test(rawPhone) || !/^\+?[0-9]{7,15}$/.test(phone))
    throw new Error(
      'Phone must contain 7 to 15 digits, optionally starting with +.',
    );
  return {
    product_id: product.id,
    name: requiredText(values.name, 'Name', 200),
    phone,
    message: requiredText(values.message, 'Message', 2000, true),
  };
}

export async function submitEnquiry(client, product, values) {
  const data = await client.request(
    'POST',
    '/enquiries',
    enquiryBody(product, values),
  );
  if (data.success !== true || data.message !== SAVED_MESSAGE)
    throw new ApiError(
      'The backend did not confirm your enquiry was saved.',
      0,
      'PROTOCOL',
    );
  return data.message;
}

// Subscribe to the existing account singleton. Return cleanup for product reloads
// so a replaced form cannot retain another listener or show a stale response.
export function mountProductEnquiry(form, toggle, product) {
  const notice = form.parentElement.querySelector('[data-enquiry-notice]');
  const feedback = form.querySelector('#enquiry-feedback');
  const submit = form.querySelector('[type="submit"]');
  const fields = [...form.querySelectorAll('input, textarea, button')];
  const idleMarkup = submit.innerHTML;
  const idleToggleMarkup = toggle.innerHTML;
  let active = true,
    allowed = false,
    saving = false,
    unavailable = false;
  let restrictedRole = '';
  let identity = null,
    version = 0,
    retryAt = 0,
    cooldownTimer;
  function controls() {
    fields.forEach((field) => {
      field.disabled =
        !allowed || saving || unavailable || Date.now() < retryAt;
    });
    // Opening the form does not submit anything. A focus-triggered /auth/me
    // check must not swallow the click; fields stay disabled until verified.
    toggle.disabled = Boolean(restrictedRole) || saving || unavailable;
    const whatsapp = form.parentElement.querySelector('[data-product-whatsapp]');
    if (whatsapp) whatsapp.hidden = unavailable;
    if (restrictedRole)
      toggle.textContent = `Enquiries unavailable for ${restrictedRole} accounts`;
    else toggle.innerHTML = idleToggleMarkup;
    toggle.title = restrictedRole ? notice.textContent : '';
    form.setAttribute('aria-busy', String(saving));
  }
  function message(text, success = false) {
    feedback.textContent = text;
    feedback.dataset.state = success ? 'success' : 'error';
    feedback.setAttribute('role', success ? 'status' : 'alert');
  }
  function accountChanged(snapshot) {
    if (!active) return;
    const confirmed =
      snapshot.status === 'guest'
        ? 'guest'
        : snapshot.status === 'authenticated'
          ? `${snapshot.profile.role}:${snapshot.user.id}`
          : null;
    if (confirmed && confirmed !== identity) {
      if (identity !== null) {
        version++;
        form.reset();
        feedback.textContent = '';
      }
      identity = confirmed;
    }
    allowed =
      snapshot.status === 'guest' ||
      (snapshot.status === 'authenticated' &&
        snapshot.profile.role === 'buyer' &&
        snapshot.profile.status === 'active');
    restrictedRole =
      snapshot.status === 'authenticated' && !allowed
        ? snapshot.profile.role === 'admin'
          ? 'Admin'
          : 'Seller'
        : '';
    if (
      snapshot.status === 'authenticated' &&
      snapshot.profile.role === 'buyer' &&
      !saving
    ) {
      if (!form.elements.name.value)
        form.elements.name.value = profileName(snapshot.profile);
      if (!form.elements.phone.value)
        form.elements.phone.value = snapshot.profile.phone || '';
    }
    notice.textContent = unavailable
      ? 'This product is not available for enquiries.'
      : allowed
        ? 'Your contact details are shared privately with the Newpage team.'
        : restrictedRole
          ? `Your ${restrictedRole} account cannot submit website enquiries. To enquire as a visitor, explicitly log out. No buyer account is needed.`
          : snapshot.status === 'error'
            ? 'Unable to confirm your account. Use Retry in the account menu.'
            : 'Checking enquiry access...';
    controls();
  }
  const unsubscribe = subscribeAccount(accountChanged);
  accountChanged(account.snapshot());
  getCurrentAccount().catch(() => {});
  const open = () => {
    if (restrictedRole || saving || unavailable) return;
    form.hidden = !form.hidden;
    toggle.setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden && allowed) form.elements.name.focus();
  };
  const save = async (event) => {
    event.preventDefault();
    if (!active || !allowed || saving || unavailable || Date.now() < retryAt)
      return;
    feedback.textContent = '';
    feedback.dataset.state = '';
    if (!form.reportValidity()) {
      message('Please complete the highlighted fields.');
      return;
    }
    const values = Object.fromEntries(new FormData(form));
    try {
      enquiryBody(product, values);
    } catch (error) {
      message(error.message);
      return;
    }
    const currentVersion = version;
    saving = true;
    controls();
    submit.textContent = 'Sending enquiry...';
    try {
      const saved = await submitEnquiry(api, product, values);
      if (!active || version !== currentVersion) return;
      form.reset();
      message(saved, true);
    } catch (error) {
      if (!active || version !== currentVersion) return;
      const uncertain =
        error.code === 'NETWORK' ||
        error.code === 'PROTOCOL' ||
        error.status >= 500;
      message(
        (error.message || 'Unable to submit your enquiry.') +
          (uncertain
            ? ' Delivery could not be confirmed. Your details are retained; no automatic retry was made.'
            : ''),
      );
      if (error.status === 404) {
        unavailable = true;
        notice.textContent = 'This product is not available for enquiries.';
      }
      if (error.status === 429 && error.retryAfterMs) {
        retryAt = Date.now() + error.retryAfterMs;
        clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(() => {
          if (active) controls();
        }, error.retryAfterMs + 10);
      }
      if (error.code === 'HTTP' && [401, 403].includes(error.status))
        getCurrentAccount({ force: true }).catch(() => {});
    } finally {
      saving = false;
      if (active) {
        submit.innerHTML = idleMarkup;
        controls();
      }
    }
  };
  toggle.setAttribute('aria-controls', form.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', open);
  form.addEventListener('submit', save);
  return () => {
    active = false;
    version++;
    clearTimeout(cooldownTimer);
    unsubscribe();
    toggle.removeEventListener('click', open);
    form.removeEventListener('submit', save);
  };
}
