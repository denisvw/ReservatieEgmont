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
    functions/egmont/      e-mailmeldingen (en optioneel WhatsApp) en gebruikers aanmaken
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
- **Meldingen per e-mail**: elke nieuwe, gewijzigde of geannuleerde reservatie komt in de chat en gaat per mail naar alle anderen, met onderaan een overzicht van alle reservaties voor de komende 12 maanden. Niemand moet daarvoor iets instellen. Wie ook bij elk chatbericht een mail wil, of helemaal geen mail, kiest dat zelf op **Profiel**. WhatsApp via CallMeBot kan er optioneel bij.
- **Chat** om berichten te delen met de hele familie.
- **Kalender (jaaroverzicht)**: alle maanden van een jaar in één oogopslag, met verlofdagen, de komende periodes en het aantal nachten per partij. Je reserveert door de aankomst- en vertrekdag aan te klikken. De oude maandkalender staat verborgen in `site/index.html` en komt terug door daar `hidden` weg te halen.
- **Beheer**: gebruikers aanmaken, aan een partij koppelen, beheerder maken, (de)activeren, een nieuw tijdelijk paswoord geven of verwijderen, en een testmail sturen.

---

## Stappenplan om alles operationeel te maken

Totaal ±1,5 uur. Een pas gekocht domein heeft soms een paar uur nodig voor het overal werkt. Doe intussen gerust de andere stappen met het Netlify-adres.

De site komt op **`https://zee.vanwaetermeulen.be`**. Zo blijft `vanwaetermeulen.be` zelf vrij voor later, bv. een familiesite of e-mailadressen. Wil je toch de site op `vanwaetermeulen.be` zelf, zie de opmerking bij stap 4.

**Wat je nodig hebt:** je GitHub- en Netlify-account (dezelfde als voor Gilles' world), je Combell-account met het domein `vanwaetermeulen.be`, en je Resend-account (dat van Gilles' world).

Het domein staat bij **Combell**, maar het DNS-beheer doet **Netlify**. Zo werkt alles verder zoals bij Gilles' world: de site, het certificaat en de mailrecords regel je in Netlify. Combell stuurt je enkel nog de jaarlijkse factuur.

### Stap 1: het domein `vanwaetermeulen.be` van Combell naar Netlify DNS laten wijzen (±10 min, daarna wachten)

**1a. Het domein toevoegen in Netlify**

1. Log in op **app.netlify.com**, in hetzelfde team als Gilles' world. Klik links in het teammenu op **DNS** (in sommige versies **Domains**) → **Add domain** (of *Add or register domain*).
2. Typ `vanwaetermeulen.be` en klik *Verify*. Netlify ziet dat het domein al bestaat. Bevestig dat het van jou is (*Add domain* / *Yes, add domain*).
3. Kies **Set up Netlify DNS** en klik door. Records die Netlify voorstelt, mag je overslaan: er staat nog niets op het domein.
4. Op het laatste scherm toont Netlify **vier nameservers**, bv. `dns1.p05.nsone.net` tot `dns4.p05.nsone.net`. Laat dat scherm open of noteer ze. Je vindt ze later ook terug bij **DNS → vanwaetermeulen.be**.

**1b. De nameservers invullen bij Combell**

1. Log in op **my.combell.com** en open bij je producten het domein `vanwaetermeulen.be`.
2. Staat **DNSSEC** aan, zet het dan eerst **uit**. Met DNSSEC aan kan de overstap naar Netlify mislukken.
3. Kies **Naamservers** (ook *Nameservers* of *DNS-servers wijzigen*) → **Eigen/aangepaste naamservers**.
4. Vervang de naamservers van Combell door de vier van Netlify, één per regel, en bewaar.
5. Wacht. Na enkele minuten tot hoogstens een paar uur staat in Netlify bij **DNS → vanwaetermeulen.be** dat Netlify DNS actief is. Doe intussen gerust stap 2 en 3.

> Combell kan waarschuwen dat de DNS-instellingen bij Combell niet meer gebruikt worden. Dat klopt en is de bedoeling: vanaf nu wijzig je DNS-records enkel nog in Netlify.

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
   - **Site URL**: `https://zee.vanwaetermeulen.be`
   - **Redirect URLs**: `https://zee.vanwaetermeulen.be/*`, en tijdelijk ook je Netlify-adres uit stap 3, bv. `https://appartement-zee.netlify.app/*`

### Stap 3: de website op Netlify (±10 min)

1. Maak een **nieuw project** in Netlify, in hetzelfde team als Gilles' world. Gilles' world blijft zijn eigen project. Kies op **app.netlify.com** *Add new project → Import an existing project → GitHub* en kies `ReservatieEgmont`. Vraagt Netlify toegang, voeg dan die repository toe aan de GitHub-koppeling.
2. **Branch to deploy**: `main`.
3. **Publish directory**: `site`. Laat *Build command* leeg.
4. Klik *Deploy*. Onder *Project configuration → Change project name* noem je hem `appartement-zee`. Je krijgt dan het adres `https://appartement-zee.netlify.app`.
5. Open dat adres: je ziet het inlogscherm. Inloggen lukt pas na stap 6.

