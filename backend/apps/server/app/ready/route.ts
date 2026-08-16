import { NextResponse } from "next/server";

import { getServerContext } from "@/lib/server-context";

export async function GET() {
  const { dataStores } = await getServerContext();
  const ready = await dataStores.isReady();
  return NextResponse.json(
    {
      service: "powerotp",
      status: ready ? "ready" : "unavailable",
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503 },
  );
}
