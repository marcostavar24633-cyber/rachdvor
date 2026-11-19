import { createAdminSession, sessionCookie, adminJson } from "../_lib/admin-auth.js";

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  let difference = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) difference |= (x[i] || 0) ^ (y[i] || 0);
  return difference === 0;
}

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    return adminJson({ ok: false, error: "Администратор ещё не настроен. Добавьте ADMIN_PASSWORD и SESSION_SECRET в Cloudflare." }, 503);
  }
  if (!env.ORDERS_KV) {
    return adminJson({ ok: false, error: "Хранилище не подключено. Вход администратора временно недоступен." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return adminJson({ ok: false, error: "Некорректный запрос." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.password !== "string" || body.password.length > 512) {
    return adminJson({ ok: false, error: "Некорректный запрос." }, 400);
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = "admin-login-rate:" + ip;
  try {
    const attempts = Number(await env.ORDERS_KV.get(key) || 0);
    if (attempts >= 8) return adminJson({ ok: false, error: "Слишком много попыток. Повторите через 15 минут." }, 429);
    await env.ORDERS_KV.put(key, String(attempts + 1), { expirationTtl: 900 });

    if (!safeEqual(body.password, env.ADMIN_PASSWORD)) {
      return adminJson({ ok: false, error: "Неверный пароль." }, 401);
    }
    await env.ORDERS_KV.delete(key);
    const token = await createAdminSession(env.SESSION_SECRET);
    return adminJson({ ok: true }, 200, { "set-cookie": sessionCookie(token) });
  } catch {
    return adminJson({ ok: false, error: "Не удалось проверить вход. Попробуйте позже." }, 503);
  }
}
