import { requireAdmin, adminJson } from "../_lib/admin-auth.js";
const PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 2048;
export async function onRequestGet({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("limit") || PAGE_SIZE);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(PAGE_SIZE, Math.floor(requested))) : PAGE_SIZE;
  const cursor = url.searchParams.get("cursor") || "";
  if (cursor.length > MAX_CURSOR_LENGTH) return adminJson({ ok: false, error: "Некорректный курсор страницы." }, 400);
  try {
    const options = { prefix: "order:", limit };
    if (cursor) options.cursor = cursor;
    const listed = await env.ORDERS_KV.list(options);
    const records = await Promise.all(listed.keys.map(async ({ name }) => {
      const raw = await env.ORDERS_KV.get(name);
      if (!raw) return null;
      try { const order = JSON.parse(raw); return order && typeof order === "object" && !Array.isArray(order) ? order : null; }
      catch { return null; }
    }));
    const orders = records.filter(Boolean).sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const nextCursor = listed.list_complete === false && listed.cursor ? listed.cursor : null;
    return adminJson({ ok: true, orders, count: orders.length, hasMore: Boolean(nextCursor), nextCursor });
  } catch {
    return adminJson({ ok: false, error: "Не удалось загрузить заказы." }, 500);
  }
}
