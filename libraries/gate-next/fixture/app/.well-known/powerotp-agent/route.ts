import type { NextRequest } from "next/server";

import { powerOtp } from "../../../powerotp.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (request: NextRequest) => powerOtp.route(request);
export const HEAD = (request: NextRequest) => powerOtp.route(request);
