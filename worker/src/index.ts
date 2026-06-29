import { refreshTopics } from "../../functions/_shared/topics";

async function refreshTopicsWithLog(env, trigger) {
  const startedAt = Date.now();

  try {
    const topics = await refreshTopics(env);
    console.log("topics refresh completed", {
      trigger,
      refreshed: topics.length,
      duration_ms: Date.now() - startedAt,
    });
    return topics;
  } catch (error) {
    console.error("topics refresh failed", {
      trigger,
      duration_ms: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(refreshTopicsWithLog(env, "scheduled"));
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/refresh") {
      const expectedSecret = env.REFRESH_SECRET;
      const providedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

      if (!expectedSecret || providedSecret !== expectedSecret) {
        return new Response("not found", { status: 404 });
      }

      const topics = await refreshTopicsWithLog(env, "manual");
      return Response.json({ refreshed: topics.length });
    }

    return new Response("not found", { status: 404 });
  },
};
