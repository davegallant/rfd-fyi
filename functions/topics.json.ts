import type { Env } from "./_shared/topics";
import { conditionalJsonResponse } from "./_shared/responses";
import { readTopicsJson } from "./_shared/topics";

export async function onRequestGet({ env, request }: { env: Env; request?: Request }) {
  return conditionalJsonResponse(await readTopicsJson(env), request);
}
