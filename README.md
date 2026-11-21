# TankWars NextGen

Artillerie-Action im 2.5D-Diorama – Nachfolger des DOS-Klassikers **Tank Wars**.
Goldene Stunde, Bloom, Tilt-Shift, Partikel-Explosionen, zerstörbares Gelände, Waffen-Depot,
4 Bot-Persönlichkeiten (*Mr. Stupid*, *Lobber*, *Rifleman*, *Windmaster*) und Mehrspieler für bis zu 10 Kommandanten.
Per Schalter lässt sich jederzeit auf **320×200-VGA-Retro-Grafik** umschalten.

## Online spielen – ohne Server

Der Multiplayer ist direkt in die App eingebaut (WebRTC über PeerJS):

1. **Raum erstellen** → du bekommst einen 4-stelligen **Raum-Code**.
2. Mitspieler geben den Code unter **Beitreten** ein.
3. Der Host wählt die Gesamtzahl der Kommandanten (Rest füllen Bots auf) und startet das Match.

Der Browser des Hosts berechnet das Spiel, alle anderen verbinden sich direkt mit ihm. Es muss kein eigener
Server betrieben werden; für den Verbindungsaufbau wird der öffentliche PeerJS-Vermittlungsdienst genutzt.

## Steuerung

| Aktion | Maus / Touch | Tastatur |
| --- | --- | --- |
| Winkel | Regler / ± | ← → (Shift = ×5) |
| Kraft | Regler / ± | ↑ ↓ (Shift = ×5) |
| Waffe | Karte antippen | Q / E |
| Feuer | FEUER-Taste | Leertaste / Enter |

Die gepunktete Linie zeigt die Flugbahn deines nächsten Schusses (inkl. Wind).

## Entwicklung

```bash
npm install
npm run dev        # Entwicklungsserver auf http://localhost:5173
npm run build      # Produktions-Build nach client/dist
```

## Deployment

Jeder Push auf `main` baut den Client und veröffentlicht ihn über die GitHub Action
(`.github/workflows/deploy.yml`) auf GitHub Pages. In den Repo-Einstellungen muss unter
*Settings → Pages* als Quelle **GitHub Actions** gewählt sein.

Die App ist als PWA vorbereitet: Auf dem Handy über „Zum Home-Bildschirm“ hinzufügen, dann startet sie
im Vollbild ohne Browser-Leisten.
