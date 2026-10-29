// Public configuration only. MySQL credentials and SESSION_SECRET stay on the server.
// A deployment may set NEWPAGE_API_BASE_URL in a trusted script before this module.
export function resolveApiBase(
  location = globalThis.location,
  configured = globalThis.NEWPAGE_API_BASE_URL,
) {
  const current = location || {
    protocol: 'http:',
    hostname: '127.0.0.1',
    origin: 'http://127.0.0.1:5500',
  };
  if (!['http:', 'https:'].includes(current.protocol))
    throw new Error(
      'Open the website with Live Server at http://127.0.0.1:5500.',
    );
  const local = ['127.0.0.1', 'localhost'].includes(current.hostname);
  const target = new URL(
    configured ||
      (local ? `${current.protocol}//${current.hostname}:5000/api` : '/api'),
    current.origin,
  );
  if (
    !['http:', 'https:'].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw new Error('Invalid backend API URL.');
  if (!local && target.protocol !== 'https:')
    throw new Error('The deployed backend must use HTTPS.');
  if (
    local &&
    ['127.0.0.1', 'localhost'].includes(target.hostname) &&
    target.hostname !== current.hostname
  )
    throw new Error(
      'Use the same hostname for Live Server and the backend. Prefer 127.0.0.1.',
    );
  return target.href.replace(/\/$/, '');
}

export class ApiError extends Error {
  constructor(message, status = 0, code = 'HTTP') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createApiClient({
  baseUrl = resolveApiBase(),
  fetchImpl = globalThis.fetch.bind(globalThis),
  timeoutMs = 10000,
} = {}) {
  let csrfToken = null;
  let csrfRequest = null;

  function url(route) {
    if (
      typeof route !== 'string' ||
      !route.startsWith('/') ||
      route.startsWith('//') ||
      route.includes('..') ||
      /[\\#]/.test(route)
    )
      throw new ApiError('Invalid API path.', 0, 'CONFIG');
    return baseUrl + route;
  }

  async function send(method, route, body, token, requestTimeout = timeoutMs) {
    const target = url(route);
    const multipart =
      typeof FormData !== 'undefined' && body instanceof FormData;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const headers = { Accept: 'application/json' };
      // The browser supplies multipart Content-Type, including its boundary.
      if (body !== undefined && !multipart)
        headers['Content-Type'] = 'application/json';
      if (token) headers['X-CSRF-Token'] = token;
      let response;
      try {
        response = await fetchImpl(target, {
          method,
          headers,
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
          body:
            body === undefined
              ? undefined
              : multipart
                ? body
                : JSON.stringify(body),
        });
      } catch {
        throw new ApiError(
          'Unable to reach the backend. Check your connection and that the backend is running, then retry.',
          0,
          'NETWORK',
        );
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new ApiError(
          'The backend returned an unexpected response. Please retry.',
          response.status,
          'PROTOCOL',
        );
      }
      if (
        !data ||
        typeof data !== 'object' ||
        typeof data.success !== 'boolean'
      )
        throw new ApiError(
          'The backend returned an unexpected response. Please retry.',
          response.status,
          'PROTOCOL',
        );
      if (!response.ok || !data.success) {
        const error = new ApiError(
          typeof data.message === 'string'
            ? data.message
            : 'The request could not be completed. Please retry.',
          response.status,
        );
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const delay =
            retryAfter && /^\d+$/.test(retryAfter)
              ? Number(retryAfter) * 1000
              : Date.parse(retryAfter || '') - Date.now();
          if (Number.isFinite(delay) && delay > 0)
            error.retryAfterMs = Math.min(delay, 86400000);
        }
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function csrf() {
    if (csrfToken) return csrfToken;
    if (!csrfRequest) {
      csrfRequest = send('GET', '/auth/csrf')
        .then((data) => {
          if (
            typeof data.csrfToken !== 'string' ||
            data.csrfToken.length !== 64 ||
            !/^[a-f0-9]{64}$/.test(data.csrfToken)
          )
            throw new ApiError(
              'Unable to prepare this request. Please retry.',
              0,
              'PROTOCOL',
            );
          csrfToken = data.csrfToken;
          return csrfToken;
        })
        .finally(() => {
          csrfRequest = null;
        });
    }
    return csrfRequest;
  }

  async function request(
    method,
    route,
    body,
    { timeoutMs: requestTimeout = timeoutMs } = {},
  ) {
    const changing = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    try {
      let data;
      try {
        data = await send(
          method,
          route,
          body,
          changing ? await csrf() : null,
          requestTimeout,
        );
      } catch (error) {
        // Retry exactly once only when the server confirms that CSRF middleware
        // rejected the request before any action. Never replay a network failure.
        if (
          changing &&
          error.status === 403 &&
          error.code === 'HTTP' &&
          error.message === 'Invalid or missing CSRF token.'
        ) {
          csrfToken = null;
          data = await send(method, route, body, await csrf(), requestTimeout);
        } else throw error;
      }
      if (
        typeof data.csrfToken === 'string' &&
        data.csrfToken.length === 64 &&
        /^[a-f0-9]{64}$/.test(data.csrfToken)
      )
        csrfToken = data.csrfToken;
      if (route === '/auth/logout') csrfToken = null;
      return data;
    } catch (error) {
      if (error.status === 401 && error.code === 'HTTP') csrfToken = null;
      throw error;
    }
  }

  return {
    request,
    csrf,
    url,
    clearCsrf() {
      csrfToken = null;
    },
  };
}

export const api = createApiClient();
