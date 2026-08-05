import { verificationStates, verificationTypes } from "@powerotp/contracts";
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ verificationStates, verificationTypes });
}
