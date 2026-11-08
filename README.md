# 🏠 IQHomes

**A real-time smart home dashboard with "Nova", an Alexa-style voice assistant.**

Talk to your house: *"Hey Nova, dim the living room to 30% and close the blinds"*, and every light, blind and screen updates instantly, on every device that has the dashboard open.

Built by **Kshitij Dua** · React · TypeScript · Node.js · Socket.io · Tailwind CSS

---

## ✨ Features

| | |
|---|---|
| 🎙️ **Voice assistant** | Tap the orb and speak, or turn on **wake word** mode and just say *"Hey Nova…"*. Nova talks back. |
| 🧠 **Natural language** | Understands multi-step commands, number words, colours and feelings (*"I'm cold"* raises the heat). Remembers context between clauses. |
| ⚡ **Real-time sync** | WebSockets push every change to every open screen. Open it on your laptop and phone side by side and watch them mirror each other. |
| 🎬 **Scenes** | Movie Night, Good Morning, Good Night, Away, Focus: one tap or one sentence changes many devices. |
| 🌡️ **Climate simulation** | The indoor temperature drifts toward the thermostat target over time, like a real house. |
| 🔌 **Live energy monitor** | Watts, cost per hour and per month (Ontario rate), the biggest power users, and a live chart. |
| 🔌 **Real hardware** | An **ESP32** or a **Shelly/Tasmota smart plug** becomes a dashboard device. Voice and app control the real thing, its physical button updates every screen, and real watts flow into the energy monitor. |
| 👥 **Roles & guest passes** | Owner, family and guest accounts with PIN sign-in. The owner issues **time-limited guest passes** for chosen rooms, which expire or can be revoked instantly. Enforced on the server, including voice commands. |
| 📲 **Installable app + push** | A PWA you can add to your home screen, with push alerts like *"Front door unlocked by Alex"*, a reminder if the door is **still unlocked after 10 minutes** (with a one-tap **Lock it** action), and alerts when hardware goes offline. |
| 📜 **Activity log** | Every change is recorded with who made it and how: app, voice, scene, hardware or system. |
| 💾 **Persistence** | The house state is saved, so it survives a server restart. |
| 📱 **Responsive** | Works on phones; open it from any device on your Wi-Fi. |

### Things you can say
- "Dim the living room to 30% and close the blinds"
- "Turn on the bedroom lights at 40 percent"
- "Make the kitchen lights blue"
- "Set the temperature to twenty two degrees" · "I'm cold" · "Make it cooler"
- "Lock the front door" · "Is the front door locked?"
- "It's movie night" · "Good night" · "I'm leaving"
- "Turn off everything" · "Which lights are on?"
- "How much power are we using?" · "What's the temperature?"
- "Start the coffee maker" · "Volume up" · "Turn on the fan"

---

## 🚀 Run it

```bash
npm run setup   # install everything
npm run dev     # server on :4000, dashboard on http://localhost:5173
npm test        # assistant + permission tests
```

Sign in with the demo PINs: **owner `1234`**, **family `2222`**. Change them from the account menu.

## 👥 Roles

| | Owner | Family | Guest |
|---|:-:|:-:|:-:|
| Lights, blinds, TV, fans, plugs | ✅ | ✅ | only rooms on their pass |
| Locks & thermostat | ✅ | ✅ | ❌ hidden |
| Scenes | ✅ | ✅ | ❌ |
| Energy & full activity log | ✅ | ✅ | ❌ (own actions only) |
| Create / revoke guest passes, hardware setup | ✅ | ❌ | ❌ |

Guests sign in with a 6-digit code, or open the invite link `/?guest=123456`. Passes last 3 hours to 1 week. PINs are hashed with scrypt, and sign-in backs off after 5 wrong attempts.

## 🔌 Real hardware

**Try it with no board:** with the app running, run `npm run fake-esp32` and the Floor Lamp gets a green **REAL · ESP32** badge. Toggle it from the app or by voice and watch the "LED" respond in the terminal. Press ENTER to press its physical button and see every screen update.

**ESP32** (about $8):
1. Open `hardware/esp32-iqhomes/esp32-iqhomes.ino` in the Arduino IDE. Install the **WebSockets** (Markus Sattler) and **ArduinoJson** libraries.
2. Fill in your Wi-Fi, this computer's IP, and the token shown in the server log (or **Real hardware → Connect** in the app).
3. Flash it. The on-board LED (GPIO 2) is now the Floor Lamp, dimmable by voice, and the BOOT button toggles it. Wire a relay module to GPIO 2 to switch a real lamp.

**Smart plug** (Shelly Plus/Gen2+ or any Tasmota plug, controlled locally with no cloud account):
```bash
SHELLY_HOST=192.168.0.50 npm run dev      # or TASMOTA_HOST=…
PLUG_DEVICE=kitchen-coffee                 # which dashboard device it becomes (default)
```
The plug reports its **real power draw** to the energy monitor, and pressing its button syncs back within a few seconds.

## 📲 Install & notifications

Open the dashboard and choose **Install IQHomes app** from the account menu. On iPhone, tap Share, then *Add to Home Screen*. Then turn on notifications from the same menu.

> Push notifications need a secure origin. `localhost` works out of the box. To get them on your phone, serve the app over HTTPS, for example with `npm run build && npm start` behind a tunnel such as `cloudflared tunnel --url http://localhost:4000`.

Settings: `DOOR_REMINDER_MIN` (default 10) controls the "still unlocked" reminder. Keys, PIN hashes and tokens live in `server/data/`, which is git-ignored.

## 🧱 How it works

```
 phone / laptop (PWA) ──Socket.io──┐                 ┌── ESP32  (WebSocket /hardware)
                                   ├── Node server ──┤
 voice "Hey Nova…"  ──────────────┘   auth · rules   └── Shelly / Tasmota plug (local HTTP)
                                      push alerts ──▶ Web Push to every subscribed device
```

