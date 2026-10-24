import { emptyRequestSchema } from "@/lib/contracts";
import { errorResponse, readJson, type RouteParams } from "@/lib/agent/http";
import { getTaskService } from "@/lib/agent/instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteParams): Promise<Response> {
  try {
    const { id } = await params;
    const body = await readJson(request, emptyRequestSchema);
    void body;
    getTaskService().stop(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
