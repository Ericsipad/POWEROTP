import { PowerOtpNextGate } from "@powerotp/gate-next/react";
import type { ReactNode } from "react";

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <PowerOtpNextGate sensorVersion="next-fixture-v1" />
      </body>
    </html>
  );
}
