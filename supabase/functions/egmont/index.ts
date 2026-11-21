// Supabase Edge Function "egmont"
//
// Doet twee dingen:
//  1. WhatsApp: wordt aangeroepen door een Database Webhook op INSERT in
//     public.messages en stuurt elk nieuw bericht (chat of melding over een
//     reservatie) naar alle actieve gebruikers, behalve wie het zelf deed.
//  2. Beheer: de beheerpagina roept deze functie aan om gebruikers aan te maken,
//     een tijdelijk paswoord te geven of te verwijderen (dat vraagt de
//     service_role-sleutel, die nooit in de website mag staan).
//
// Secrets (Supabase > Edge Functions > Secrets):
//   WEBHOOK_SECRET     zelfgekozen lange willekeurige tekst (ook in de webhook-header)
//   SITE_URL           bv. https://zee.jouwdomein.be
//   WHATSAPP_PROVIDER  none | callmebot | meta          (standaard: none)
//   Voor meta:  WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
//               WHATSAPP_TEMPLATE (optioneel), WHATSAPP_TEMPLATE_LANG (standaard nl)
// SUPABASE_URL, SUPABASE_ANON_KEY en SUPABASE_SERVICE_ROLE_KEY zijn er automatisch.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ---------------- WhatsApp ----------------
type Recipient = { id: string; name: string; phone: string; callmebot_key?: string };

const normalizePhone = (p: string) => p.replace(/[^\d+]/g, "");

async function sendCallMeBot(r: Recipient, text: string) {
  if (!r.callmebot_key) return;
  const url = "https://api.callmebot.com/whatsapp.php?" +
    new URLSearchParams({ phone: normalizePhone(r.phone), text, apikey: r.callmebot_key });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CallMeBot ${res.status}`);
}

async function sendMeta(r: Recipient, text: string) {
  const to = normalizePhone(r.phone).replace(/^\+/, "");
  const template = env("WHATSAPP_TEMPLATE");
  const body = template
    ? {
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: template,
        language: { code: env("WHATSAPP_TEMPLATE_LANG") || "nl" },
        components: [{ type: "body", parameters: [{ type: "text", text: text.slice(0, 1000) }] }],
      },
    }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
  const res = await fetch(`https://graph.facebook.com/v21.0/${env("WHATSAPP_PHONE_NUMBER_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Meta ${res.status}: ${await res.text()}`);
}

async function broadcast(text: string, excludeId: string | null) {
  const provider = (env("WHATSAPP_PROVIDER") || "none").toLowerCase();
  const { data: users, error } = await admin
    .from("profiles")
    .select("id, name, phone")
    .eq("active", true)
    .eq("notify_whatsapp", true)
    .not("phone", "is", null)
    .neq("phone", "");
  if (error) throw error;
  const list: Recipient[] = (users ?? []).filter((u) => u.id !== excludeId);
  if (provider === "callmebot" && list.length) {
    const { data: keys } = await admin.from("whatsapp_keys").select("user_id, callmebot_key")
      .in("user_id", list.map((u) => u.id));
    for (const u of list) u.callmebot_key = keys?.find((k) => k.user_id === u.id)?.callmebot_key;
  }
  const site = env("SITE_URL");
  const full = site ? `${text}\n${site}` : text;
  if (provider === "none") {
    console.log(`[whatsapp:none] ${list.length} ontvanger(s): ${full}`);
    return { sent: 0, provider };
  }
  let sent = 0;
  for (const u of list) {
    try {
      await (provider === "meta" ? sendMeta : sendCallMeBot)(u, full);
      sent++;
    } catch (e) {
      console.error(`WhatsApp naar ${u.name} mislukt:`, (e as Error).message);
    }
  }
  return { sent, provider };
}

async function handleWebhook(payload: {
  type: string; table: string;
  record: { user_id: string | null; actor_id: string | null; is_system: boolean; body: string };
}) {
  if (payload.table !== "messages" || payload.type !== "INSERT") return json({ ignored: true });
  const m = payload.record;
  let text = m.body;
  if (!m.is_system && m.user_id) {
    const { data } = await admin.from("profiles").select("name").eq("id", m.user_id).single();
    text = `💬 ${data?.name ?? "Iemand"}: ${m.body}`;
  }
  return json(await broadcast(text, m.is_system ? m.actor_id : m.user_id));
}

// ---------------- Beheer ----------------
function tempPassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

async function handleAdmin(req: Request, body: Record<string, unknown>) {
  // Wie roept aan? Controleer de login en of die persoon beheerder is.
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return json({ error: "Niet ingelogd" }, 401);
  const { data: me } = await admin.from("profiles").select("name, is_admin, active").eq("id", user.id).single();
  if (!me?.is_admin || !me.active) return json({ error: "Enkel voor beheerders" }, 403);

  switch (body.action) {
    case "create-user": {
      const email = String(body.email ?? "").trim().toLowerCase();
      const name = String(body.name ?? "").trim().slice(0, 80);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Ongeldig e-mailadres" }, 400);
      if (!name) return json({ error: "Naam is verplicht" }, 400);
      const password = tempPassword();
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { name },
      });
      if (error) {
        const exists = /already|registered|exists/i.test(error.message);
        return json({ error: exists ? "Dit e-mailadres bestaat al" : error.message }, exists ? 409 : 400);
      }
      const { error: e2 } = await admin.from("profiles").update({
        name,
        party: body.party || null,
        is_admin: !!body.is_admin,
        phone: String(body.phone ?? "").trim() || null,
        active: true,
        must_change_password: true,
      }).eq("id", data.user.id);
      if (e2) return json({ error: e2.message }, 400);
      return json({ id: data.user.id, email, name, temp_password: password });
    }
    case "reset-password": {
      const id = String(body.id ?? "");
      const password = tempPassword();
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ must_change_password: true }).eq("id", id);
      return json({ temp_password: password });
    }
    case "delete-user": {
      const id = String(body.id ?? "");
      if (id === user.id) return json({ error: "Je kan jezelf niet verwijderen" }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }
    case "whatsapp-test":
      return json(await broadcast(`✅ Testbericht van de reservatiesite (verstuurd door ${me.name})`, null));
    default:
      return json({ error: "Onbekende actie" }, 400);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Alleen POST" }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Ongeldige aanvraag" }, 400);
  }
  try {
    const secret = req.headers.get("x-webhook-secret");
    if (secret !== null) {
      if (!env("WEBHOOK_SECRET") || secret !== env("WEBHOOK_SECRET")) return json({ error: "Niet toegestaan" }, 401);
      // deno-lint-ignore no-explicit-any
      return await handleWebhook(body as any);
    }
    return await handleAdmin(req, body);
  } catch (e) {
    console.error(e);
    return json({ error: "Serverfout" }, 500);
  }
});
