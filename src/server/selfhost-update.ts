import { env } from "./env";

/** Where the self-hosted image is published (.github/workflows/selfhost-image.yml). */
const REPOSITORY = "jakubst28/kolbaba";
const CACHE_MS = 6 * 3600_000;

const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null);

/** The highest plain x.y.z tag, if it's newer than `current`. Anything else ("dev", "1", "latest") doesn't count. */
export function newerVersion(current: string, tags: readonly string[]): string | null {
  const now = parse(current);
  if (!now) return null;
  let best: number[] = now;
  let found: string | null = null;
  for (const tag of tags) {
    const v = parse(tag);
    if (!v) continue;
    const diff = v.map((n, i) => n - best[i]).find((d) => d !== 0) ?? 0;
    if (diff > 0) {
      best = v;
      found = tag;
    }
  }
  return found;
}

/**
 * The published versions, straight from the image registry, so the check tells nobody but GitHub that this
 * server exists. The image is public, so the request needs no login; no answer means no news.
 * UPDATE_CHECK=off turns it off.
 */
async function publishedTags(fetchFn: typeof fetch): Promise<string[]> {
  const auth = await fetchFn(`https://ghcr.io/token?service=ghcr.io&scope=repository:${REPOSITORY}:pull`, { signal: AbortSignal.timeout(5000) });
  if (!auth.ok) return [];
  const { token } = (await auth.json()) as { token?: string };
  const res = await fetchFn(`https://ghcr.io/v2/${REPOSITORY}/tags/list?n=1000`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const { tags } = (await res.json()) as { tags?: string[] };
  return tags ?? [];
}

let cached: { at: number; tags: string[] } | null = null;

export async function checkForUpdate(current: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  if (!env.selfHosted || process.env.UPDATE_CHECK === "off") return null;
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    cached = { at: Date.now(), tags: await publishedTags(fetchFn).catch(() => []) };
  }
  return newerVersion(current, cached.tags);
}
