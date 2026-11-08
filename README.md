# 🏠 IQHomes

[![CI](https://github.com/kshitijdua7/iqhomes/actions/workflows/ci.yml/badge.svg)](https://github.com/kshitijdua7/iqhomes/actions/workflows/ci.yml)

**A real-time smart home dashboard with "Nova", an Alexa-style voice assistant.**

Talk to your house: *"Hey Nova, dim the living room to 30% and close the blinds"*, and every light, blind and screen updates instantly, on every device that has the dashboard open.

Built by **Kshitij Dua** · React · TypeScript · Node.js · Socket.io · Tailwind CSS

---

## ✨ Features

| | |
|---|---|
| 🎙️ **Voice assistant** | Tap the orb and speak, or turn on **wake word** mode and just say *"Hey Nova…"*. Nova talks back. |
| 🧠 **Natural language** | Understands multi-step commands, number words, colours and feelings (*"I'm cold"* raises the heat). Remembers context between clauses. |
| 🤖 **AI brain** | When the built-in parser doesn't understand, Nova asks Claude, so any phrasing works and follow-ups like *"a bit more"* make sense. Optional (needs `ANTHROPIC_API_KEY`), and every AI action still goes through the normal permission checks. |
| ⏲️ **Timers, alarms & reminders** | *"Set a timer for 10 minutes for pasta"*, *"Wake me up at 7"* (also runs Good Morning), *"Remind me to take out the garbage at 8"*. Countdown rings, a chime and a spoken alert on every screen, plus a push notification. |
| ☀️ **Weather & daily briefing** | Real Oakville weather (Open-Meteo, no key). *"Good morning"* gives the forecast, today's reminders and the house status. |
| ✨ **Routines by voice** | *"When I say 'I'm home', turn on the porch light and set the heat to 22"*: Nova creates the routine itself. |
| 📢 **Announcements** | *"Announce dinner is ready"* chimes and speaks on every screen. |
| 🇫🇷 **French** | EN/FR switch for voice and replies. Common French commands work offline, and the AI brain handles any French. |
| ⚡ **Real-time sync** | WebSockets push every change to every open screen. Open it on your laptop and phone side by side and watch them mirror each other. |
| 🎬 **Scenes** | Movie Night, Good Morning, Good Night, Away, Focus: one tap or one sentence changes many devices. |
| 🌡️ **Climate simulation** | The indoor temperature drifts toward the thermostat target over time, like a real house. |
| 🔌 **Live energy + Ontario time-of-use** | Live watts and the current TOU price (off-, mid- and on-peak), a colour-coded timeline for today, tips like *"run the dishwasher after 7 pm to save 38%"*, and daily and weekly usage history. |
| 🏡 **3D floor plan** | A tilted 3D model of the house. Rooms glow in their lights' real colours, blinds move, and triggered sensors pulse red. Tap a room to filter. |
| 🖥️ **Wall display mode** | A full-screen view for a tablet on the wall, like an Echo Show: giant clock, weather, scenes, quick controls and the Nova orb. |
| 🛡️ **Security system** | Arm Home or Away, motion and door/window sensors, simulated cameras, and a flashing intruder alert on every screen. |
| 🔥 **Safety sensors** | Smoke, CO and water-leak alerts that Nova announces out loud. Smoke and CO turn on every light, open the blinds and switch off the heating. |
| ⚙️ **Automations & schedules** | A drag-and-drop IF / AND / THEN builder (*"IF sunset AND nobody home THEN close blinds"*) with real sunrise and sunset times, or by voice: *"turn on the porch light at sunset every day"*. |
| 🎭 **Presence simulation** | While you're away, lights turn on and off in the evening so the house looks lived in. |
| 🧰 **Device manager** | Add, rename, move and delete devices and rooms from the app. |
| 🚗 **Garage door** | Open, close and *"is the garage open?"*, with tap-to-confirm before opening. Never available to guests. |
| 🔌 **Real hardware** | An **ESP32** or a **Shelly/Tasmota smart plug** becomes a dashboard device. Voice and app control the real thing, its physical button updates every screen, and real watts flow into the energy monitor. |
| 🏠 **Hubspace (Home Depot) devices** | Sign in with your Hubspace account and add your Hubspace switches and lights. Nova controls them (*"Hey Nova, turn on my room light"*), and flipping them on the wall or in the Hubspace app syncs back. 🚧 *New and in active testing.* |
| 🔘 **Smart switches (TP-Link Kasa)** | Add your real Kasa wall switches and plugs from the app. IQHomes finds them on your Wi-Fi, you name them, and Nova controls them immediately (*"Hey Nova, turn on my room light"*). Encrypted local control (KLAP), with no cloud round trip. 🚧 *New and in active testing.* |
| 👥 **Roles & guest passes** | Owner, family and guest accounts with PIN sign-in. The owner issues **time-limited guest passes** for chosen rooms, which expire or can be revoked instantly. Enforced on the server, including voice commands. |
| 📲 **Installable app + push** | A PWA you can add to your home screen, with push alerts like *"Front door unlocked by Alex"*, a reminder if the door is **still unlocked after 10 minutes** (with a one-tap **Lock it** action), and alerts when hardware goes offline. |
| 📜 **Activity log** | Every change is recorded with who made it and how: app, voice, scene, hardware or system. |
| 💾 **Persistence** | JSON files by default, or **PostgreSQL** when `DATABASE_URL` is set. |
| 📡 **MQTT + Home Assistant** | Set `MQTT_URL` and every device publishes its state and accepts commands over MQTT, and shows up in Home Assistant automatically. |
| 🧪 **Public demo mode** | `DEMO_MODE=1`: one-tap logins, account changes locked, and the house resets every hour, so recruiters can try it from a link. See [DEPLOY.md](DEPLOY.md). |
| ✅ **CI** | GitHub Actions type-checks and tests the server, builds the web app and builds the Docker image on every push. |
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
