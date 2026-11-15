import { isValidAdminSession } from "./_lib/admin-auth.js";
const PAGES = new Set(["/admin.html", "/admin-orders.html"]);
const APIS = new Set(["/api/orders", "/api/order-status"]);
export async function onRequest({request,env,next}) {
 const url=new URL(request.url);
 if(!PAGES.has(url.pathname)&&!APIS.has(url.pathname)) return next();
 if(await isValidAdminSession(request,env.SESSION_SECRET||"")) return next();
 if(APIS.has(url.pathname)) return new Response(JSON.stringify({ok:false,error:"Требуется вход администратора."}),{status:401,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
 const login=new URL("/admin-login.html",url.origin);login.searchParams.set("next",url.pathname);return Response.redirect(login.toString(),302);
}