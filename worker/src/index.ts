import { refreshTopics } from "../../functions/_shared/topics";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshTopics(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/refresh") {
      const expectedSecret = env.REFRESH_SECRET;
      const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

      if (!expectedSecret || providedSecret !== expectedSecret) {
        return new Response("not found", { status: 404 });
      }

      const topics = await refreshTopics(env);
      return Response.json({ refreshed: topics.length });
    }

    return new Response("not found", { status: 404 });
  },
};
