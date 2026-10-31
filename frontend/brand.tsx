import { t } from "./text";

export function Brand() {
  return (
    <div className="brand">
      <img
        className="brand-logo"
        src="/brand/ielts-zone-logo.svg"
        alt="IELTS ZONE"
        width="144"
        height="63"
      />
      <div className="brand-copy">
        <span>{t("brandCaption")}</span>
        <small>{t("brandDescription")}</small>
      </div>
    </div>
  );
}