### Stap 4: `zee.vanwaetermeulen.be` koppelen aan de site (±2 min)

1. Open in Netlify het project `appartement-zee` → **Domain management → Add a domain**.
2. Typ `zee.vanwaetermeulen.be` en bevestig. Omdat `vanwaetermeulen.be` al bij Netlify staat, maakt Netlify het DNS-record zelf aan. Je hoeft niets in te vullen.
3. Wacht tot er een groen vinkje en **HTTPS: certificate active** staan (meestal binnen enkele minuten, bij een pas gekocht domein soms een paar uur). Netlify stuurt bezoekers automatisch naar `https://`.

> **Liever de site op `vanwaetermeulen.be` zelf?** Voeg dan in stap 4 `vanwaetermeulen.be` toe in plaats van `zee.vanwaetermeulen.be`. Netlify voegt `www.vanwaetermeulen.be` er vanzelf bij. Vervang overal in dit stappenplan `zee.vanwaetermeulen.be` door `vanwaetermeulen.be`.

### Stap 5: e-mail via Resend (meldingen en *Paswoord vergeten*, ±10 min)

1. Log in op **resend.com** met je bestaande account (dat van Gilles' world). Kies **Domains → Add domain** → `vanwaetermeulen.be`, regio **Ireland (eu-west-1)**.
2. Resend toont 3 à 4 DNS-records: een `MX` en een `TXT` op `send`, een `TXT` op `resend._domainkey` en eventueel een `TXT` `_dmarc`. Zet ze in Netlify via **DNS → vanwaetermeulen.be → Add new record**:
   - **Record type**: zoals Resend toont (`MX` of `TXT`)
   - **Name**: enkel het deel vóór `.vanwaetermeulen.be`, dus `send`, `resend._domainkey` of `_dmarc`. Netlify vult `.vanwaetermeulen.be` zelf aan.
   - **Value**: kopieer exact uit Resend. Bij het `MX`-record vul je de **Priority** apart in (meestal `10`).

   Klik daarna in Resend op **Verify**. Dat kan tot een uur duren.
3. Maak in Resend een nieuwe **API key** aan (*Sending access*, domein `vanwaetermeulen.be`).
4. Ga in Supabase naar **Authentication → Emails → SMTP Settings** en zet *Enable Custom SMTP* aan:
   - Sender email `zee@vanwaetermeulen.be`, sender name `Appartement aan zee`
   - Host `smtp.resend.com`, port `465`, username `resend`, password = de nieuwe Resend API key
5. Bewaar dezelfde API key ook bij **Edge Functions → Secrets** (zie stap 7) als `RESEND_API_KEY`. Daarmee verstuurt de site de meldingen.
6. Optioneel: onder **Emails → Templates → Reset Password** het onderwerp en de tekst in het Nederlands zetten, bv. onderwerp *Nieuw paswoord voor het appartement aan zee*.

### Stap 6: jezelf beheerder maken (±5 min)

1. Ga in Supabase naar **Authentication → Users → Add user → Create new user**. Vul je e-mailadres en een paswoord in en vink **Auto Confirm User** aan.
2. Voer in de **SQL Editor** uit (met jouw adres):
   ```sql
   update public.profiles
      set is_admin = true, active = true, must_change_password = false,
          name = 'Denis', party = 'mieke-denis'
    where email = 'jouw@email.be';
   ```
3. Log in op `https://zee.vanwaetermeulen.be` (of nog op het Netlify-adres). Je ziet de kalender en het tabblad **Beheer**.

### Stap 7: meldingen en beheer (Edge Function, ±15 min)

1. Ga in Supabase naar **Edge Functions → Deploy a new function → Via Editor**. Naam: **`egmont`**. Plak de inhoud van `supabase/functions/egmont/index.ts` en klik *Deploy*. Zet daarna bij de functie onder *Details* **Verify JWT with legacy secret** (of *Enforce JWT*) **uit**. De functie controleert zelf wie haar aanroept.
2. Vul bij **Edge Functions → Secrets** in:
   - `WEBHOOK_SECRET`: een lange willekeurige tekst die je zelf verzint (bv. 40 tekens uit een paswoordgenerator)
   - `SITE_URL`: `https://zee.vanwaetermeulen.be`
   - `RESEND_API_KEY`: de Resend API key uit stap 5
   - `MAIL_FROM`: `Appartement aan zee <zee@vanwaetermeulen.be>`
   - `WHATSAPP_PROVIDER`: `none` (of `callmebot`, zie stap 9)
3. Ga naar **Database → Webhooks** (eerst eventueel *Enable webhooks*) → **Create a new hook**:
   - Naam `meldingen`, tabel **`messages`**, gebeurtenis **Insert**
   - Type **Supabase Edge Functions**, functie `egmont`, methode POST
   - HTTP-header toevoegen: `x-webhook-secret` = dezelfde tekst als `WEBHOOK_SECRET`
4. Test in **Beheer → Testmail naar mezelf**. Je krijgt binnen een minuut een mail. Kijk ook in je spam.
5. Test in **Beheer**: maak een testgebruiker aan met een tweede e-mailadres. Je krijgt een tijdelijk paswoord te zien. Werkt dat, dan werkt de functie. Verwijder de testgebruiker daarna weer.

### Stap 8: wakker houden (1 min)

Een gratis Supabase-project pauzeert na een week zonder bezoek. Ga op GitHub bij de repository naar **Actions** en zet workflows aan als GitHub dat vraagt. Kies **Supabase wakker houden → Run workflow**. Het vinkje moet groen worden. Daarna loopt de taak vanzelf elke drie dagen.

### Stap 9 (optioneel): WhatsApp

De mails volstaan. Wil iemand de meldingen toch ook via WhatsApp, zie het hoofdstuk **WhatsApp (optioneel)** onderaan.

### Stap 10: de familie toegang geven

Maak per persoon een account aan in **Beheer → Toegang geven**: naam, e-mailadres en partij (Celine & Matthias, Nadine & Johan, Mieke & Denis, Nicolas & Jef, Stefanie & Jonas, Mathis). Stuur elk de gegevens die op het scherm verschijnen, met dit bericht:

> Hallo! Je kan nu het appartement reserveren op https://zee.vanwaetermeulen.be
> Log in met je e-mailadres en dit tijdelijk paswoord: …
> Je kiest daarna zelf een paswoord. Bij elke wijziging in de kalender krijg je een mail. Bij *Profiel* kan je dat aanpassen.

### Eindcontrole

- [ ] `https://zee.vanwaetermeulen.be` toont het inlogscherm met een slotje (HTTPS).
- [ ] Een familielid kan inloggen, moet een eigen paswoord kiezen en kan voor de eigen partij reserveren, maar niet voor een andere partij of EXTERNAL.
- [ ] Een overlappende reservatie wordt geweigerd.
- [ ] Een reservatie komt in de chat **en** per mail bij de anderen.
- [ ] *Paswoord vergeten?* stuurt een mail van `zee@vanwaetermeulen.be`, en de link laat een nieuw paswoord kiezen.
- [ ] De GitHub-taak *Supabase wakker houden* staat op groen.
- [ ] Verwijder in Supabase bij **Redirect URLs** het tijdelijke Netlify-adres.

---

## WhatsApp (optioneel)

Geen enkele officiële WhatsApp-dienst laat toe te posten in een bestaande **groep**. Iedereen krijgt de melding dus persoonlijk. Wie de actie zelf deed, krijgt geen melding.

| `WHATSAPP_PROVIDER` | Kost | Hoe |
|---|---|---|
| `none` | – | Er wordt niets verstuurd. Je ziet de berichten in de log van de Edge Function. |
| `callmebot` | gratis | Elk familielid stuurt één keer `I allow callmebot to send me messages` naar het CallMeBot-nummer (zie callmebot.com). Daarna vult hij of zij het gsm-nummer en de ontvangen sleutel in op **Profiel**. De uitleg staat ook in de app. |
| `meta` | gratis tot ± 1000 gesprekken/maand | Officiële WhatsApp Cloud API. Je hebt een Meta Business-account, een apart nummer en een goedgekeurde template met één parameter nodig. Extra secrets: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE`. |

Test met de knop **Testbericht versturen** in Beheer.

## Verlofdagen aanpassen

De kalender en het jaaroverzicht tonen de Vlaamse schoolvakanties (lichtblauw) en de wettelijke feestdagen (★). De data staan onderaan in `supabase/schema.sql`, bij `insert into public.holidays`. Schooljaar 2026–2027 is nagekeken. Wat als *(voorlopig)* gemarkeerd staat, is berekend volgens de vaste regels en moet je nakijken zodra Vlaanderen de officiële kalender publiceert. Een jaar toevoegen of iets verbeteren: pas de lijst aan en voer het hele script opnieuw uit in de SQL Editor.

## Een partij toevoegen of hernoemen

Pas in `supabase/schema.sql` de lijst bij `insert into public.parties` aan en voer het hele script opnieuw uit in de SQL Editor. Er gaat niets verloren. Koppel daarna de mensen aan hun partij in **Beheer**.

## Kosten

- Supabase: gratis (aparte gratis organisatie)
- Netlify: gratis
- Resend: gratis tot 3000 mails per maand (gedeeld met Gilles' world)
- Domein `vanwaetermeulen.be` bij Combell: zie je Combell-factuur (±10–15 euro per jaar). Netlify DNS is gratis.
