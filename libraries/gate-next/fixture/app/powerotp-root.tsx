"use client";

import { usePowerOtp } from "@powerotp/gate-next/react";
import { type ReactNode, useEffect } from "react";

export function PowerOtpCustomerRoot({ children }: Readonly<{ children: ReactNode }>) {
  const { snapshot, openOtp } = usePowerOtp();

  useEffect(() => {
    if (snapshot.recommendation === "otp_required" && !snapshot.otpOpen) {
      void openOtp();
    }
  }, [openOtp, snapshot.otpOpen, snapshot.recommendation]);

  return snapshot.recommendation === "full_access" ? children : null;
}
