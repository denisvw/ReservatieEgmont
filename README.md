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

## Stappenplan om alles operationeel te maken

Totaal ±1,5 uur. Een pas gekocht domein heeft soms een paar uur nodig voor het overal werkt. Doe intussen gerust de andere stappen met het Netlify-adres.

De site komt op **`https://zee.vanwaet.be`**. Zo blijft `vanwaet.be` zelf vrij voor later, bv. een familiesite of e-mailadressen. Wil je toch de site op `vanwaet.be` zelf, zie de opmerking bij stap 4.

**Wat je nodig hebt:** je GitHub-account en je Netlify-account (dezelfde als voor Gilles' world), een bankkaart voor het domein (±€10–15/jaar) en ongeveer een halfuur voor elk familielid om in te loggen en WhatsApp te koppelen.

Je koopt het domein via **Netlify**, net als `gilles-world.com`. Netlify regelt dan ook het DNS-beheer, dus alles staat op één plaats.

### Stap 1: de domeinnaam `vanwaet.be` kopen via Netlify (±10 min)

1. Log in op **app.netlify.com**. Klik links in het menu van je team op **Domains → Add or register domain** (of *Buy a domain*).
2. Typ `vanwaet.be` en klik *Verify* / *Check availability*.
   - **Beschikbaar met een prijs:** ga verder, vul je gegevens in en betaal. Zet **Auto-renew** aan.
   - **Al in gebruik:** kies een andere naam, bv. `familievanwaet.be`, en pas die overal in dit stappenplan aan.
   - **Netlify verkoopt geen `.be`:** zie het kader *Lukt `.be` niet via Netlify?* hieronder.
3. Na de aankoop staat `vanwaet.be` onder **Domains**, met DNS-beheer bij Netlify. Je zet daar in stap 5 een paar records voor de mail. Het kan tot een paar uur duren voor een nieuw domein overal werkt.

> **Lukt `.be` niet via Netlify?** Koop het domein dan bij een Belgische registrar (bv. Combell, one.com of OVH), enkel de domeinnaam zonder hosting. Voeg daarna in Netlify bij **Domains → Add or register domain** `vanwaet.be` toe als *bestaand domein* en kies **Set up Netlify DNS**. Netlify toont vier *nameservers* (`dns1.p0x.nsone.net` …). Vul die bij je registrar in onder *Nameservers / DNS-servers*. Vanaf dan beheer je alles in Netlify en werken stap 4 en 5 precies zoals hieronder.

### Stap 2: Supabase (±15 min)

> **Maak een apart project**, niet in het project van Gilles' world, en zet het in een **nieuwe, gratis organisatie**. Een tweede project in je Pro-organisatie kost ongeveer 10 dollar per maand extra.

1. Op **supabase.com**: rechtsboven je organisatie → *New organization*, naam `Vanwaet`, plan **Free**. Maak daarin *New project* `appartement-zee`, regio **Central EU (Frankfurt)**. Bewaar het databasewachtwoord.
2. Ga naar **SQL Editor → New query**, plak de volledige inhoud van `supabase/schema.sql` en klik **Run**. Onderaan moet *Success* staan.
3. Noteer bij **Project Settings → API** (of *API Keys*) de **Project URL** en de **publishable/anon** key.
4. Vul die twee in `site/js/config.js` in. Dat kan rechtstreeks op github.com: open het bestand, klik het potlood, vervang de twee waarden en klik *Commit changes*. Je kan ze ook aan Claude geven. Die sleutel mag publiek zijn: de beveiliging zit in de database.
5. Ga naar **Authentication → Sign In / Providers**:
   - Zet **Allow new users to sign up** **uit**.
   - Laat **Email** aan.
6. Bij **Authentication → URL Configuration**:
   - **Site URL**: `https://zee.vanwaet.be`
   - **Redirect URLs**: `https://zee.vanwaet.be/*`, en tijdelijk ook je Netlify-adres uit stap 3, bv. `https://appartement-zee.netlify.app/*`

### Stap 3: de website op Netlify (±10 min)

1. Op **netlify.com** (inloggen met GitHub): *Add new project → Import an existing project → GitHub* en kies `ReservatieEgmont`. Geef Netlify toegang tot die repository.
2. **Branch to deploy**: `main`.
3. **Publish directory**: `site`. Laat *Build command* leeg.
4. Klik *Deploy*. Onder *Project configuration → Change project name* noem je hem `appartement-zee`. Je krijgt dan het adres `https://appartement-zee.netlify.app`.
5. Open dat adres: je ziet het inlogscherm. Inloggen lukt pas na stap 6.

### Stap 4: `zee.vanwaet.be` koppelen aan de site (±2 min)

1. Open in Netlify het project `appartement-zee` → **Domain management → Add a domain**.
2. Typ `zee.vanwaet.be` en bevestig. Omdat `vanwaet.be` al bij Netlify staat, maakt Netlify het DNS-record zelf aan. Je hoeft niets in te vullen.
3. Wacht tot er een groen vinkje en **HTTPS: certificate active** staan (meestal binnen enkele minuten, bij een pas gekocht domein soms een paar uur). Netlify stuurt bezoekers automatisch naar `https://`.

> **Liever de site op `vanwaet.be` zelf?** Voeg dan in stap 4 `vanwaet.be` toe in plaats van `zee.vanwaet.be`. Netlify voegt `www.vanwaet.be` er vanzelf bij. Vervang overal in dit stappenplan `zee.vanwaet.be` door `vanwaet.be`.

### Stap 5: e-mail voor *Paswoord vergeten* via Resend (±10 min)

1. Log in op **resend.com** met je bestaande account (dat van Gilles' world). Kies **Domains → Add domain** → `vanwaet.be`, regio **Ireland (eu-west-1)**.
2. Resend toont 3 à 4 DNS-records: een `MX` en een `TXT` op `send`, een `TXT` op `resend._domainkey` en eventueel een `TXT` `_dmarc`. Zet ze in Netlify via **Domains → vanwaet.be → DNS settings → Add new record**:
   - **Record type**: zoals Resend toont (`MX` of `TXT`)
   - **Name**: enkel het deel vóór `.vanwaet.be`, dus `send`, `resend._domainkey` of `_dmarc`. Netlify vult `.vanwaet.be` zelf aan.
   - **Value**: kopieer exact uit Resend. Bij het `MX`-record vul je de **Priority** apart in (meestal `10`).

   Klik daarna in Resend op **Verify**. Dat kan tot een uur duren.
3. Maak in Resend een nieuwe **API key** aan (*Sending access*, domein `vanwaet.be`).
4. Ga in Supabase naar **Authentication → Emails → SMTP Settings** en zet *Enable Custom SMTP* aan:
   - Sender email `zee@vanwaet.be`, sender name `Appartement aan zee`
   - Host `smtp.resend.com`, port `465`, username `resend`, password = de nieuwe Resend API key
5. Optioneel: onder **Emails → Templates → Reset Password** het onderwerp en de tekst in het Nederlands zetten, bv. onderwerp *Nieuw paswoord voor het appartement aan zee*.

### Stap 6: jezelf beheerder maken (±5 min)

1. Ga in Supabase naar **Authentication → Users → Add user → Create new user**. Vul je e-mailadres en een paswoord in en vink **Auto Confirm User** aan.
2. Voer in de **SQL Editor** uit (met jouw adres):
   ```sql
   update public.profiles
      set is_admin = true, active = true, must_change_password = false,
          name = 'Denis', party = 'mieke-denis'
    where email = 'jouw@email.be';
   ```
3. Log in op `https://zee.vanwaet.be` (of nog op het Netlify-adres). Je ziet de kalender en het tabblad **Beheer**.

### Stap 7: WhatsApp en beheer (Edge Function, ±15 min)

1. Ga in Supabase naar **Edge Functions → Deploy a new function → Via Editor**. Naam: **`egmont`**. Plak de inhoud van `supabase/functions/egmont/index.ts` en klik *Deploy*. Zet daarna bij de functie onder *Details* **Verify JWT with legacy secret** (of *Enforce JWT*) **uit**. De functie controleert zelf wie haar aanroept.
2. Vul bij **Edge Functions → Secrets** in:
   - `WEBHOOK_SECRET`: een lange willekeurige tekst die je zelf verzint (bv. 40 tekens uit een paswoordgenerator)
   - `SITE_URL`: `https://zee.vanwaet.be`
   - `WHATSAPP_PROVIDER`: eerst `none`, na de test in stap 9 `callmebot`
3. Ga naar **Database → Webhooks** (eerst eventueel *Enable webhooks*) → **Create a new hook**:
   - Naam `whatsapp`, tabel **`messages`**, gebeurtenis **Insert**
   - Type **Supabase Edge Functions**, functie `egmont`, methode POST
   - HTTP-header toevoegen: `x-webhook-secret` = dezelfde tekst als `WEBHOOK_SECRET`
4. Test in **Beheer**: maak een testgebruiker aan met een tweede e-mailadres. Je krijgt een tijdelijk paswoord te zien. Werkt dat, dan werkt de functie. Verwijder de testgebruiker daarna weer.

### Stap 8: wakker houden (1 min)

Een gratis Supabase-project pauzeert na een week zonder bezoek. Ga op GitHub bij de repository naar **Actions** en zet workflows aan als GitHub dat vraagt. Kies **Supabase wakker houden → Run workflow**. Het vinkje moet groen worden. Daarna loopt de taak vanzelf elke drie dagen.

### Stap 9: WhatsApp aanzetten (±5 min voor jou, daarna per familielid)

1. Stuur zelf vanaf je gsm via WhatsApp `I allow callmebot to send me messages` naar het CallMeBot-nummer (zie **callmebot.com** → *WhatsApp* voor het actuele nummer). Je krijgt een API-sleutel terug.
2. Vul op de site bij **Profiel** je gsm-nummer (`+32…`) en die sleutel in.
3. Zet in Supabase het secret `WHATSAPP_PROVIDER` op `callmebot`.
4. Klik in **Beheer** op **Testbericht versturen**. Dat gaat naar iedereen behalve jezelf. Vraag daarom één familielid om eerst stap 1–2 te doen, of laat een tweede account van jezelf het bericht sturen.

### Stap 10: de familie toegang geven

Maak per persoon een account aan in **Beheer → Toegang geven**: naam, e-mailadres en partij (Celine & Matthias, Nadine & Johan, Mieke & Denis, Nicolas & Jef, Stefanie & Jonas, Mathis). Stuur elk de gegevens die op het scherm verschijnen, met dit bericht:

> Hallo! Je kan nu het appartement reserveren op https://zee.vanwaet.be
> Log in met je e-mailadres en dit tijdelijk paswoord: …
> Je kiest daarna zelf een paswoord. Wil je WhatsApp-meldingen? Volg de uitleg bij *Profiel*.

### Eindcontrole

- [ ] `https://zee.vanwaet.be` toont het inlogscherm met een slotje (HTTPS).
- [ ] Een familielid kan inloggen, moet een eigen paswoord kiezen en kan voor de eigen partij reserveren, maar niet voor een andere partij of EXTERNAL.
- [ ] Een overlappende reservatie wordt geweigerd.
- [ ] Een reservatie en een chatbericht komen in de chat **en** via WhatsApp bij de anderen.
- [ ] *Paswoord vergeten?* stuurt een mail van `zee@vanwaet.be`, en de link laat een nieuw paswoord kiezen.
- [ ] De GitHub-taak *Supabase wakker houden* staat op groen.
- [ ] Verwijder in Supabase bij **Redirect URLs** het tijdelijke Netlify-adres.

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
- Domein `vanwaet.be` via Netlify: ±10–15 euro per jaar
