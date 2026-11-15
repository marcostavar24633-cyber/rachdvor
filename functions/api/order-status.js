import { requireAdmin, adminJson } from "../_lib/admin-auth.js";

const ALLOWED = new Set(["Новый", "Принят", "Готовится", "Выполнен", "Отменён"]);

export async function onRequestPatch({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let data;
  try { data = await request.json(); }
  catch { return adminJson({ ok: false, error: "Некорректный JSON." }, 400); }

  const id = String(data.id || "").trim();
  const status = String(data.status || "").trim();
  if (!/^[0-9a-f-]{20,80}$/i.test(id)) return adminJson({ ok: false, error: "Некорректный номер заказа." }, 400);
  if (!ALLOWED.has(status)) return adminJson({ ok: false, error: "Недопустимый статус." }, 400);

  const key = `order:${id}`;
  try {
    const raw = await env.ORDERS_KV.get(key);
    if (!raw) return adminJson({ ok: false, error: "Заказ не найден." }, 404);

    const order = JSON.parse(raw);
    order.status = status;
    order.updatedAt = new Date().toISOString();
    await env.ORDERS_KV.put(key, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 90 });

    return adminJson({ ok: true, order: { id: order.id, status: order.status, updatedAt: order.updatedAt } });
  } catch {
    return adminJson({ ok: false, error: "Не удалось обновить статус заказа." }, 500);
  }
}
