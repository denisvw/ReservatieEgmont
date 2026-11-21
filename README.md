# Appartement aan zee: handleiding

Een besloten website om het appartement te reserveren binnen de familie. Externe verhuur staat er duidelijk apart op. Het is dezelfde opbouw als Gilles' world: **Netlify** voor de website, **Supabase** voor login en database, en **Resend** voor de mails.

```
ReservatieEgmont/
  site/                    de website (gewone HTML, CSS en JavaScript, geen bouwstap)
    index.html             login, kalender, chat, profiel en beheer
    js/config.js           HIER vul je je twee Supabase-gegevens in
    js/app.js
    css/style.css
    _headers               beveiligingsinstellingen voor Netlify
  supabase/
    schema.sql             database, partijen en beveiliging
    functions/egmont/      WhatsApp-meldingen en gebruikers aanmaken
  .github/workflows/
    wakker-houden.yml      houdt een gratis Supabase-project actief
```

## Wat de site doet

- **Inloggen** met e-mailadres en paswoord. Niemand kan zich zelf registreren. Jij maakt de accounts aan in **Beheer** en geeft het tijdelijke paswoord door. Bij de eerste login kiest iedereen een eigen paswoord. Via *Paswoord vergeten?* krijg je een mail.
- **Kalender** per maand, met een kleur per partij: Celine & Matthias, Nadine & Johan, Mieke & Denis, Nicolas & Jef, Stefanie & Jonas, Mathis en **EXTERNAL**. Externe verhuur is donker en gestreept met het label "EXTERN". Onder de kalender staan de komende periodes.
- **Regels**, afgedwongen in de database zelf, niet alleen in de pagina:
  - Een familielid reserveert, wijzigt of annuleert alleen voor de eigen partij.
  - Alleen de beheerder geeft externe verhuur in.
  - Twee reservaties kunnen nooit overlappen. De vertrekdag mag wel de aankomstdag van de volgende zijn.
- **Chat**: elk bericht gaat ook via WhatsApp naar de anderen. Elke nieuwe, gewijzigde of geannuleerde reservatie komt automatisch in de chat en gaat dus ook via WhatsApp rond.
- **Beheer**: gebruikers aanmaken, aan een partij koppelen, beheerder maken, (de)activeren, een nieuw tijdelijk paswoord geven of verwijderen, en een WhatsApp-test sturen.

---

## Stap 1: Supabase (±15 min)

> **Maak een apart project**, niet in het project van Gilles' world. Zet het in een **nieuwe, gratis organisatie**. Een tweede project in je Pro-organisatie kost ongeveer 10 dollar per maand extra. Een gratis project pauzeert na een week zonder bezoek. Daarom is er de taak *wakker houden* (zie stap 6).

1. Op **supabase.com**: *New organization* (plan **Free**), en daarin *New project*. Kies als regio **Central EU (Frankfurt)**.
2. Ga naar **SQL Editor → New query**, plak de volledige inhoud van `supabase/schema.sql` en klik **Run**.
3. Noteer bij **Project Settings → API** de **Project URL** en de **publishable/anon** key, en vul ze in `site/js/config.js` in.
4. Ga naar **Authentication → Sign In / Providers**:
   - Zet **Allow new users to sign up** **uit**. Zelfs als het aan zou staan, krijgt een vreemde geen toegang, want nieuwe accounts staan standaard op *niet actief*.
   - Laat **Email** aan.
5. Bij **Authentication → URL Configuration**:
   - **Site URL**: bv. `https://zee.jouwdomein.be`
   - **Redirect URLs**: `https://zee.jouwdomein.be/*` (en tijdens het testen ook je Netlify-adres)

## Stap 2: e-mail via Resend (±10 min)

Je hergebruikt je bestaande Resend-account. Mails zijn alleen nodig voor *Paswoord vergeten*.

1. Voeg in Resend je nieuwe domein toe en zet de DNS-records die Resend toont bij je domeinregistrar. Je kunt ook het domein van Gilles' world gebruiken als afzender.
2. Ga in Supabase naar **Authentication → Emails → SMTP Settings** en zet *Custom SMTP* aan: host `smtp.resend.com`, poort `465`, gebruiker `resend`, wachtwoord = je Resend API key. Afzender bv. `zee@jouwdomein.be`, naam `Appartement aan zee`.
3. Optioneel: zet onder **Templates** de mail *Reset Password* in het Nederlands.

