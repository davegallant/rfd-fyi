import { withSecurityHeaders } from "./_shared/responses";
import { readTopicsJson } from "./_shared/topics";

export async function onRequestGet({ env }) {
  const data = await readTopicsJson(env);

  return new Response(data, {
    headers: withSecurityHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30",
    }),
  });
}
