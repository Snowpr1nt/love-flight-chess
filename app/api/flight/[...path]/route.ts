import { env } from 'cloudflare:workers';
import { handleFlight } from '../../../../server/service.mjs';

export const dynamic = 'force-dynamic';
export function GET(request: Request) { return handleFlight(request, (env as unknown as {DB: D1Database}).DB); }
export function POST(request: Request) { return handleFlight(request, (env as unknown as {DB: D1Database}).DB); }
