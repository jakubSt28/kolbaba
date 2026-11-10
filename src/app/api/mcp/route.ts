import { handleMcpRequest } from "@/server/mcp/server";

/** Long enough for an immediate send to sit out the undo window when no worker is configured. */
export const maxDuration = 60;

export const GET = handleMcpRequest;
export const POST = handleMcpRequest;
export const DELETE = handleMcpRequest;
export const OPTIONS = handleMcpRequest;
