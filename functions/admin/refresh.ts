import { withSecurityHeaders } from "../_shared/responses";
import { refreshTopics } from "../_shared/topics";

export async function onRequestPost({ request, env }) {
  const expectedSecret = env.REFRESH_SECRET;
  const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return new Response("not found", { status: 404, headers: withSecurityHeaders() });
  }

  const topics = await refreshTopics(env);

  return new Response(JSON.stringify({ refreshed: topics.length }), {
    headers: withSecurityHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    }),
  });
}
