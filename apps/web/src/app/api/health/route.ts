export async function GET() {
  return Response.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'flakeguard-web',
    version: '1.0.0',
  });
}
