import { env } from "./env";
import { HttpError } from "./http-error";

export type WorkerNudge =
  | { kind: "sync"; accountId: string }
  | { kind: "account-added"; accountId: string }
  | { kind: "account-removed"; accountId: string }
  | { kind: "outbox" };

/** Whether an always-on worker is configured; without one the web app does the work itself (dev, early prod). */
export const hasWorker = () => !!env.workerUrl && !!env.workerSecret;

/**
 * Ask the worker to do something that needs what only it has (the OpenAI key) and wait for the answer.
 * Errors come back as the worker's HttpError status and message.
 */
export async function askWorker<T>(path: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${env.workerUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.workerSecret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => null) : null;
  if (!res?.ok) throw new HttpError(res?.status && res.status < 600 ? res.status : 503, data?.error ?? "Something went wrong on our side", data?.code ?? "worker_error");
  return data as T;
}

/** Tell the worker something changed. Fire-and-forget: the worker also polls, so a lost nudge only adds latency. */
export async function nudgeWorker(nudge: WorkerNudge) {
  if (!hasWorker()) return false;
  try {
    const res = await fetch(`${env.workerUrl}/nudge`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${env.workerSecret}` },
      body: JSON.stringify(nudge),
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
