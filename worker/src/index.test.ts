import { afterEach, describe, expect, it, vi } from "vitest";

const refreshTopics = vi.hoisted(() => vi.fn());

vi.mock("../../functions/_shared/topics", () => ({ refreshTopics }));

const worker = await import("./index");

function env(overrides = {}) {
  return {
    TOPICS_KV: { get: vi.fn(), put: vi.fn() },
    ...overrides,
  };
}

describe("refresh worker", () => {
  afterEach(() => {
    refreshTopics.mockReset();
  });

  it("runs refreshTopics in waitUntil for scheduled events", async () => {
    const waitUntil = vi.fn();
    refreshTopics.mockResolvedValue([]);
    const bindings = env();

    await worker.default.scheduled({}, bindings, { waitUntil });

    expect(refreshTopics).toHaveBeenCalledWith(bindings);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });

  it("hides non-refresh paths", async () => {
    const response = await worker.default.fetch(new Request("https://worker.example/"), env());

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("not found");
  });

  it("requires a configured bearer secret for manual refresh", async () => {
    await expect(worker.default.fetch(new Request("https://worker.example/refresh"), env()))
      .resolves.toMatchObject({ status: 404 });
    await expect(worker.default.fetch(
      new Request("https://worker.example/refresh", { headers: { authorization: "Bearer wrong" } }),
      env({ REFRESH_SECRET: "secret" }),
    )).resolves.toMatchObject({ status: 404 });
    expect(refreshTopics).not.toHaveBeenCalled();
  });

  it("refreshes manually with the correct bearer secret", async () => {
    refreshTopics.mockResolvedValue([{ topic_id: 1 }, { topic_id: 2 }]);

    const response = await worker.default.fetch(
      new Request("https://worker.example/refresh", { headers: { authorization: "Bearer secret" } }),
      env({ REFRESH_SECRET: "secret" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ refreshed: 2 });
  });
});
