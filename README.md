# 🏠 Nova Home

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
| 📜 **Activity log** | Every change is recorded with its source: app, voice, scene or system. |
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

You need **Node.js 20+** ([download](https://nodejs.org)). Voice works best in **Chrome or Edge**.

```bash
npm run setup     # installs everything (first time only)
npm run dev       # starts the server and the dashboard together
```

Open **http://localhost:5173**. The first time you tap the orb, allow microphone access.

Other commands:

```bash
npm test          # runs the assistant + simulator tests
npm run build     # builds the dashboard for production
npm start         # serves the built dashboard + API from one server on :4000
```

---

## 🏗️ How it works

```
 Browser (React)                         Node.js server
┌──────────────────────┐   WebSocket    ┌─────────────────────────────┐
│ Dashboard UI         │ ─────────────▶ │ Socket.io event handlers    │
│ Voice (Web Speech)   │ ◀───────────── │   device:update / scene:run │
│ Optimistic updates   │  state / tick  │   assistant:ask             │
└──────────────────────┘                │                             │
                                        │ assistant.ts  (NLP parser)  │
                                        │ home.ts       (simulator)   │
                                        │ data/state.json (persist)   │
                                        └─────────────────────────────┘
```

1. **You speak.** The browser's Web Speech API turns your voice into text.
2. **The text goes to the server** over a WebSocket (`assistant:ask`).
3. **`assistant.ts` parses it.** It splits the sentence into clauses, then finds the action, room, device and number in each one, and builds a list of device changes ("patches").
4. **`home.ts` applies the patches.** Values are validated and clamped, power use is recalculated and the change is logged.
5. **The server broadcasts the new state** to every connected screen, and Nova speaks the reply.
6. **Every 2 seconds** the simulator ticks: temperatures drift and the energy chart updates.

### Project structure
```
server/
  src/types.ts       shared data types
  src/home.ts        devices, scenes, validation, simulator
  src/assistant.ts   natural-language command parser
  src/index.ts       Express + Socket.io server
  test/              Vitest tests
web/
  src/useHome.ts     WebSocket connection + optimistic updates
  src/useVoice.ts    speech recognition, wake word, text-to-speech
  src/components/    Assistant orb, device cards, climate, energy, activity
```

### Design decisions worth talking about in an interview
- **Rule-based NLP instead of an AI API:** instant, free and works offline, and the parser is fully unit-tested. An LLM fallback for unusual phrasing is on the roadmap.
- **Server is the single source of truth:** the UI updates optimistically for snappiness, and the server's broadcast keeps every client consistent.
- **Never trust the client:** every incoming change goes through a whitelist of fields with clamping (`SANITIZERS` in `home.ts`).
- **Patches as the universal language:** the UI, voice and scenes all produce the same `{ id, changes }` objects, so there's one code path for applying changes.

---

## 🗺️ Roadmap
- [ ] 3D interactive floor plan (Three.js)
- [ ] Visual automation builder ("IF sunset THEN close blinds")
- [ ] Real sunrise/sunset and weather triggers
- [ ] Away-mode presence simulation
- [ ] User accounts + PostgreSQL
- [ ] Public demo mode that resets every hour
- [ ] GitHub Actions CI
- [ ] Control a real device (ESP32 / smart plug)
