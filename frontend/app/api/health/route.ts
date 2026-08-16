export function GET() {
  return Response.json({
    service: "powerotp-web",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
