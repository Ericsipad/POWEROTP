import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./styles.css";
import "./auth.css";
import "./dashboard.css";

export const metadata: Metadata = {
  title: "POWEROTP | Phone verification infrastructure",
  description:
    "Programmable call, voice-code, voice-challenge, and SMS verification.",
  referrer: "no-referrer",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
