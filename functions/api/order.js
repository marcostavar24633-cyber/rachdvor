// Cloudflare Pages Function: POST /api/order
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

const MAX_BODY_BYTES = 16 * 1024;
const MAX_ITEMS = 30;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  })[ch]);
}

async function loadCatalog(request, env) {
  const stored = env.ORDERS_KV ? await env.ORDERS_KV.get("catalog:data") : null;
  if (stored) return JSON.parse(stored);
  const response = await fetch(new URL("/data.json", request.url));
  if (!response.ok) throw new Error("Catalog unavailable");
  return response.json();
}

async function notifyTelegram(order, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const itemLines = order.items.map(item =>
    "• " + escapeHtml(item.name) + " — " + escapeHtml(item.quantity) +
    (item.option ? " (" + escapeHtml(item.option) + ")" : "")
  ).join("\n");
  const message = [
    "🦞 <b>Новая заявка — Рачный двор</b>",
    "<b>Номер:</b> <code>" + escapeHtml(order.id) + "</code>",
    "<b>Имя:</b> " + escapeHtml(order.name || "Не указано"),
    "<b>Контакт:</b> " + escapeHtml(order.contact),
    "<b>Получение:</b> " + escapeHtml(order.delivery),
    "<b>Заказ:</b>",
    itemLines,
    order.comment ? "<b>Комментарий:</b> " + escapeHtml(order.comment) : "",
    "<b>Время:</b> " + escapeHtml(order.createdAt)
  ].filter(Boolean).join("\n");
  try {
    const response = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML", disable_web_page_preview: true })
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.ok === true;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Ожидается JSON." }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ ok: false, error: "Заявка слишком большая." }, 413);

  let raw;
  try {
    raw = await request.text();
  } catch {
    return json({ ok: false, error: "Не удалось прочитать запрос." }, 400);
  }
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ ok: false, error: "Заявка слишком большая." }, 413);

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "Некорректный формат запроса." }, 400);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return json({ ok: false, error: "Некорректные данные заявки." }, 400);
  }

  // Honeypot: bots often fill hidden fields. Return a generic success without storing.
  if (typeof data.website === "string" && data.website.trim()) {
    return json({ ok: true, message: "Заявка принята." }, 200);
  }

  const name = String(data.name || "").trim().slice(0, 80);
  const contact = String(data.contact || "").trim().slice(0, 120);
  const comment = String(data.comment || "").trim().slice(0, 1000);
  const delivery = String(data.delivery || "Уточнить у продавца").trim().slice(0, 80);
  if (contact.length < 5) return json({ ok: false, error: "Укажите корректный контакт для связи." }, 400);
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > MAX_ITEMS) {
    return json({ ok: false, error: "Проверьте состав заказа (от 1 до 30 позиций)." }, 400);
  }

  let catalog;
  try {
    catalog = await loadCatalog(request, env);
  } catch {
    return json({ ok: false, error: "Не удалось проверить каталог. Попробуйте позже." }, 503);
  }
  const products = new Map((Array.isArray(catalog.products) ? catalog.products : []).map(product => [String(product.id), product]));
  const cleanItems = [];
  for (const item of data.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return json({ ok: false, error: "Некорректная позиция заказа." }, 400);
    }
    const id = String(item.id || "").trim();
    const product = products.get(id);
    const quantity = String(item.quantity || "").trim().slice(0, 40);
    const option = String(item.option || "").trim().slice(0, 80);
    if (!product || product.available === false) {
      return json({ ok: false, error: "Одна из выбранных позиций больше недоступна. Обновите каталог." }, 400);
    }
    if (!quantity) return json({ ok: false, error: "Укажите количество для каждой позиции." }, 400);
    // Product names and units are authoritative catalog values, never client-provided labels.
    cleanItems.push({
      id,
      name: String(product.name || "Товар").slice(0, 120),
      quantity,
      unit: String(product.unit || "").slice(0, 30),
      option
    });
  }

  const order = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "Новый",
    name,
    contact,
    delivery,
    comment,
    items: cleanItems
  };

  if (!env.ORDERS_KV) {
    return json({ ok: false, saved: false, error: "Приём заявок временно не настроен." }, 503);
  }

  try {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const bucket = new Date().toISOString().slice(0, 13);
    const rateKey = `rate:order:${ip}:${bucket}`;
    const count = Number(await env.ORDERS_KV.get(rateKey) || "0");
    if (count >= 8) return json({ ok: false, error: "Слишком много запросов. Попробуйте позже." }, 429);
    await env.ORDERS_KV.put(rateKey, String(count + 1), { expirationTtl: 7200 });
    await env.ORDERS_KV.put(`order:${order.id}`, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 90 });
    const notificationSent = await notifyTelegram(order, env);
    return json({ ok: true, saved: true, orderId: order.id, notificationSent });
  } catch {
    return json({ ok: false, saved: false, error: "Не удалось сохранить заявку. Попробуйте позже." }, 500);
  }
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400"
      }
    });
  }
  return json({ ok: false, error: "Метод не поддерживается." }, 405);
}
