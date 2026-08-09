"use client";

import { useEffect } from "react";

interface TopBannerProps {
  message: string;
  tone?: "success" | "info";
  durationMs?: number;
  onClose(): void;
}

/**
 * A dismissible banner fixed to the top of the page — used for one-off
 * post-redirect confirmations (e.g. a Stripe top-up completing) where a
 * normal inline status message would be missed since the customer already
 * navigated away and back. Auto-dismisses after `durationMs` (default 10s)
 * or immediately on click.
 */
export function TopBanner({ message, tone = "info", durationMs = 10_000, onClose }: TopBannerProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, durationMs);
    return () => clearTimeout(timer);
  }, [onClose, durationMs]);

  return (
    <div
      className={`topBanner ${tone === "success" ? "topBannerSuccess" : "topBannerInfo"}`}
      role="status"
      onClick={onClose}
    >
      <span>{message}</span>
      <button type="button" className="topBannerClose" aria-label="Dismiss">
        &times;
      </button>
    </div>
  );
}
