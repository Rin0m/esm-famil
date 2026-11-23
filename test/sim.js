// Simuliert 3 Spieler gegen einen laufenden Server (PORT 3999)
const { io } = require("socket.io-client");
const URL = "http://localhost:3999";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = () => io(URL, { forceNew: true });
const emit = (s, ev, d) => new Promise((r) => s.emit(ev, d, r));
const fail = (m) => { console.error("FAIL:", m); process.exit(1); };

(async () => {
  const A = mk(), B = mk(), C = mk();
  const st = { A: null, B: null, C: null };
  A.on("state", (s) => (st.A = s)); B.on("state", (s) => (st.B = s)); C.on("state", (s) => (st.C = s));
  await wait(300);

  const bad = await emit(A, "create", { name: "Rim", playerId: "keyA-secret", lang: "fa", password: "falsch" });
  if (bad.ok) fail("Raum ohne richtiges Passwort erstellt");
  const r = await emit(A, "create", { name: "Rim", playerId: "keyA-secret", lang: "fa", password: "geheim" });
  const rb = await emit(B, "join", { roomId: r.roomId, name: "اهورا", playerId: "keyB-secret" });
  const rc = await emit(C, "join", { roomId: r.roomId.toLowerCase(), name: "Juan", playerId: "keyC-secret" });
  const pA = r.you, pB = rb.you, pC = rc.you;
  await wait(200);
  if (st.C.players.length !== 3) fail("3 Spieler erwartet");
  console.log("Raum", r.roomId, "Spieler:", st.A.players.map((p) => p.name).join(", "));

  // Nicht-Gastgeber darf nichts ändern
  B.emit("settings", { time: 99 }); B.emit("start"); await wait(200);
  if (st.A.settings.time === 99 || st.A.phase !== "lobby") fail("Gast konnte Einstellungen ändern");

  A.emit("settings", { time: 10, categories: "اسم، شهر، غذا", letters: "ب" }); await wait(200);
  if (st.B.settings.categories.length !== 3) fail("Kategorien nicht übernommen: " + JSON.stringify(st.B.settings.categories));
  A.emit("start"); await wait(200);
  if (st.B.phase !== "playing" || st.B.letter !== "ب") fail("Runde nicht gestartet");
  if (st.B.review || JSON.stringify(st.B).includes("بابک")) fail("Antworten vorzeitig sichtbar");
  console.log("Runde läuft, Buchstabe:", st.B.letter, "Zeit:", Math.round(st.B.remainingMs / 1000), "s");

  A.emit("answers", { 0: "بابک", 1: "بم", 2: "باقالی پلو" });
  B.emit("answers", { 0: "بابك", 1: "بوشهر", 2: "" });       // arabisches ك → gleich wie بابک
  C.emit("answers", { 0: "Bernd", 1: "بم", 2: "برنج" });      // falscher Buchstabe
  await wait(200);
  if (st.A.players.find((p) => p.id === pB).filled !== 2) fail("Fortschritt falsch");
  B.emit("stop"); await wait(100);                            // B hat nicht alles → kein Stopp
  if (st.A.phase !== "playing") fail("Stopp trotz leerem Feld");
  A.emit("stop"); await wait(1600);
  if (st.B.phase !== "review") fail("Keine Auswertung");
  const rv = st.B.review;
  console.log("Gestoppt von:", st.B.stoppedBy, "| Rundenpunkte:", JSON.stringify(rv.roundPoints));
  // Erwartet: A: بابک geteilt 5, بم geteilt 5, باقالی 10 = 20 ; B: 5 + 10 + 0 = 15 ; C: 0 + 5 + 10 = 15
  if (rv.roundPoints[pA] !== 20 || rv.roundPoints[pB] !== 15 || rv.roundPoints[pC] !== 15) fail("Punkte falsch");

  // Gastgeber lehnt C's "برنج" ab → C verliert 10
  A.emit("toggle", { pid: pC, ci: 2 }); await wait(200);
  if (st.C.review.roundPoints[pC] !== 5) fail("Ablehnen klappt nicht");
  A.emit("confirm"); await wait(200);
  const scores = Object.fromEntries(st.C.players.map((p) => [p.name, p.score]));
  console.log("Gesamtpunkte:", JSON.stringify(scores));
  if (st.C.phase !== "lobby" || scores.Rim !== 20) fail("Bestätigen fehlerhaft");

  // Angriff: jemand nutzt die öffentliche ID des Gastgebers als Schlüssel
  const X = mk(); X.on("state", () => {}); await wait(200);
  const rx = await emit(X, "join", { roomId: r.roomId, name: "Hacker", playerId: pA });
  await wait(200);
  if (rx.you === pA || st.B.hostId !== pA) fail("Gastgeber konnte übernommen werden");
  X.emit("start"); await wait(200);
  if (st.B.phase !== "lobby") fail("Fremder konnte Runde starten");
  A.emit("kick", rx.you); await wait(200);

  // Gastgeber trennt sich kurz → bleibt Gastgeber
  A.disconnect(); await wait(300);
  if (st.B.hostId !== pA) fail("Gastgeber zu früh gewechselt");
  const A2 = mk(); A2.on("state", (s) => (st.A = s)); await wait(200);
  const ra2 = await emit(A2, "join", { roomId: r.roomId, name: "Rim", playerId: "keyA-secret" }); await wait(200);
  if (ra2.you !== pA || st.A.hostId !== pA) fail("Gastgeber nach Reconnect verloren");
  if (st.A.players.find((p) => p.id === pA).score !== 20) fail("Punkte nach Reconnect verloren");

  // Gastgeber übergibt an B
  A2.emit("makeHost", pB); await wait(200);
  if (st.B.hostId !== pB) fail("Übergabe klappt nicht");

  // Timer-Ende ohne Stopp
  B.emit("settings", { time: 10 }); B.emit("start"); await wait(200);
  C.emit("answers", { 0: "x" });
  console.log("Warte auf Timer (10 s)…");
  await wait(11500);
  if (st.C.phase !== "review" || st.C.stoppedBy) fail("Timer-Ende klappt nicht");
  console.log("ALLE TESTS OK");
  process.exit(0);
})();
