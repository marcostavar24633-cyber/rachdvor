import {clearSessionCookie,adminJson} from "../_lib/admin-auth.js";
export async function onRequestPost(){return adminJson({ok:true},200,{"set-cookie":clearSessionCookie()});}