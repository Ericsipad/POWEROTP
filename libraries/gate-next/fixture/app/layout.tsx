import { PowerOtpNextProvider } from "@powerotp/gate-next/react";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { powerOtp } from "../powerotp.server";

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const requestState = powerOtp.getRequestState(await headers());
  const initialSnapshot = requestState.advisory
    ? requestState.recommendation
    : undefined;

  return (
    <html lang="en">
      <body>
        <PowerOtpNextProvider
          sensorVersion="next-fixture-v1"
          initialSnapshot={initialSnapshot}
        >
          {children}
        </PowerOtpNextProvider>
      </body>
    </html>
  );
}
