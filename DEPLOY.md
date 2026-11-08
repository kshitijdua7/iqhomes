# Deploying IQHomes

IQHomes runs as one Node server that serves both the dashboard and the API, so it deploys as a single container.

## Public demo on Render (free tier)

1. On [render.com](https://render.com), choose **New → Blueprint** and pick this GitHub repo.
2. Render reads [`render.yaml`](render.yaml) and creates:
   - **iqhomes-demo**: the app, in demo mode (`DEMO_MODE=1`): one-tap logins, account changes locked, and the house resets every hour.
   - **iqhomes-db**: a PostgreSQL database, so the demo keeps working across deploys.
3. Optional: add `ANTHROPIC_API_KEY` in the service's **Environment** tab to turn on Nova's AI brain.
4. Share the `https://iqhomes-demo.onrender.com` link. Because it's HTTPS, push notifications and the install-to-home-screen prompt work on phones too.

> Free Render services sleep when idle, so the first visit after a while can take about 30 seconds to wake up.

## Any Docker host

```bash
docker build -t iqhomes .
docker run -p 4000:4000 -e DEMO_MODE=1 iqhomes          # public demo
docker run -p 4000:4000 -v iqhomes-data:/app/server/data iqhomes   # your own home, saved to a volume
```

## Settings (environment variables)

| Variable | What it does |
|---|---|
| `PORT` | Port to listen on (default `4000`). |
| `DEMO_MODE` | `1` for a public demo: one-tap logins, PIN changes and account linking disabled, resets every `DEMO_RESET_MIN` minutes (default 60). |
| `DATABASE_URL` | Save to PostgreSQL instead of JSON files in `server/data`. |
| `ANTHROPIC_API_KEY` | Turns on Nova's AI brain (Claude). Optional, and costs a small amount per request it handles. |
| `NOVA_AI_MODEL` | Override the AI model (default `claude-opus-5-5`). |
| `MQTT_URL` | Connect to an MQTT broker, e.g. `mqtt://192.168.0.10:1883`. Devices publish to `iqhomes/<id>/state` and accept commands on `iqhomes/<id>/set`, with Home Assistant discovery. |
| `WEATHER_LAT`, `WEATHER_LON`, `WEATHER_PLACE` | Weather location (default Oakville, ON). |
| `TOU_OFF`, `TOU_MID`, `TOU_ON` | Ontario time-of-use rates in ¢/kWh. |
| `DOOR_REMINDER_MIN` | Minutes before the "door still unlocked" reminder (default 10). |
| `SHELLY_HOST` / `TASMOTA_HOST`, `PLUG_DEVICE` | Link a real smart plug. |
| `HARDWARE_TOKEN` | Fixed token for ESP32 boards (otherwise one is generated). |