## Stap 3: de Edge Function voor WhatsApp en beheer (±10 min)

1. Ga in Supabase naar **Edge Functions → Deploy a new function → Via Editor**. Noem ze **`egmont`**, plak de inhoud van `supabase/functions/egmont/index.ts` en zet **Verify JWT uit**. De functie controleert zelf wie haar aanroept.
2. Vul bij **Edge Functions → Secrets** in:
   - `WEBHOOK_SECRET`: een lange willekeurige tekst die je zelf verzint
   - `SITE_URL`: bv. `https://zee.jouwdomein.be`
   - `WHATSAPP_PROVIDER`: `callmebot` (of `none` om eerst te testen, zie onder)
3. Ga naar **Database → Webhooks → Create a new hook**:
   - Tabel **`messages`**, gebeurtenis **Insert**
   - Type **Supabase Edge Functions**, functie `egmont`
   - Voeg een HTTP-header toe: `x-webhook-secret` = dezelfde tekst als hierboven

## Stap 4: de website online zetten met Netlify (±10 min)

1. Kies op **netlify.com** *Add new site → Import an existing project → GitHub* en kies `ReservatieEgmont`.
2. Zet **Publish directory** op `site`. Laat *Build command* leeg.
3. Klik *Deploy*.
4. Ga naar **Domain management → Add a domain**. Een subdomein van een domein dat je al hebt (bv. `zee.gilles-world.com` of `zee.vanwaet.be`) kost niets extra. Voor een nieuw domein betaal je ±10 euro per jaar. Netlify toont het DNS-record (meestal een `CNAME`) dat je bij je registrar zet. Het HTTPS-certificaat komt er automatisch bij.

## Stap 5: jezelf beheerder maken

1. Ga in Supabase naar **Authentication → Users → Add user → Create new user**. Vul je e-mailadres en een paswoord in en vink **Auto Confirm User** aan.
2. Voer in de **SQL Editor** uit (met jouw adres):
   ```sql
   update public.profiles
      set is_admin = true, active = true, must_change_password = false,
          name = 'Denis', party = 'mieke-denis'
    where email = 'jouw@email.be';
   ```
3. Log in op de site. Je ziet nu **Beheer**. Daar maak je de accounts voor de familie aan.

## Stap 6: wakker houden (eenmalig, 1 min)

Op GitHub, bij de repository: **Actions → Supabase wakker houden → Run workflow**. Daarna loopt de taak vanzelf elke drie dagen. Ze heeft niets nodig buiten `site/js/config.js`.

---

## WhatsApp

Geen enkele officiële WhatsApp-dienst laat toe te posten in een bestaande **groep**. Iedereen krijgt de melding dus persoonlijk. Wie de actie zelf deed, krijgt geen melding.

| `WHATSAPP_PROVIDER` | Kost | Hoe |
|---|---|---|
| `none` | – | Er wordt niets verstuurd. Je ziet de berichten in de log van de Edge Function. |
| `callmebot` | gratis | Elk familielid stuurt één keer `I allow callmebot to send me messages` naar het CallMeBot-nummer (zie callmebot.com). Daarna vult hij of zij het gsm-nummer en de ontvangen sleutel in op **Profiel**. De uitleg staat ook in de app. |
| `meta` | gratis tot ± 1000 gesprekken/maand | Officiële WhatsApp Cloud API. Je hebt een Meta Business-account, een apart nummer en een goedgekeurde template met één parameter nodig. Extra secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE`. |

Test met de knop **Testbericht versturen** in Beheer.

## Een partij toevoegen of hernoemen

Pas in `supabase/schema.sql` de lijst bij `insert into public.parties` aan en voer het hele script opnieuw uit in de SQL Editor. Er gaat niets verloren. Koppel daarna de mensen aan hun partij in **Beheer**.

## Kosten

- Supabase: gratis (aparte gratis organisatie)
- Netlify en Resend: gratis
- Domein: niets extra bij een subdomein van een domein dat je al hebt, anders ±10 euro per jaar
