import { requireAdmin, adminJson } from "../_lib/admin-auth.js";

const KEY = "catalog:data";
const MAX_BYTES = 100 * 1024;

export function isCatalogProductRecord(item) {
  return Boolean(item && typeof item === "object" && !Array.isArray(item));
}

export function isAllowedCatalogImage(value) {
  const image = String(value || "").trim();
  if (!image) return true;
  if (/^https:\/\//i.test(image)) return true;
  // Permit repository-local assets while rejecting absolute paths and traversal.
  return /^assets\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9._-]+)*$/.test(image) &&
    !image.split("/").some(segment => segment === "." || segment === "..");
}

export async function onRequestGet({ request, env }) {
  try {
    const stored = env.ORDERS_KV ? await env.ORDERS_KV.get(KEY) : null;
    if (stored) return new Response(stored, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    const fallback = await fetch(new URL("/data.json", request.url));
    if (!fallback.ok) return adminJson({ ok: false, error: "Каталог пока недоступен." }, 503);
    return new Response(await fallback.text(), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch {
    return adminJson({ ok: false, error: "Не удалось загрузить каталог." }, 500);
  }
}

async function readBoundedJson(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return { error: adminJson({ ok: false, error: "Ожидается Content-Type: application/json." }, 415) };
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    return { error: adminJson({ ok: false, error: "Файл каталога слишком большой (максимум 100 КБ)." }, 413) };
  }

  if (!request.body) return { error: adminJson({ ok: false, error: "Пустое тело запроса." }, 400) };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return { error: adminJson({ ok: false, error: "Файл каталога слишком большой (максимум 100 КБ)." }, 413) };
      }
      chunks.push(value);
    }
  } catch {
    return { error: adminJson({ ok: false, error: "Не удалось прочитать тело запроса." }, 400) };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { error: adminJson({ ok: false, error: "Некорректный JSON." }, 400) };
  }
}

export async function onRequestPut({ request, env }) {
  const denied = await requireAdmin(request, env);
  if (denied) return denied;
  const parsed = await readBoundedJson(request);
  if (parsed.error) return parsed.error;
  const data = parsed.data;
  if (!data || !Array.isArray(data.products) || data.products.length > 200) return adminJson({ ok: false, error: "Каталог должен содержать массив products (не более 200 товаров)." }, 400);
  const ids = new Set();
  const products = [];
  for (const item of data.products) {
    const id = String(item.id || "").trim();
    const name = String(item.name || "").trim();
    if (!/^[a-z0-9-]{1,64}$/.test(id) || !name || name.length > 120 || ids.has(id)) return adminJson({ ok: false, error: "Проверьте ID и названия товаров. ID должны быть уникальными и состоять из латиницы, цифр и дефиса." }, 400);
    ids.add(id);
    const price = item.price === "" || item.price == null ? "" : Number(item.price);
    if (price !== "" && (!Number.isFinite(price) || price < 0 || price > 100000000)) return adminJson({ ok: false, error: "Некорректная цена товара: " + name }, 400);
    const image = String(item.image || "").trim();
    if (!isAllowedCatalogImage(image)) return adminJson({ ok: false, error: "Для фотографий используйте HTTPS-ссылки или локальные файлы из папки assets/." }, 400);
    products.push({
      id, name,
      category: String(item.category || "").slice(0, 80),
      tag: String(item.tag || "").slice(0, 80),
      description: String(item.description || "").slice(0, 1500),
      size: String(item.size || "").slice(0, 120),
      composition: String(item.composition || "").slice(0, 500),
      price, unit: String(item.unit || "").slice(0, 30),
      image, available: item.available !== false
    });
  }
  const delivery = data.delivery && typeof data.delivery === "object" ? {
    city: String(data.delivery.city || "").slice(0, 120),
    terms: String(data.delivery.terms || "").slice(0, 1000),
    fee: String(data.delivery.fee || "").slice(0, 40),
    payment: String(data.delivery.payment || "").slice(0, 500)
  } : {};
  const clean = { shopName: String(data.shopName || "Рачный двор").slice(0, 120), currency: "₽", products, delivery };
  try {
    await env.ORDERS_KV.put(KEY, JSON.stringify(clean));
    return adminJson({ ok: true, saved: true, productCount: products.length, updatedAt: new Date().toISOString() });
  } catch {
    return adminJson({ ok: false, error: "Не удалось сохранить каталог в хранилище." }, 500);
  }
}
