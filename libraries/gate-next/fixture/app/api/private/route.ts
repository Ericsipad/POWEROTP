export async function POST(request: Request) {
  return Response.json({ bytes: (await request.arrayBuffer()).byteLength });
}
