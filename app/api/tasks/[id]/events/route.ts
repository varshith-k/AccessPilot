import {
  SSE_HEADERS,
  createEventStream,
  errorResponse,
  readLastEventId,
  type RouteParams,
} from "@/lib/agent/http";
import { getTaskService } from "@/lib/agent/instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { id } = await params;
    const service = getTaskService();
    service.assertExists(id);
    const stream = createEventStream(service, id, readLastEventId(request), request.signal);
    return new Response(stream, { headers: SSE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
