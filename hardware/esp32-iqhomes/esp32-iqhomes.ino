/*
 * IQHomes – ESP32 node
 * ---------------------------------------------------------------
 * Makes a real LED (or a relay module) behave like a light on the IQHomes dashboard.
 *   - Dashboard / voice changes the light  → the LED follows instantly (brightness via PWM)
 *   - Press the physical button            → the light toggles on every open screen
 *   - Sends its chip temperature + Wi-Fi signal every 5s (shown on the device card)
 *
 * Wiring (ESP32 DevKit):
 *   GPIO 2  → LED (+ 220Ω resistor) → GND     (GPIO 2 is also the on-board blue LED)
 *             or the IN pin of a 5V relay module to switch a real lamp
 *   GPIO 0  → the on-board BOOT button (no wiring needed), or any push button to GND
 *
 * Libraries (Arduino IDE → Library Manager):
 *   - "WebSockets" by Markus Sattler
 *   - "ArduinoJson" by Benoit Blanchon (v7)
 * Board: "ESP32 Dev Module" (install "esp32 by Espressif" in Boards Manager)
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ---------- Fill these in ----------
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_IP     = "192.168.0.82";   // the computer running `npm run dev`
const uint16_t SERVER_PORT = 4000;
const char* HW_TOKEN      = "PASTE_TOKEN_FROM_SERVER_LOG";
const char* DEVICE_ID     = "living-lamp";    // which dashboard device this board controls
// -----------------------------------

const int LED_PIN    = 2;
const int BUTTON_PIN = 0;
const bool RELAY_MODE = false; // true = plain on/off (relay), false = dimmable LED

WebSocketsClient ws;
bool lightOn = false;
int brightness = 100;
unsigned long lastTelemetry = 0;
bool lastButton = HIGH;
unsigned long lastPress = 0;

void applyLight() {
  if (RELAY_MODE) {
    digitalWrite(LED_PIN, lightOn ? HIGH : LOW);
  } else {
    analogWrite(LED_PIN, lightOn ? map(brightness, 0, 100, 0, 255) : 0);
  }
}

void send(JsonDocument& doc) {
  String out;
  serializeJson(doc, out);
  ws.sendTXT(out);
}

void onSocket(WStype_t type, uint8_t* payload, size_t length) {
  if (type == WStype_CONNECTED) {
    Serial.println("Connected to IQHomes");
    JsonDocument hello;
    hello["type"] = "hello";
    hello["device"] = DEVICE_ID;
    hello["fw"] = "esp32-1.0";
    send(hello);
  } else if (type == WStype_DISCONNECTED) {
    Serial.println("Disconnected, retrying…");
  } else if (type == WStype_TEXT) {
    JsonDocument msg;
    if (deserializeJson(msg, payload, length)) return;
    if (msg["type"] == "state") {
      lightOn = msg["on"] | false;
      brightness = msg["brightness"] | 100;
      applyLight();
      Serial.printf("Light %s at %d%%\n", lightOn ? "ON" : "OFF", brightness);
    } else if (msg["type"] == "error") {
      Serial.printf("Server error: %s\n", (const char*)msg["error"]);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Joining Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf("\nIP: %s\n", WiFi.localIP().toString().c_str());

  String path = String("/hardware?token=") + HW_TOKEN;
  ws.begin(SERVER_IP, SERVER_PORT, path.c_str());
  ws.onEvent(onSocket);
  ws.setReconnectInterval(3000);
  ws.enableHeartbeat(10000, 3000, 2);
}

void loop() {
  ws.loop();

  // Physical button (debounced): ask the server to toggle, it will echo the new state back.
  bool b = digitalRead(BUTTON_PIN);
  if (b == LOW && lastButton == HIGH && millis() - lastPress > 250) {
    lastPress = millis();
    JsonDocument press;
    press["type"] = "button";
    send(press);
  }
  lastButton = b;

  // Telemetry every 5s (also keeps the board marked "online").
  if (millis() - lastTelemetry > 5000 && ws.isConnected()) {
    lastTelemetry = millis();
    JsonDocument t;
    t["type"] = "telemetry";
    t["tempC"] = round(temperatureRead() * 10) / 10.0;
    t["rssi"] = WiFi.RSSI();
    send(t);
  }
}
