import { afterEach, describe, it, expect, vi } from "vitest";
import { api, setLocalLaunchData } from "../frontend/api";
afterEach(() => {
  setLocalLaunchData("");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Current Telegram account on API requests", () => {
  it("discards a previous account response if Telegram changes while it is in flight", async () => {
    const sdk = { initData: "owner-launch" };
    vi.stubGlobal("window", { Telegram: { WebApp: sdk } });
    let respond!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve;
          }),
      ),
    );
    const pending = api("/me");
    const rejected = expect(pending).rejects.toMatchObject({ status: 401 });
    sdk.initData = "employee-launch";
    respond(new Response(JSON.stringify({ user: { access: "super_admin" } })));
    await rejected;
  });
  it("sends the current SDK launch with reads and writes, including after account switching", async () => {
    const dispatchEvent = vi.fn();
    const sdk = { initData: "owner-signed-launch" },
      fetchMock = vi.fn(
        async (_url: string, _init: { headers: Record<string, string> }) =>
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("window", { Telegram: { WebApp: sdk }, dispatchEvent });
    vi.stubGlobal("fetch", fetchMock);
    await api("/me");
    sdk.initData = "employee-signed-launch";
    await api("/attendance/check-out", "POST", {}, "request-key");
    expect(fetchMock.mock.calls[0][1].headers["X-Telegram-Init-Data"]).toBe(
      "owner-signed-launch",
    );
    expect(fetchMock.mock.calls[1][1].headers["X-Telegram-Init-Data"]).toBe(
      "employee-signed-launch",
    );
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0].type).toBe("workspace-mutation");
  });
  it("does not use a development login as production identity", async () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("window", {});
    setLocalLaunchData("local-signed-launch");
    const fetchMock = vi.fn(
      async (_url: string, _init: { headers: Record<string, string> }) =>
        new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);
    await api("/me");
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "X-Telegram-Init-Data",
    );
  });
  it("prefers the active Telegram account over a previous local test login", async () => {
    vi.stubGlobal("window", {
      Telegram: { WebApp: { initData: "current-account" } },
    });
    setLocalLaunchData("old-local-account");
    const fetchMock = vi.fn(
      async (_url: string, _init: { headers: Record<string, string> }) =>
        new Response("{}"),
    );
    vi.stubGlobal("fetch", fetchMock);
    await api("/me");
    expect(fetchMock.mock.calls[0][1].headers["X-Telegram-Init-Data"]).toBe(
      "current-account",
    );
  });
});
