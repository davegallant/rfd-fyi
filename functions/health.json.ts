import { withSecurityHeaders } from "./_shared/responses";
import { readRefreshStatusJson } from "./_shared/topics";

export async function onRequestGet({ env }) {
  const data = await readRefreshStatusJson(env);

  return new Response(data, {
    headers: withSecurityHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }),
  });
}
