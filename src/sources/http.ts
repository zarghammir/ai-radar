import { brand } from "@/config/brand";

const USER_AGENT = `${brand.name}/0.1 (+${brand.repository})`;

/** fetch with a timeout and a polite user agent. Throws on non-2xx. */
export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, {
      headers: { "user-agent": USER_AGENT, accept: "*/*", ...opts.headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T>(
  url: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const text = await fetchText(url, { ...opts, headers: { accept: "application/json" } });
  return JSON.parse(text) as T;
}
