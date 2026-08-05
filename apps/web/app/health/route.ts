import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    service: "powerotp",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
