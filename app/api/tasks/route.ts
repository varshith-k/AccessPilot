import { startTaskRequestSchema } from "@/lib/contracts";
import { errorResponse, readJson } from "@/lib/agent/http";
import { getTaskService } from "@/lib/agent/instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJson(request, startTaskRequestSchema);
    return Response.json(getTaskService().start(body), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
