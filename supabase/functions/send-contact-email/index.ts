// Supabase Edge Function: envía un email vía Resend cada vez que se inserta
// una fila en la tabla public.contact_messages (disparada por un Database
// Webhook configurado en el panel de Supabase: Database -> Webhooks).
//
// Variables de entorno requeridas (Project Settings -> Edge Functions -> Secrets):
//   RESEND_API_KEY      - API key de https://resend.com
//   CONTACT_NOTIFY_EMAIL - email donde quieres recibir los avisos (opcional, por defecto info@we-ref.com)

Deno.serve(async (req: Request) => {
  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record || !record.email || !record.message) {
      return new Response(JSON.stringify({ error: "Payload sin record válido" }), { status: 400 });
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const notifyTo = Deno.env.get("CONTACT_NOTIFY_EMAIL") ?? "info@we-ref.com";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "WEREF Contacto <onboarding@resend.dev>",
        to: [notifyTo],
        reply_to: record.email,
        subject: `Nuevo mensaje de contacto de ${record.name}`,
        text: `Nombre: ${record.name}\nEmail: ${record.email}\n\nMensaje:\n${record.message}`,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return new Response(JSON.stringify({ error: errText }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
