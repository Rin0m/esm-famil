// Esm Famil (Stadt, Land, Fluss) – Echtzeit-Server
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(__dirname + "/public"));

const PORT = process.env.PORT || 3000;
const GRACE_MS = 1200;          // kurze Wartezeit nach Ende, damit letzte Eingaben ankommen
const POINTS_UNIQUE = 10;
const POINTS_SHARED = 5;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";   // leer = jeder darf Räume erstellen
const HOST_TIMEOUT_MS = 60 * 1000;   // so lange wartet der Raum auf einen getrennten Gastgeber
app.get("/config", (req, res) => res.json({ needPassword: !!ADMIN_PASSWORD }));

// Signiertes Token pro Spieler: erlaubt nach einem Server-Neustart, den Raum wiederherzustellen
const TOKEN_SECRET = process.env.ADMIN_PASSWORD || process.env.ROOM_SECRET || "esm-famil-local";
const makeToken = (rid, pid) => crypto.createHmac("sha256", TOKEN_SECRET).update(rid + "|" + pid).digest("hex").slice(0, 32);
function checkToken(rid, pid, token) {
  if (typeof token !== "string" || typeof pid !== "string" || token.length !== 32) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(makeToken(rid, pid)));
}

function checkPassword(pw) {
  if (!ADMIN_PASSWORD) return true;
  const a = Buffer.from(String(pw || "")), b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const DEFAULTS = {
  fa: { categories: ["اسم", "فامیل", "شهر", "کشور", "غذا", "حیوان", "رنگ", "اشیا"],
        letters: "ا ب پ ت ج چ ح خ د ر ز س ش ص ع ف ق ک گ ل م ن و ه ی" },
  de: { categories: ["Name", "Stadt", "Land", "Fluss", "Tier", "Essen", "Beruf"],
        letters: "A B C D E F G H I K L M N O P R S T U V W Z" },
  en: { categories: ["Name", "City", "Country", "Animal", "Food", "Job", "Thing"],
        letters: "A B C D E F G H I J K L M N O P R S T U V W" },
};

const rooms = new Map();

// ---------- Hilfsfunktionen ----------
function makeRoomId() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id;
  do { id = Array.from({ length: 5 }, () => abc[Math.floor(Math.random() * abc.length)]).join(""); }
  while (rooms.has(id));
  return id;
}

// Normalisieren: Groß/klein, Akzente, persische Varianten
function norm(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[ي]/g, "ی").replace(/[ك]/g, "ک")
    .replace(/[آأإ]/g, "ا").replace(/[ؤ]/g, "و").replace(/[ة]/g, "ه")
    .replace(/[ً-ٰٟ‌]/g, "")   // Harakat, ZWNJ
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function parseLetters(str) {
  return String(str || "").split(/[\s,،]+/).map((x) => x.trim()).filter(Boolean).slice(0, 60);
}
function parseCategories(arr) {
  return (Array.isArray(arr) ? arr : String(arr || "").split(/[\n,،]+/))
    .map((x) => String(x).trim().slice(0, 30)).filter(Boolean).slice(0, 15);
}

function publicPlayers(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id, name: p.name, score: p.score, online: p.online,
    isHost: p.id === room.hostId,
    filled: room.phase === "playing" ? Object.values(room.answers[p.id] || {}).filter((v) => String(v).trim()).length : undefined,
  }));
}

function broadcast(room) {
  const state = {
    roomId: room.id,
    phase: room.phase,
    hostId: room.hostId,
    settings: room.settings,
    players: publicPlayers(room),
    round: room.round,
    letter: room.letter,
    remainingMs: room.phase === "playing" ? Math.max(0, room.endsAt - Date.now()) : 0,
    stoppedBy: room.stoppedBy || null,
    roundPlayers: ["playing", "collecting", "review"].includes(room.phase) ? room.roundPlayers : [],
    review: room.phase === "review" ? buildReview(room) : null,
  };
  io.to(room.id).emit("state", state);
}

