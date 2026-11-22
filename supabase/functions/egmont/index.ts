// Supabase Edge Function "egmont"
//
// Doet twee dingen:
//  1. Meldingen: wordt aangeroepen door een Database Webhook op INSERT in
//     public.messages en stuurt elk nieuw bericht (chat of melding over een
//     reservatie) per e-mail (en optioneel WhatsApp) naar alle actieve
//     gebruikers, behalve wie het zelf deed. Elke gebruiker kiest op de pagina
//     Profiel welke mails hij wil (standaard: enkel wijzigingen in de kalender).
//  2. Beheer: de beheerpagina roept deze functie aan om gebruikers aan te maken,
//     een tijdelijk paswoord te geven of te verwijderen (dat vraagt de
//     service_role-sleutel, die nooit in de website mag staan).
//
// Secrets (Supabase > Edge Functions > Secrets):
//   WEBHOOK_SECRET     zelfgekozen lange willekeurige tekst (ook in de webhook-header)
//   SITE_URL           bv. https://zee.vanwaetermeulen.be
//   RESEND_API_KEY     sleutel van resend.com (voor de e-mailmeldingen)
//   MAIL_FROM          bv. Appartement aan zee <zee@vanwaetermeulen.be>
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

// ---------------- E-mail (Resend) ----------------
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function mailHtml(text: string, extraHtml = "") {
  const site = env("SITE_URL").replace(/\/$/, "");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#1f2a33">
    <p style="white-space:pre-line;margin:0 0 16px">${esc(text)}</p>${extraHtml}
    ${site ? `<p><a href="${site}" style="display:inline-block;background:#0e7490;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open de kalender</a></p>` : ""}
    <p style="color:#6b7a86;font-size:12px;margin-top:24px">Je krijgt deze mail van de reservatiesite van het appartement aan zee.
    Welke mails je krijgt, kies je zelf op de pagina Profiel.</p></div>`;
}

async function sendMails(to: string[], subject: string, text: string, extra?: { html: string; text: string }) {
  if (!to.length) return 0;
  if (!env("RESEND_API_KEY") || !env("MAIL_FROM")) {
    console.log(`[mail] RESEND_API_KEY/MAIL_FROM ontbreken; niet verstuurd naar ${to.length} ontvanger(s): ${subject}`);
    return 0;
  }
  const html = mailHtml(text, extra?.html ?? "");
  if (extra) text = `${text}\n\n${extra.text}`;
  // Eén mail per persoon (niemand ziet de andere adressen); per 100 via de batch-API.
  let sent = 0;
  for (let i = 0; i < to.length; i += 100) {
    const batch = to.slice(i, i + 100).map((addr) => ({ from: env("MAIL_FROM"), to: [addr], subject, html, text }));
    const res = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!res.ok) console.error(`Resend ${res.status}: ${await res.text()}`);
    else sent += batch.length;
  }
  return sent;
}

// Overzicht van alle reservaties voor de komende 12 maanden, voor in de mail.
async function yearOverview() {
  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const until = new Date(today.getTime() + 365 * 86400000).toISOString().slice(0, 10);
  const [{ data: res }, { data: parties }] = await Promise.all([
    admin.from("reservations").select("party, start_date, end_date, note")
      .gt("end_date", from).lt("start_date", until).order("start_date"),
    admin.from("parties").select("key, label, color, external"),
  ]);
  type Party = { key: string; label: string; color: string; external: boolean };
  const pmap = new Map<string, Party>(((parties ?? []) as Party[]).map((p) => [p.key, p]));
  const dfmt = (s: string) =>
    new Date(s + "T12:00:00Z").toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const n = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const rows = (res ?? []).map((r) => {
    const p = pmap.get(r.party) ?? { label: r.party, color: "#999", external: false };
    return { label: p.external ? "Externe verhuur" : p.label, color: p.color, ext: p.external, ...r, nights: n(r.start_date, r.end_date) };
  });
  const title = "Overzicht komende 12 maanden";
  if (!rows.length) {
    return { text: `${title}: nog niets gereserveerd.`, html: `<h3 style="font-size:15px;margin:24px 0 8px">${title}</h3><p>Nog niets gereserveerd.</p>` };
  }
  const text = `${title}:\n` +
    rows.map((r) => `- ${r.label}: ${dfmt(r.start_date)} → ${dfmt(r.end_date)} (${r.nights} n.)`).join("\n");
  const html = `<h3 style="font-size:15px;margin:24px 0 8px">${title}</h3>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
    ${rows.map((r) => `<tr>
      <td style="padding:4px 8px 4px 0;vertical-align:top"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${r.color};${r.ext ? "outline:2px dashed #999;outline-offset:-2px;" : ""}"></span></td>
      <td style="padding:4px 12px 4px 0;vertical-align:top;font-weight:600;white-space:nowrap">${esc(r.label)}</td>
      <td style="padding:4px 12px 4px 0;vertical-align:top;white-space:nowrap">${esc(dfmt(r.start_date))} → ${esc(dfmt(r.end_date))}</td>
      <td style="padding:4px 0;vertical-align:top;color:#6b7a86;white-space:nowrap">${r.nights} n.</td></tr>`).join("")}
    </table>`;
  return { text, html };
}

async function mailEveryone(text: string, isChat: boolean, excludeId: string | null) {
  const { data, error } = await admin
    .from("profiles")
    .select("id, email")
    .eq("active", true)
    .eq(isChat ? "notify_email_chat" : "notify_email_reservations", true);
  if (error) throw error;
  const to = (data ?? []).filter((u) => u.id !== excludeId).map((u) => u.email);
  // Onderwerp, bv. "Nieuwe reservatie door Celine – Celine & Matthias: 05/01/2027 → 08/01/2027"
  const lines = text.split("\n").map((l) => l.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, ""));
  const detail = (lines.find((l) => l.startsWith("Nu: ")) ?? lines[1] ?? "").replace(/^Nu: /, "").replace(/ \(\d+ nachten\)$/, "");
  const subject = (isChat ? `Bericht van ${lines[0]}` : detail ? `${lines[0]} – ${detail}` : lines[0]).slice(0, 140);
  if (!to.length) return 0;
  return sendMails(to, subject, text, isChat ? undefined : await yearOverview());
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
  const exclude = m.is_system ? m.actor_id : m.user_id;
  const [mail, whatsapp] = await Promise.allSettled([
    mailEveryone(text, !m.is_system, exclude),
    broadcast(text, exclude),
  ]);
  for (const r of [mail, whatsapp]) if (r.status === "rejected") console.error(r.reason);
  return json({ mail: mail.status === "fulfilled" ? mail.value : 0 });
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
    case "mail-test": {
      if (!env("RESEND_API_KEY") || !env("MAIL_FROM")) {
        return json({ error: "RESEND_API_KEY of MAIL_FROM ontbreekt bij de Edge Function-secrets" }, 400);
      }
      const n = await sendMails([user.email!], "Testmail van de reservatiesite",
        `✅ Dit is een testmail.\nDe e-mailmeldingen van de reservatiesite werken.`);
      if (!n) return json({ error: "Versturen mislukt; bekijk de logs van de Edge Function" }, 500);
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
