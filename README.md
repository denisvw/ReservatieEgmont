# Reservaties appartement aan zee

Kleine webapp om het appartement te reserveren binnen de familie, met externe verhuur apart aangeduid.

**Functies**

- Inloggen met e-mailadres + paswoord. Er is geen zelfregistratie: de beheerder maakt accounts aan en geeft een tijdelijk paswoord door. Bij de eerste login kiest de gebruiker een eigen paswoord.
- Maandkalender met alle reservaties in een eigen kleur per partij. Externe verhuur (**EXTERNAL**) is donker en gestreept, zodat het duidelijk verschilt van de familie.
- Partijen: Celine & Matthias, Nadine & Johan, Mieke & Denis, Nicolas & Jef en EXTERNAL.
  - Een familielid kan enkel voor de eigen partij reserveren, wijzigen of annuleren.
  - Externe verhuur kan alleen de beheerder ingeven. De beheerder kan ook alles wijzigen.
  - Overlappende reservaties worden geweigerd. De vertrekdag mag wel de aankomstdag van de volgende zijn.
- Chat voor iedereen. Elk bericht gaat ook via WhatsApp naar de anderen.
- Elke nieuwe, gewijzigde of geannuleerde reservatie verschijnt in de chat en wordt via WhatsApp gedeeld.
- Beheerpagina: gebruikers aanmaken, aan een partij koppelen, beheerder maken, deactiveren, paswoord resetten en een WhatsApp-test versturen.

## Lokaal starten

```bash
npm install
ADMIN_EMAIL=jij@voorbeeld.be ADMIN_PASSWORD=geheim123 ADMIN_NAME=Denis ADMIN_PARTY=mieke-denis npm start
# → http://localhost:3000
```

Alle gegevens staan in één SQLite-bestand (`data/reservaties.db`, of in `DATA_DIR`). Een back-up maken is dat bestand kopiëren.

## Online zetten: een eigen domeinnaam is niet nodig

Een hostingdienst geeft je gratis een adres zoals `https://appartement-zee.fly.dev`. Wil je later toch iets als `zee.vanwaet.be`, dan koop je die naam (± €10/jaar) en koppel je die aan dezelfde site.

### Aanbevolen: Fly.io (± €0–3/maand)

1. Maak een account op fly.io en installeer `flyctl`.
2. Pas in `fly.toml` de `app`-naam aan (die naam bepaalt het adres).
3. Voer uit:

```bash
fly launch --no-deploy --copy-config
fly volumes create reservaties_data --size 1 --region ams
fly secrets set ADMIN_EMAIL=jij@voorbeeld.be ADMIN_PASSWORD='sterk-paswoord' ADMIN_NAME=Denis ADMIN_PARTY=mieke-denis SITE_URL=https://<app>.fly.dev
fly deploy
```

Andere opties die met de `Dockerfile` werken: Render of Railway (voorzie wel een *persistent disk/volume* voor `/data`), of een Synology NAS of Raspberry Pi thuis.

## WhatsApp

Stel `WHATSAPP_PROVIDER` in:

| Provider | Kost | Hoe |
|---|---|---|
| `none` | – | Berichten komen alleen in de serverlog. Handig om te testen. |
| `callmebot` | gratis | Elk familielid stuurt één keer een WhatsApp naar CallMeBot en krijgt een persoonlijke sleutel. Die vult hij of zij met het gsm-nummer in op de pagina **Profiel**. De uitleg staat ook in de app. |
| `meta` | gratis tot ± 1000 gesprekken/maand | Officiële WhatsApp Cloud API. Je hebt een Meta Business-account, een apart telefoonnummer en een goedgekeurde berichttemplate nodig. Stel `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` en `WHATSAPP_TEMPLATE` in. |

> Opgelet: geen enkele officiële WhatsApp-API laat toe te posten in een bestaande WhatsApp-groep. Iedereen krijgt de melding dus persoonlijk. Wie de actie zelf deed, krijgt geen melding.

## Omgevingsvariabelen

Zie `.env.example`.
