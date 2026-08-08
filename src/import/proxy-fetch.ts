import { getCorsProxyUrl } from "../config";

/**
 * Fetch a URL through the configured CORS proxy.
 * Throws a user-friendly error on failure that guides to Settings.
 */
export async function proxyFetch(
  targetUrl: string,
  init?: RequestInit,
): Promise<Response> {
  const proxyBase = getCorsProxyUrl();
  const fullUrl = `${proxyBase}${encodeURIComponent(targetUrl)}`;

  let res: Response;
  try {
    res = await fetch(fullUrl, init);
  } catch {
    throw new Error(
      `Proxy unreachable — check your connection or change the proxy in Settings > Proxy.`,
    );
  }

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      throw new Error(
        `Proxy blocked (${res.status}). Try a different proxy in Settings > Proxy.`,
      );
    }
    throw new Error(
      `Fetch failed (${res.status}). If this persists, try changing the proxy in Settings > Proxy.`,
    );
  }

  return res;
}
