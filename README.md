# TankWars NextGen

Moderner 2.5D-Miniatur-Diorama-Klon des 90er-Jahre-DOS-Klassikers **Tank Wars** – mit Live-Umschalter auf 320×200-VGA-Retro-Grafik, 4 klassischen Bots (*Mr. Stupid*, *Lobber*, *Rifleman*, *Windmaster*), Waffen-Shop und 10-Spieler-Multiplayer (Klassisch & Simultan-Chaos).

## Schnellstart (Lokal)

```bash
npm install
```

- **Client starten (Browser & Handy im WLAN):**
  ```bash
  npm run dev:client
  ```
- **Multiplayer-Server starten:**
  ```bash
  npm run dev:server
  ```

## Deployment

- **Multiplayer-Server (Docker / NAS):**
  ```bash
  docker compose up -d --build
  ```
- **Client-Build (GitHub Pages / Web Station):**
  ```bash
  npm run build --workspace=client
  ```
  Der fertige statische Build liegt anschließend in `client/dist/`.
