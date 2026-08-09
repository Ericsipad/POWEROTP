"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { playPopSound } from "./pop-sound";

type Phase = "check" | "poof" | "reveal";

const SPARKLE_COUNT = 16;
const CHECK_PHASE_MS = 650;
const POOF_PHASE_MS = 550;

interface Sparkle {
  id: number;
  tx: number;
  ty: number;
  delayMs: number;
  size: number;
}

function buildSparkles(): Sparkle[] {
  return Array.from({ length: SPARKLE_COUNT }, (_, index) => {
    const angle = (360 / SPARKLE_COUNT) * index + (Math.random() * 18 - 9);
    const distance = 70 + Math.random() * 90;
    const radians = (angle * Math.PI) / 180;
    return {
      id: index,
      tx: Math.cos(radians) * distance,
      ty: Math.sin(radians) * distance,
      delayMs: Math.random() * 120,
      size: 5 + Math.random() * 6,
    };
  });
}

/**
 * The "verified" success moment — a green checkmark, then the whole card
 * spins/shrinks/fades away in a burst of sparkles ("magic poof"), then a
 * large green human silhouette fades in behind it with "Verified" text.
 * Runs identically wherever a verification succeeds inside
 * `VerificationModalView` — the hosted modal on a customer's own site and
 * the public marketing-site demo both get the same animation, per the
 * user's request that this "should happen on user sites too". A failed
 * verification never plays this — see the plain result panel below.
 */
export function VerifiedCelebration({ succeeded }: { succeeded: boolean }) {
  const [phase, setPhase] = useState<Phase>("check");
  const sparkles = useMemo(buildSparkles, []);

  useEffect(() => {
    if (!succeeded) return;
    playPopSound();
    const toPoof = setTimeout(() => setPhase("poof"), CHECK_PHASE_MS);
    const toReveal = setTimeout(() => setPhase("reveal"), CHECK_PHASE_MS + POOF_PHASE_MS);
    return () => {
      clearTimeout(toPoof);
      clearTimeout(toReveal);
    };
  }, [succeeded]);

  if (!succeeded) {
    return (
      <div className="widgetResult widgetResultFailure">
        <span>Not verified</span>
        <p>This verification could not be completed. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="celebration">
      {phase !== "reveal" && (
        <div className={phase === "poof" ? "celebrationCard celebrationCardPoof" : "celebrationCard"}>
          <svg className="celebrationCheck" viewBox="0 0 52 52" aria-hidden="true">
            <circle className="celebrationCheckCircle" cx="26" cy="26" r="24" />
            <path className="celebrationCheckMark" fill="none" d="M14 27l7 7 17-17" />
          </svg>
          <span className="widgetProgress">Verified</span>
        </div>
      )}

      {phase === "poof" && (
        <div className="sparkleField" aria-hidden="true">
          {sparkles.map((sparkle) => (
            <span
              key={sparkle.id}
              className="sparkle"
              style={
                {
                  "--tx": `${sparkle.tx}px`,
                  "--ty": `${sparkle.ty}px`,
                  "--sparkle-delay": `${sparkle.delayMs}ms`,
                  width: `${sparkle.size}px`,
                  height: `${sparkle.size}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}

      {phase === "reveal" && (
        <div className="celebrationReveal">
          <svg className="celebrationSilhouette" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="36" r="20" />
            <path d="M14 92c0-22 16-34 36-34s36 12 36 34z" />
          </svg>
          <span className="celebrationVerifiedText">Verified</span>
        </div>
      )}
    </div>
  );
}
