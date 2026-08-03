// Supabase Edge Function: devuelve estadísticas agregadas de usuarios para el
// Dashboard del Usuario Maestro. Solo responde con datos si quien llama está
// autenticado y su email coincide con ADMIN_EMAIL (mismo email que usa
// isDevUser() en el cliente). Usa la Admin API de Supabase (service_role)
// porque auth.users no es accesible desde el cliente con la anon key.
//
// Variables de entorno (Project Settings -> Edge Functions -> Secrets):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY - ya las inyecta Supabase automáticamente,
//                                                no hace falta configurarlas a mano.
//   ADMIN_EMAIL - opcional, por defecto info@we-ref.com

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") ?? "info@we-ref.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Cliente "como quien llama", solo para verificar su identidad.
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser();
    if (callerErr || !callerData?.user || callerData.user.email !== ADMIN_EMAIL) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 403,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Cliente admin real, con permisos para listar todos los usuarios.
    const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let body: any = {};
    try { body = await req.json(); } catch (_) { /* sin body -> estadísticas por defecto */ }

    if (body && body.action === "delete") {
      const targetId = body.userId;
      if (!targetId) {
        return new Response(JSON.stringify({ error: "Falta userId" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      const { data: targetData, error: targetErr } = await adminClient.auth.admin.getUserById(targetId);
      if (targetErr || !targetData?.user) {
        return new Response(JSON.stringify({ error: "Usuario no encontrado" }), {
          status: 404,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      if (targetData.user.email === ADMIN_EMAIL) {
        return new Response(JSON.stringify({ error: "No puedes eliminar tu propia cuenta de administrador" }), {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      const { error: delErr } = await adminClient.auth.admin.deleteUser(targetId);
      if (delErr) throw delErr;
      await adminClient.from("usernames").delete().eq("user_id", targetId); // limpieza best-effort si no hay cascade
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    let allUsers: any[] = [];
    let page = 1;
    const perPage = 200;
    while (true) {
      const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      allUsers = allUsers.concat(data.users);
      if (data.users.length < perPage) break;
      page++;
      if (page > 50) break; // salvaguarda: máx. 10.000 usuarios
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    let registeredToday = 0, registeredWeek = 0, registeredMonth = 0;
    let active = 0, blocked = 0;
    const dailyCounts: Record<string, number> = {};

    for (const u of allUsers) {
      const createdAt = new Date(u.created_at);
      if (createdAt >= startOfToday) registeredToday++;
      if (createdAt >= startOfWeek) registeredWeek++;
      if (createdAt >= startOfMonth) registeredMonth++;

      const isBlocked = !!u.banned_until && new Date(u.banned_until) > now;
      if (isBlocked) {
        blocked++;
      } else if (u.last_sign_in_at && new Date(u.last_sign_in_at) >= thirtyDaysAgo) {
        active++;
      }

      if (createdAt >= thirtyDaysAgo) {
        const key = createdAt.toISOString().slice(0, 10);
        dailyCounts[key] = (dailyCounts[key] || 0) + 1;
      }
    }

    const chart: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const key = d.toISOString().slice(0, 10);
      chart.push({ date: key, count: dailyCounts[key] || 0 });
    }

    const lastTenRaw = allUsers
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);

    const lastTenIds = lastTenRaw.map((u) => u.id);
    const { data: unameRows } = await adminClient
      .from("usernames")
      .select("user_id, username")
      .in("user_id", lastTenIds.length ? lastTenIds : ["00000000-0000-0000-0000-000000000000"]);
    const unameMap: Record<string, string> = {};
    (unameRows || []).forEach((r: any) => { unameMap[r.user_id] = r.username; });

    const lastTen = lastTenRaw.map((u) => ({
      id: u.id,
      username: unameMap[u.id] || null,
      email: u.email,
      created_at: u.created_at,
      blocked: !!u.banned_until && new Date(u.banned_until) > now,
    }));

    return new Response(
      JSON.stringify({
        totalUsers: allUsers.length,
        registeredToday,
        registeredWeek,
        registeredMonth,
        active,
        inactive: Math.max(0, allUsers.length - active - blocked),
        blocked,
        chart,
        lastTen,
      }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
