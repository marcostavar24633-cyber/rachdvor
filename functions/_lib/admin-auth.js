// Shared authorization for order-management endpoints.
// Protect these paths with Cloudflare Access AND set ADMIN_EMAIL in Pages env vars.
export function requireAdmin(request, env) {
  const accessEmail = request.headers.get("Cf-Access-Authenticated-User-Email");
  const allowedEmail = String(env.ADMIN_EMAIL || "").trim().toLowerCase();

  if (!allowedEmail || !accessEmail || accessEmail.trim().toLowerCase() !== allowedEmail) {
    return new Response(JSON.stringify({ ok: false, error: "Доступ запрещён." }), {
      status: 403,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      }
    });
  }
  if (!env.ORDERS_KV) {
    return new Response(JSON.stringify({ ok: false, error: "Хранилище заказов не подключено." }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    });
  }
  return null;
}

export const adminJson = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});
