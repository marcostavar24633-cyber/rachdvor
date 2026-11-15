import { requireAdmin, adminJson } from "../_lib/admin-auth.js";

export async function onRequestGet({ request, env }) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, Math.floor(requested))) : 50;

  try {
    const listed = await env.ORDERS_KV.list({ prefix: "order:", limit: 1000 });
    const records = await Promise.all(listed.keys.map(async ({ name }) => {
      const raw = await env.ORDERS_KV.get(name);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    }));

    const orders = records
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, limit);

    return adminJson({
      ok: true,
      orders,
      count: orders.length,
      truncated: listed.keys.length >= 1000 || Boolean(listed.list_complete === false)
    });
  } catch {
    return adminJson({ ok: false, error: "Не удалось загрузить заказы." }, 500);
  }
}
