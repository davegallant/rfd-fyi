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

/** Validate the exact served representation, including deployed enrichment metadata. */
export async function conditionalJsonResponse(data: string, request?: Request): Promise<Response> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const etag = `"${hash}"`;
  const headers = withSecurityHeaders({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30",
    etag,
  });
  // GET validators use weak comparison; clients may send several cached versions.
  const validators = request?.headers.get("if-none-match") ?? "";
  const matches = validators.split(",").some(value => {
    const tag = value.trim().replace(/^W\//, "");
    return tag === "*" || tag === etag;
  });
  return new Response(matches ? null : data, { status: matches ? 304 : 200, headers });
}