// Punkte berechnen
function buildReview(room) {
  const cats = room.roundCategories;
  const pids = room.roundPlayers;
  const L = norm(room.letter);
  const cells = {};       // pid -> [{word, status, points}]
  const roundPoints = {};
  pids.forEach((pid) => { cells[pid] = []; roundPoints[pid] = 0; });

  cats.forEach((_, ci) => {
    const valid = {};
    pids.forEach((pid) => {
      const word = String((room.answers[pid] || {})[ci] || "").trim();
      const n = norm(word);
      let status = "ok";
      if (!n) status = "empty";
      else if (!n.startsWith(L)) status = "wrongLetter";
      if (room.rejected.has(pid + "|" + ci) && status === "ok") status = "rejected";
      if (room.accepted.has(pid + "|" + ci) && status === "wrongLetter") status = "ok";
      cells[pid][ci] = { word, status, points: 0, key: n };
      if (status === "ok") valid[n] = (valid[n] || 0) + 1;
    });
    pids.forEach((pid) => {
      const c = cells[pid][ci];
      if (c.status === "ok") {
        c.points = valid[c.key] > 1 ? POINTS_SHARED : POINTS_UNIQUE;
        if (valid[c.key] > 1) c.status = "shared";
      }
      roundPoints[pid] += c.points;
      delete c.key;
    });
  });
  return { categories: cats, players: pids, cells, roundPoints };
}

function endRound(room) {
  if (room.phase !== "playing") return;
  clearTimeout(room.timer);
  room.phase = "collecting";
  broadcast(room);
  io.to(room.id).emit("flush");            // alle schicken ihre letzte Version
  room.graceTimer = setTimeout(() => { if (room.phase === "collecting") { room.phase = "review"; broadcast(room); } }, GRACE_MS);
}

function pickLetter(room) {
  const letters = parseLetters(room.settings.letters);
  let pool = letters.filter((l) => !room.usedLetters.includes(l));
  if (!pool.length) { room.usedLetters = []; pool = letters; }
  const l = pool[Math.floor(Math.random() * pool.length)];
  room.usedLetters.push(l);
  return l;
}

function getCtx(socket) {
  const room = rooms.get(socket.data.roomId);
  if (!room) { if (socket.data.roomId) socket.emit("roomLost"); return {}; }
  return { room, pid: socket.data.playerId, isHost: room.hostId === socket.data.playerId };
}

