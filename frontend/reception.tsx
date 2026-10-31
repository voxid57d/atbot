import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { api, ApiError } from "./api";
import { t } from "./text";
import { Brand } from "./brand";
import { ErrorNotice } from "./ui";
type Display = {
  token: string;
  expiresAt: number;
  serverTime: number;
  name: string;
  received: number;
  image: string;
};
export function Reception() {
  const [display, setDisplay] = useState<Display | null>(null),
    [pairing, setPairing] = useState(false),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0),
    [online, setOnline] = useState(navigator.onLine),
    [refreshing, setRefreshing] = useState(false),
    running = useRef(false),
    mounted = useRef(true),
    registrationRequired = useRef(false),
    failures = useRef(0),
    validUntil = useRef(0),
    controller = useRef<AbortController | null>(null),
    nextFetch = useRef(0);
  async function refresh() {
    if (running.current || !navigator.onLine) return;
    running.current = true;
    setRefreshing(true);
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 12000);
    const received = performance.now();
    try {
      const response = await api<Omit<Display, "received" | "image">>(
          "/tablet/qr",
          "GET",
          undefined,
          undefined,
          { signal: request.signal, cache: "no-store" },
        ),
        image = await QRCode.toDataURL(response.token, {
          width: 560,
          margin: 4,
          errorCorrectionLevel: "M",
          color: { dark: "#320A3E", light: "#ffffff" },
        });
      if (!mounted.current) return;
      const value = { ...response, received, image };
      setDisplay(value);
      setPairing(false);
      registrationRequired.current = false;
      failures.current = 0;
      setError("");
      validUntil.current =
        received + (response.expiresAt - response.serverTime) * 1000;
      // Renew before expiry, allowing time for a slow response or retry.
      nextFetch.current = Math.max(received + 1000, validUntil.current - 15000);
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.status === 401) {
        setDisplay(null);
        validUntil.current = 0;
        setPairing(true);
        registrationRequired.current = true;
        setError(e.message);
        nextFetch.current = Infinity;
      } else {
        // Keep the last signed code visible until its original expiry.
        setError(navigator.onLine ? t("qrRetryHelp") : "");
        failures.current += 1;
        nextFetch.current =
          performance.now() +
          Math.min(30000, 5000 * 2 ** Math.min(failures.current - 1, 3));
      }
    } finally {
      clearTimeout(timeout);
      controller.current = null;
      running.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    document.title = `${t("brand")} | ${t("receptionTitle")}`;
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "/reception/manifest.webmanifest";
    document.head.appendChild(manifest);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker
        .register("/reception/sw.js", { scope: "/reception/" })
        .catch(() => {});
    void refresh();
    const timer = setInterval(() => {
      setTick((v) => v + 1);
      if (
        navigator.onLine &&
        !registrationRequired.current &&
        performance.now() >= nextFetch.current
      )
        void refresh();
    }, 1000);
    const offline = () => {
        setOnline(false);
      },
      connected = () => {
        setOnline(navigator.onLine);
        if (!navigator.onLine) return;
        if (
          !registrationRequired.current &&
          (performance.now() >= nextFetch.current ||
            performance.now() >= validUntil.current)
        )
          void refresh();
      };
    const visible = () => {
      if (document.visibilityState === "visible") connected();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", connected);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      clearInterval(timer);
      manifest.remove();
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", connected);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  async function pair() {
    setBusy(true);
    setError("");
    try {
      await api("/tablet/pair", "POST", { code: code.trim().toLowerCase() });
      setCode("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const remaining = display
    ? Math.max(
        0,
        Math.floor(
          display.expiresAt -
            display.serverTime -
            (performance.now() - display.received) / 1000,
        ),
      )
    : 0;
  void tick;
  return (
    <main className="reception">
      <header>
        <div className="reception-identity">
          <Brand />
          <span className="reception-label">{t("receptionTitle")}</span>
        </div>
        <button
          className="secondary"
          onClick={() =>
            void document.documentElement
              .requestFullscreen()
              .catch((e) => setError((e as Error).message))
          }
        >
          {t("fullscreen")}
        </button>
      </header>
      <section className="reception-content">
        <span className="eyebrow">{t("timezone")}</span>
        <h1>{t("receptionWelcome")}</h1>
        <p>{t("receptionInstructions")}</p>
        <ErrorNotice error={error} />
        {pairing ? (
          <form
            className="reception-pair attendance-form"
            onSubmit={(e) => {
              e.preventDefault();
              void pair();
            }}
          >
            <label>
              {t("pairingCode")}
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                pattern="[a-fA-F0-9]{64}"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button className="primary" disabled={busy || !online}>
              {t("pairDisplay")}
            </button>
            <small>{t("tabletPairInstructions")}</small>
          </form>
        ) : (
          <>
            <div className="qr-frame">
              {online && display && remaining > 0 ? (
                <img src={display.image} alt={t("qrAlt")} />
              ) : (
                <div className="qr-unavailable">
                  <strong>
                    {online ? t("refreshingQR") : t("offlineTitle")}
                  </strong>
                  <p>{t("offlineHelp")}</p>
                  <button
                    className="secondary"
                    disabled={refreshing || !online}
                    onClick={() => void refresh()}
                  >
                    {t("retry")}
                  </button>
                </div>
              )}
            </div>
            <div className="reception-status">
              <span
                className={
                  online && display && remaining > 0
                    ? "connection-dot"
                    : "connection-dot disconnected"
                }
              />
              {online && display && remaining > 0
                ? `${t("newCodeIn")} ${remaining}s`
                : t("waitingConnection")}
            </div>
            <small>{display?.name}</small>
          </>
        )}
        <p className="reception-note">{t("checkoutHint")}</p>
      </section>
      <footer>{t("receptionFooter")}</footer>
    </main>
  );
}
