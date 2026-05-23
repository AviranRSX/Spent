import {
  buildCategorizePreview,
  CategorizePreviewError,
} from "@/server/ai/categorize-preview";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function encodeEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeEvent(event, data)));
      };

      try {
        const result = await buildCategorizePreview(workspaceId, (progress) => {
          send("progress", progress);
        });
        send("complete", result);
      } catch (err) {
        if (err instanceof CategorizePreviewError) {
          send("error", { message: err.message, status: err.status });
        } else {
          send("error", { message: "AI category preview failed" });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