// ---------- Socket-Ereignisse ----------
io.on("connection", (socket) => {
  socket.on("create", ({ name, playerId, lang, password }, cb) => {
    if (!checkPassword(password)) return cb && cb({ ok: false, error: "wrongPassword" });
    const id = makeRoomId();
    const d = DEFAULTS[lang] || DEFAULTS.fa;
    const room = {
      id, hostId: null, keys: new Map(), players: new Map(), phase: "lobby", round: 0,
      settings: { time: 60, categories: [...d.categories], letters: d.letters },
      usedLetters: [], answers: {}, rejected: new Set(), accepted: new Set(),
    };
    rooms.set(id, room);
    const you = joinRoom(socket, room, name, playerId);
    room.hostId = you;
    broadcast(room);
    cb && cb({ ok: true, roomId: id, you, token: makeToken(id, you) });
  });

  socket.on("join", ({ roomId, name, playerId, recover }, cb) => {
    const rid = String(roomId || "").toUpperCase();
    let room = rooms.get(rid);
    const rc = recover && typeof recover === "object" ? recover : null;
    const validToken = rc && checkToken(rid, rc.myId, rc.token);
    // Server wurde neu gestartet → Raum mit gleichem Code, Einstellungen und Punkten wiederherstellen
    if (!room && validToken) {
      const st = rc.settings || {};
      room = {
        id: rid, hostId: null, keys: new Map(), players: new Map(), phase: "lobby",
        round: Math.max(0, parseInt(rc.round, 10) || 0), usedLetters: [], answers: {}, rejected: new Set(), accepted: new Set(),
        settings: {
          time: Math.min(600, Math.max(10, parseInt(st.time, 10) || 60)),
          categories: parseCategories(st.categories).length ? parseCategories(st.categories) : [...DEFAULTS.fa.categories],
          letters: parseLetters(st.letters).join(" ") || DEFAULTS.fa.letters,
        },
      };
      (Array.isArray(rc.players) ? rc.players : []).slice(0, 12).forEach((p) => {
        const id = String(p.id || "").slice(0, 40);
        if (id) room.players.set(id, { id, name: String(p.name || "?").slice(0, 20), score: Math.max(0, parseInt(p.score, 10) || 0), online: false, restored: true });
      });
      rooms.set(rid, room);
    }
    if (!room) return cb && cb({ ok: false, error: "noRoom" });
    // Eigenen alten Platz (mit Punkten) zurückholen – nur mit gültigem Token
    const key = String(playerId || "").slice(0, 60);
    if (validToken && key && !room.keys.has(key)) {
      const old = room.players.get(rc.myId);
      if (old && old.restored) { room.keys.set(key, rc.myId); old.restored = false; }
    }
    if (!room.keys.has(key) && room.players.size >= 12) return cb && cb({ ok: false, error: "full" });
    const you = joinRoom(socket, room, name, playerId);
    if (!room.hostId || !room.players.has(room.hostId)) { room.hostId = you; broadcast(room); }
    cb && cb({ ok: true, roomId: room.id, you, token: makeToken(room.id, you) });
  });

  socket.on("settings", (s) => {
    const { room, isHost } = getCtx(socket);
    if (!room || !isHost || room.phase !== "lobby") return;
    const time = Math.min(600, Math.max(10, parseInt(s.time, 10) || 60));
    const categories = parseCategories(s.categories);
    const letters = parseLetters(s.letters).join(" ");
    room.settings = { time, categories: categories.length ? categories : room.settings.categories, letters: letters || room.settings.letters };
    if (s.letters !== undefined) room.usedLetters = [];
    broadcast(room);
  });

  socket.on("start", () => {
    const { room, isHost } = getCtx(socket);
    if (!room || !isHost || room.phase !== "lobby") return;
    room.round += 1;
    room.letter = pickLetter(room);
    room.answers = {};
    room.rejected = new Set();
    room.accepted = new Set();
    room.stoppedBy = null;
    room.roundCategories = [...room.settings.categories];
    room.roundPlayers = [...room.players.values()].filter((p) => p.online).map((p) => p.id);
    room.phase = "playing";
    room.endsAt = Date.now() + room.settings.time * 1000;
    room.timer = setTimeout(() => endRound(room), room.settings.time * 1000);
    broadcast(room);
  });

  socket.on("answers", (answers) => {
    const { room, pid } = getCtx(socket);
    if (!room || !["playing", "collecting"].includes(room.phase) || !room.roundPlayers.includes(pid)) return;
    const clean = {};
    room.roundCategories.forEach((_, i) => { clean[i] = String((answers || {})[i] || "").slice(0, 40); });
    const prevFilled = Object.values(room.answers[pid] || {}).filter((v) => v.trim()).length;
    room.answers[pid] = clean;
    const filled = Object.values(clean).filter((v) => v.trim()).length;
    if (room.phase === "playing" && filled !== prevFilled) broadcast(room);   // Fortschritt zeigen
  });

  // „Stopp!“ – nur wer alle Felder ausgefüllt hat
  socket.on("stop", () => {
    const { room, pid } = getCtx(socket);
    if (!room || room.phase !== "playing") return;
    const a = room.answers[pid] || {};
    const allFilled = room.roundCategories.every((_, i) => String(a[i] || "").trim());
    if (!allFilled) return;
    room.stoppedBy = room.players.get(pid)?.name || null;
    endRound(room);
  });

  // Gastgeber markiert ein Wort als ungültig / gültig
  socket.on("toggle", ({ pid, ci }) => {
    const { room, isHost } = getCtx(socket);
    if (!room || !isHost || room.phase !== "review") return;
    const key = pid + "|" + ci;
    const cell = buildReview(room).cells[pid]?.[ci];
    if (!cell) return;
    if (room.rejected.has(key)) room.rejected.delete(key);
    else if (room.accepted.has(key)) room.accepted.delete(key);
    else if (cell.status === "wrongLetter") room.accepted.add(key);
    else if (cell.status === "ok" || cell.status === "shared") room.rejected.add(key);
    broadcast(room);
  });

  socket.on("confirm", () => {
    const { room, isHost } = getCtx(socket);
    if (!room || !isHost || room.phase !== "review") return;
    const r = buildReview(room);
    for (const pid of r.players) {
      const p = room.players.get(pid);
      if (p) p.score += r.roundPoints[pid];
    }
    room.phase = "lobby";
    broadcast(room);
  });

  socket.on("resetScores", () => {
    const { room, isHost } = getCtx(socket);
    if (!room || !isHost || room.phase !== "lobby") return;
    room.players.forEach((p) => (p.score = 0));
    room.round = 0;
    room.usedLetters = [];
    broadcast(room);
  });

  socket.on("kick", (pid) => {
    const { room, isHost } = getCtx(socket);
    if (!room || !isHost || pid === room.hostId) return;
    room.players.delete(pid);
    for (const [k, v] of room.keys) if (v === pid) room.keys.delete(k);
    io.to(room.id).emit("kicked", pid);
    broadcast(room);
  });

  // Gastgeber gibt seine Rolle an einen anderen Spieler weiter
  socket.on("makeHost", (pid) => {
    const { room, isHost } = getCtx(socket);
    if (!room || !isHost || !room.players.get(pid)?.online) return;
    room.hostId = pid;
    broadcast(room);
  });

  // Gastgeber bricht die laufende Runde ab (z. B. weil jemand später kommt) → zurück zur Lobby, ohne Punkte
  socket.on("abort", () => {
    const { room, isHost } = getCtx(socket);
    if (!room || !isHost || !["playing", "collecting", "review"].includes(room.phase)) return;
    clearTimeout(room.timer);
    clearTimeout(room.graceTimer);
    if (room.phase !== "review" && room.letter) room.usedLetters = room.usedLetters.filter((l) => l !== room.letter);
    room.round = Math.max(0, room.round - 1);
    room.phase = "lobby";
    room.stoppedBy = null;
    broadcast(room);
  });

  // Spieler verlässt den Raum endgültig
  socket.on("leave", (_, cb) => {
    const { room, pid } = getCtx(socket);
    if (!room) return cb && cb({ ok: true });
    room.players.delete(pid);
    for (const [k, v] of room.keys) if (v === pid) room.keys.delete(k);
    if (room.roundPlayers) room.roundPlayers = room.roundPlayers.filter((x) => x !== pid);
    socket.leave(room.id);
    socket.data.roomId = null;
    if (room.hostId === pid) {
      const next = [...room.players.values()].find((x) => x.online);
      room.hostId = next ? next.id : null;
    }
    if (!room.players.size) { clearTimeout(room.timer); rooms.delete(room.id); }
    else broadcast(room);
    cb && cb({ ok: true });
  });

  socket.on("disconnect", () => {
    const { room, pid } = getCtx(socket);
    if (!room) return;
    const p = room.players.get(pid);
    if (p && p.socketId === socket.id) p.online = false;
    // Gastgeber weg → nächster Online-Spieler wird Gastgeber
    if (room.hostId === pid) {
      clearTimeout(room.hostTimer);
      room.hostTimer = setTimeout(() => {
        if (room.players.get(room.hostId)?.online) return;
        const next = [...room.players.values()].find((x) => x.online);
        if (next) { room.hostId = next.id; broadcast(room); }
      }, HOST_TIMEOUT_MS);
    }
    // Raum aufräumen, wenn 30 Min. niemand online ist
    if (![...room.players.values()].some((x) => x.online)) {
      clearTimeout(room.cleanup);
      room.cleanup = setTimeout(() => {
        if (![...room.players.values()].some((x) => x.online)) { clearTimeout(room.timer); rooms.delete(room.id); }
      }, 30 * 60 * 1000);
    }
    broadcast(room);
  });
});

// playerKey ist geheim (nur im Browser des Spielers), nach außen sieht man nur die zufällige öffentliche ID
function joinRoom(socket, room, name, playerKey) {
  name = String(name || "?").trim().slice(0, 20) || "?";
  playerKey = String(playerKey || socket.id).slice(0, 60);
  let pid = room.keys.get(playerKey);
  if (!pid) { pid = crypto.randomBytes(6).toString("hex"); room.keys.set(playerKey, pid); }
  socket.join(room.id);
  socket.data.roomId = room.id;
  socket.data.playerId = pid;
  const existing = room.players.get(pid);
  if (existing) { existing.online = true; existing.socketId = socket.id; existing.name = name; }
  else room.players.set(pid, { id: pid, name, score: 0, online: true, socketId: socket.id });
  if (room.hostId && !room.players.has(room.hostId)) room.hostId = pid;   // nur falls es keinen Gastgeber mehr gibt
  broadcast(room);
  // Wer mitten in der Runde (neu) verbindet, bekommt seine Antworten zurück
  if (room.phase === "playing" && room.answers[pid]) socket.emit("restore", room.answers[pid]);
  return pid;
}

server.listen(PORT, () => console.log("Esm Famil läuft auf http://localhost:" + PORT));
module.exports = { norm };
