const refreshUrl = process.env.RFD_REFRESH_URL ?? "http://rfd:8788/admin/refresh";
const refreshSecret = process.env.REFRESH_SECRET ?? "local";
const refreshIntervalSeconds = readPositiveInteger("RFD_REFRESH_INTERVAL_SECONDS", 600);
const retryIntervalSeconds = readPositiveInteger("RFD_REFRESH_RETRY_SECONDS", 30);
const maxRetryIntervalSeconds = readPositiveInteger("RFD_REFRESH_MAX_RETRY_SECONDS", refreshIntervalSeconds);

function readPositiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const MAX_TIMEOUT_MS = 2_147_483_647;

function sleep(seconds) {
  let remainingMs = Math.max(0, seconds * 1000);
  return new Promise((resolve) => {
    function step() {
      if (remainingMs <= 0) {
        return resolve();
      }
      const chunk = Math.min(remainingMs, MAX_TIMEOUT_MS);
      remainingMs -= chunk;
      setTimeout(step, chunk);
    }
    step();
  });
}

function sanitizeLog(text) {
  if (!text || typeof text !== "string") return "";
  let sanitized = text;
  if (refreshSecret) {
    sanitized = sanitized.replaceAll(refreshSecret, "[REDACTED]");
  }
  return sanitized.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}

function formatErrorBody(body) {
  const sanitized = sanitizeLog(body).trim();
  if (sanitized.startsWith("<!DOCTYPE html>") || sanitized.toLowerCase().includes("<html")) {
    const titleMatch = sanitized.match(/<title>([^<]*)<\/title>/i);
    const title = titleMatch ? ` (${titleMatch[1].trim()})` : "";
    return `[HTML error response${title}]`;
  }
  return sanitized.length > 500 ? `${sanitized.slice(0, 500)}... [truncated]` : sanitized;
}

async function refresh() {
  try {
    const response = await fetch(refreshUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${refreshSecret}`,
      },
      signal: AbortSignal.timeout(120000),
    });
    const body = await response.text();

    if (!response.ok) {
      console.error(`refresh failed (${response.status}): ${formatErrorBody(body)}`);
      return false;
    }

    console.log(`refresh completed: ${sanitizeLog(body)}`);
    return true;
  } catch (error) {
    console.error("refresh request failed:", sanitizeLog(error instanceof Error ? error.message : String(error)));
    return false;
  }
}

let delaySeconds = 0;
let currentRetryDelay = retryIntervalSeconds;

while (true) {
  if (delaySeconds > 0) {
    await sleep(delaySeconds);
  }

  const ok = await refresh();
  if (ok) {
    currentRetryDelay = retryIntervalSeconds;
    delaySeconds = refreshIntervalSeconds;
  } else {
    delaySeconds = currentRetryDelay;
    currentRetryDelay = Math.min(currentRetryDelay * 2, maxRetryIntervalSeconds);
  }
}
