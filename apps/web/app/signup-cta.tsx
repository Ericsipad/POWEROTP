"use client";

import { useState } from "react";

import { SignupModal } from "./signup-modal";

interface SignupCtaProps {
  className?: string;
  children: React.ReactNode;
}

/** Opens `SignupModal` from a plain button — lets the marketing homepage
 * (`apps/web/app/page.tsx`) stay a server component while still triggering
 * the rapid signup modal. */
export function SignupCta({ className, children }: SignupCtaProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} type="button" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <SignupModal onClose={() => setOpen(false)} />}
    </>
  );
}
