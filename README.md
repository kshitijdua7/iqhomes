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
| 🏠 **Hubspace (Home Depot) devices** | Sign in with your Hubspace account and add your Hubspace switches and lights. Nova controls them (*"Hey Nova, turn on my room light"*), and flipping them on the wall or in the Hubspace app syncs back. 🚧 *New and in active testing.* |
| 🔘 **Smart switches (TP-Link Kasa)** | Add your real Kasa wall switches and plugs from the app. IQHomes finds them on your Wi-Fi, you name them, and Nova controls them immediately (*"Hey Nova, turn on my room light"*). Encrypted local control (KLAP), with no cloud round trip. 🚧 *New and in active testing.* |
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
