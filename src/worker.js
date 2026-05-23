/**
 * Cloudflare Worker — serve static dashboard assets with sensible cache/security headers.
 * Static files live in web/; wrangler bundles this script separately from [assets].
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const response = await env.ASSETS.fetch(request);
    if (response.status === 404 || response.status >= 500) {
      return response;
    }

    const headers = new Headers(response.headers);
    const path = url.pathname;

    if (path.endsWith(".json")) {
      headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
    } else if (/\.(css|js|png|webp|avif|svg|ico)$/.test(path)) {
      headers.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=3600");
    } else if (path.endsWith(".html") || path.endsWith("/")) {
      headers.set("Cache-Control", "public, max-age=600, stale-while-revalidate=120");
    }

    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
