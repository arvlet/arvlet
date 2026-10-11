import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

test("uncertain writes reuse their idempotency key; a confirmed write starts a new operation", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("connection lost"))
    .mockResolvedValueOnce(new Response("gateway restarting", { status: 502 }))
    .mockResolvedValue(new Response('{"id":"saved"}', { status: 201 }));
  vi.stubGlobal("fetch", fetch);
  const { api } = await import("./api");
  const body = { title: "Report" };
  await expect(api("/api/v1/artifacts", "POST", body)).rejects.toThrow(
    "connection lost",
  );
  await expect(api("/api/v1/artifacts", "POST", body)).rejects.toThrow("502");
  expect(await api("/api/v1/artifacts", "POST", body)).toEqual({ id: "saved" });
  fetch.mockResolvedValueOnce(new Response('{"id":"next"}', { status: 201 }));
  await api("/api/v1/artifacts", "POST", body);
  const keys = fetch.mock.calls.map(
    ([, init]) => init.headers["Idempotency-Key"],
  );
  expect(keys[0]).toBe(keys[1]);
  expect(keys[1]).toBe(keys[2]);
  expect(keys[3]).not.toBe(keys[2]);
});
