export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let localLaunchData = "";
export function setLocalLaunchData(value: string) {
  localLaunchData = value;
}
export function currentLaunchData() {
  return (
    window.Telegram?.WebApp.initData ||
    (import.meta.env.DEV ? localLaunchData : "")
  );
}
export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  key?: string,
  options?: { signal?: AbortSignal; cache?: RequestCache },
): Promise<T> {
  const launchData = currentLaunchData();
  const response = await fetch("/api" + path, {
    ...options,
    method,
    credentials: "same-origin",
    headers: {
      ...(launchData ? { "X-Telegram-Init-Data": launchData } : {}),
      ...(method === "GET"
        ? {}
        : {
            "Content-Type": "application/json",
            ...(key ? { "Idempotency-Key": key } : {}),
          }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const value: unknown = await response
    .json()
    .catch(() => ({ error: "The service returned an invalid response." }));
  if (launchData !== currentLaunchData())
    throw new ApiError(
      "Your Telegram account changed. Reopen the Mini App to sign in.",
      401,
    );
  if (!response.ok)
    throw new ApiError(
      typeof value === "object" && value !== null && "error" in value
        ? String(value.error)
        : "The request failed. Try again.",
      response.status,
    );
  if (method !== "GET") window.dispatchEvent(new Event("workspace-mutation"));
  return value as T;
}
