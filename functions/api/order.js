// Cloudflare Pages Function: POST /api/order
// Optional binding: ORDERS_KV (KV namespace). If configured, stores validated order payloads.
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  })[ch]);
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
  if (!contentType.includes("application/json")) {
    return json({ ok: false, error: "Ожидается JSON." }, 415);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Некорректный формат запроса." }, 400);
  }

  // Honeypot: bots often fill hidden fields. Return a generic success without storing.
  if (typeof data.website === "string" && data.website.trim()) {
    return json({ ok: true, message: "Заявка принята." }, 200);
  }

  const name = String(data.name || "").trim().slice(0, 80);
  const contact = String(data.contact || "").trim().slice(0, 120);
  const comment = String(data.comment || "").trim().slice(0, 1000);
  const delivery = String(data.delivery || "Уточнить у продавца").trim().slice(0, 80);
  const items = Array.isArray(data.items) ? data.items.slice(0, 30) : [];

  if (contact.length < 5) return json({ ok: false, error: "Укажите корректный контакт для связи." }, 400);
  if (!items.length) return json({ ok: false, error: "Корзина пуста." }, 400);

  const cleanItems = [];
  for (const item of items) {
    const title = String(item.name || "").trim().slice(0, 120);
    const quantity = String(item.quantity || "").trim().slice(0, 40);
    const option = String(item.option || "").trim().slice(0, 80);
    if (!title || !quantity) return json({ ok: false, error: "Проверьте позиции заказа." }, 400);
    cleanItems.push({ name: title, quantity, option });
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

  if (env.ORDERS_KV) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const bucket = new Date().toISOString().slice(0, 13);
    const rateKey = `rate:${ip}:${bucket}`;
    const count = Number(await env.ORDERS_KV.get(rateKey) || "0");
    if (count >= 8) return json({ ok: false, error: "Слишком много запросов. Попробуйте позже." }, 429);
    await env.ORDERS_KV.put(rateKey, String(count + 1), { expirationTtl: 7200 });
    await env.ORDERS_KV.put(`order:${order.id}`, JSON.stringify(order), { expirationTtl: 60 * 60 * 24 * 90 });
    const notificationSent = await notifyTelegram(order, env);
    return json({ ok: true, saved: true, orderId: order.id, notificationSent });
  }

  // Without KV, accept only the validated request but do not claim it was stored.
  return json({
    ok: true,
    saved: false,
    message: "Запрос проверен, но хранилище заявок ещё не подключено."
  }, 202);
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
