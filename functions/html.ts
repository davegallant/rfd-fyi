import { withSecurityHeaders } from "./_shared/responses";
import { readTopics } from "./_shared/topics";

const RFD_FORUM_BASE = "https://forums.redflagdeals.com";

export async function onRequestGet({ env }) {
  const topics = await readTopics(env);
  topics.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return new Response(renderHtml(topics), {
    headers: withSecurityHeaders({
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=30",
    }),
  });
}

function renderHtml(topics) {
  const rows = topics.length > 0
    ? `<ol>${topics.map(renderTopic).join("")}</ol>`
    : `<p class="empty">No deals loaded yet.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>rfd-fyi (no JavaScript)</title>
  <style>
    :root {
      --bg: #f6f7f9;
      --fg: #1a1d22;
      --muted: #5c6570;
      --border: #d8dde3;
      --link: #212529;
      --card: #fff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #121418;
        --fg: #e8eaed;
        --muted: #9aa3ad;
        --border: #2a3038;
        --link: #e0e0e0;
        --card: #1a1d22;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif;
      line-height: 1.45;
      margin: 0;
      padding: 1rem 1.25rem 2rem;
      background: var(--bg);
      color: var(--fg);
    }
    header {
      max-width: 52rem;
      margin: 0 auto 1.25rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--border);
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 600;
      margin: 0 0 0.5rem;
    }
    .sub {
      color: var(--muted);
      font-size: 0.9rem;
      margin: 0;
    }
    a {
      color: var(--link);
      transition: color 0.2s ease;
    }
    a:visited { color: var(--link); }
    main {
      max-width: 52rem;
      margin: 0 auto;
    }
    ol {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    li {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.85rem 1rem;
      margin-bottom: 0.65rem;
    }
    .title {
      font-weight: 600;
      margin: 0 0 0.35rem;
      font-size: 1rem;
    }
    .title a { color: var(--link); text-decoration: none; }
    .title a:hover { text-decoration: underline; }
    .meta {
      font-size: 0.82rem;
      color: var(--muted);
      margin: 0;
    }
    .meta a { color: var(--link); }
    .empty {
      color: var(--muted);
      text-align: center;
      padding: 2rem 1rem;
    }
  </style>
</head>
<body>
  <header>
    <h1>rfd-fyi</h1>
    <p class="sub"><a href="/topics.json">Raw JSON</a></p>
  </header>
  <main>${rows}</main>
</body>
</html>`;
}

function renderTopic(topic) {
  const title = escapeHtml(topic.title ?? "");
  const threadUrl = escapeAttribute(`${RFD_FORUM_BASE}${topic.web_path ?? ""}`);
  const score = escapeHtml(String(topic.score ?? 0));
  const dealerName = topic.Offer?.dealer_name ? `${escapeHtml(topic.Offer.dealer_name)} — ` : "";
  const offerUrl = topic.Offer?.url;
  const offer = offerUrl ? ` · ${dealerName}<a href="${escapeAttribute(offerUrl)}">Offer link</a>` : "";

  return `<li>
        <p class="title"><a href="${threadUrl}">${title}</a></p>
        <p class="meta">Score ${score}${offer}</p>
      </li>`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
