const COOKIE_NAME = "__Host-rachdvor_admin";
const SESSION_SECONDS = 60 * 60 * 8;

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function createAdminSession(secret) {
  const payload = base64url(new TextEncoder().encode(JSON.stringify({ exp: Math.floor(Date.now()/1000)+SESSION_SECONDS, role:"admin" })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return payload + "." + base64url(new Uint8Array(signature));
}
export async function isValidAdminSession(request, secret) {
  if (!secret || secret.length < 32) return false;
  const header = request.headers.get("Cookie") || "";
  const entry = header.split(";").map(v=>v.trim()).find(v=>v.startsWith(COOKIE_NAME+"="));
  if (!entry) return false;
  const parts = entry.slice(COOKIE_NAME.length+1).split(".");
  if (parts.length !== 2) return false;
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromBase64url(parts[1]), new TextEncoder().encode(parts[0]));
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    return payload.role==="admin" && Number(payload.exp)>Math.floor(Date.now()/1000);
  } catch { return false; }
}
export function sessionCookie(token) { return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`; }
export function clearSessionCookie() { return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
export async function requireAdmin(request, env) {
  if (!(await isValidAdminSession(request, env.SESSION_SECRET || ""))) {
    return adminJson({ok:false,error:"Требуется вход администратора."},401);
  }
  if (!env.ORDERS_KV) return adminJson({ok:false,error:"Хранилище заказов не подключено."},503);
  return null;
}
export function adminJson(body,status=200,extraHeaders={}) {
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff",...extraHeaders}});
}
