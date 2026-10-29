const categories = new Set([
  'AUTH',
  'PROFILE',
  'PRODUCT',
  'IMAGE_UPLOAD',
  'MARKETPLACE',
  'ENQUIRY',
]);

// Report useful backend messages without dumping requests, sessions or credentials.
function safeDetails(cause) {
  const code =
    typeof cause?.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(cause.code)
      ? cause.code
      : '';
  let message =
    typeof cause?.message === 'string'
      ? cause.message.replace(/[\r\n\t]/g, ' ').slice(0, 260)
      : '';
  if (
    /bearer\s|sb_secret_|service_role|authorization|access_token|refresh_token|password\s*[:=]|eyJ[A-Za-z0-9_-]*\./i.test(
      message,
    )
  ) {
    message = 'Backend request failed; sensitive details omitted.';
  }
  return [code, message].filter(Boolean).join(': ');
}

export function backendError(category, message, cause) {
  const label = categories.has(category) ? category : 'PRODUCT';
  const details = safeDetails(cause);
  const error = new Error(
    `[${label}] ${message}${details ? ` (${details})` : ''}`,
  );
  error.category = label;
  if (cause?.code && /^[A-Za-z0-9_-]{1,40}$/.test(cause.code))
    error.code = cause.code;
  return error;
}

export function errorText(
  error,
  fallback = '[PRODUCT] Request failed. Please retry.',
) {
  return /^\[(AUTH|PROFILE|PRODUCT|IMAGE_UPLOAD|MARKETPLACE|ENQUIRY)\] /.test(
    error?.message || '',
  )
    ? error.message
    : fallback;
}
