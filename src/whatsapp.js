// WhatsApp-meldingen.
//
// Kies een provider met de omgevingsvariabele WHATSAPP_PROVIDER:
//
//   none      (standaard) – berichten worden enkel in de serverlog getoond.
//   callmebot – gratis. Elke gebruiker activeert CallMeBot één keer op zijn
//               eigen gsm en vult zijn telefoonnummer + API-sleutel in op de
//               profielpagina. Berichten komen binnen van het CallMeBot-nummer.
//   meta      – officiële WhatsApp Cloud API van Meta (vereist een Meta
//               Business-account). Stel in:
//                 WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
//                 WHATSAPP_TEMPLATE (optioneel, naam van een goedgekeurde
//                 template met 1 body-parameter; nodig om mensen te bereiken
//                 die de laatste 24u niet zelf naar het nummer stuurden)
//                 WHATSAPP_TEMPLATE_LANG (standaard "nl")
//
// Opmerking: geen enkele officiële API laat toe in een bestaande WhatsApp-
// groep te posten; elk gezinslid krijgt het bericht dus persoonlijk.

const { db } = require('./db');

const PROVIDER = (process.env.WHATSAPP_PROVIDER || 'none').toLowerCase();
const SITE_URL = process.env.SITE_URL || '';

function recipients(excludeUserId) {
  return db
    .prepare(
      `SELECT id, name, phone, callmebot_key FROM users
       WHERE active = 1 AND notify_whatsapp = 1 AND phone IS NOT NULL AND phone <> ''
         AND id IS NOT ?`
    )
    .all(excludeUserId ?? null);
}

const normalizePhone = (p) => String(p).replace(/[^\d+]/g, '');

async function sendCallMeBot(user, text) {
  if (!user.callmebot_key) return;
  const url =
    'https://api.callmebot.com/whatsapp.php?' +
    new URLSearchParams({ phone: normalizePhone(user.phone), text, apikey: user.callmebot_key });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CallMeBot ${res.status}`);
}

async function sendMeta(user, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) throw new Error('WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID ontbreken');
  const to = normalizePhone(user.phone).replace(/^\+/, '');
  const template = process.env.WHATSAPP_TEMPLATE;
  const body = template
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || 'nl' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: text.slice(0, 1000) }] }],
        },
      }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Meta ${res.status}: ${await res.text()}`);
}

// Stuurt een melding naar alle gebruikers (behalve degene die de actie deed).
// Loopt op de achtergrond; fouten worden gelogd maar blokkeren niets.
function notify(text, { excludeUserId } = {}) {
  const full = SITE_URL ? `${text}\n${SITE_URL}` : text;
  const list = recipients(excludeUserId);
  if (PROVIDER === 'none') {
    console.log(`[whatsapp:none] → ${list.length} ontvanger(s): ${full.replace(/\n/g, ' | ')}`);
    return;
  }
  const send = PROVIDER === 'meta' ? sendMeta : sendCallMeBot;
  // CallMeBot verwerkt best één bericht tegelijk; daarom sequentieel.
  (async () => {
    for (const u of list) {
      try {
        await send(u, full);
      } catch (err) {
        console.error(`[whatsapp:${PROVIDER}] naar ${u.name} mislukt:`, err.message);
      }
    }
  })();
}

module.exports = { notify, PROVIDER };
