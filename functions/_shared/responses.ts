export const securityHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://umami.davegallant.ca; connect-src 'self' https://umami.davegallant.ca; img-src 'self' data:",
};

export function withSecurityHeaders(headers: HeadersInit = {}): Headers {
  const responseHeaders = new Headers(headers);
  for (const [key, value] of Object.entries(securityHeaders)) {
    responseHeaders.set(key, value);
  }
  return responseHeaders;
}
