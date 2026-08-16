const REQUEST_HEADER_ALLOWLIST = ["accept", "content-type", "last-event-id"];
const RESPONSE_HEADER_ALLOWLIST = [
  "cache-control",
  "content-disposition",
  "content-type",
  "x-request-id",
];

function configurationError(message) {
  return Response.json(
    { ok: false, error: message },
    {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

/**
 * Same-origin API gateway for the public Cloudflare Pages demo.
 *
 * The browser never receives the local sidecar token. Pages injects it from
 * an encrypted secret and forwards only the small set of headers the Agent
 * protocol actually needs. The upstream URL is also configured as a secret
 * because Quick Tunnel hostnames can change when the connector is recreated.
 */
export async function onRequest({ request, env }) {
  const originUrl = String(env.GENECODE_ORIGIN_URL || "").trim().replace(/\/+$/, "");
  const originToken = String(env.GENECODE_ORIGIN_TOKEN || "").trim();

  if (!originUrl) return configurationError("Agent origin is not configured.");
  if (!originToken) return configurationError("Agent authentication is not configured.");

  let target;
  try {
    const incoming = new URL(request.url);
    target = new URL(originUrl);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
  } catch {
    return configurationError("Agent origin configuration is invalid.");
  }

  const requestHeaders = new Headers();
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = request.headers.get(name);
    if (value) requestHeaders.set(name, value);
  }
  requestHeaders.set("X-GeneCode-Token", originToken);

  const init = {
    method: request.method,
    headers: requestHeaders,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Buffer the small JSON request body so the gateway behaves consistently
    // in both the Workers runtime and local Node-based deployment checks.
    init.body = await request.arrayBuffer();
  }

  let upstream;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      { ok: false, error: "Agent service is temporarily unavailable." },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  responseHeaders.set("X-Content-Type-Options", "nosniff");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
