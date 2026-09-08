(function () {
  const WORD_LENGTH = 5;
  const MAX_ATTEMPTS = 6;
  const STORAGE_SEED_KEY = "gibberishdle-user-seed-v1";
  const STORAGE_STATE_KEY = "gibberishdle-state-v1";
  const STORAGE_SOUND_KEY = "gibberishdle-sound-enabled-v1";
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ENTERZXCVBNMBACK"];
  const STATUS_PRIORITY = { absent: 0, present: 1, correct: 2 };

  const boardEl = document.getElementById("board");
  const keyboardEl = document.getElementById("keyboard");
  const statusEl = document.getElementById("status");
  const soundToggleEl = document.getElementById("sound-toggle");
  const devNewGameEl = document.getElementById("dev-new-game");

  const today = formatLocalDate(new Date());
  let userSeed = getOrCreateUserSeed();
  let answer = generateDailyAnswer(today, userSeed);

  let state = loadStateForToday();
  let currentGuess = "";
  let keyboardStates = {};
  let soundEnabled = localStorage.getItem(STORAGE_SOUND_KEY) !== "0";
  let audioContext = null;

  if (!state) {
    state = {
      date: today,
      guesses: [],
      currentRow: 0,
      status: "playing"
    };
    saveState();
  }

  renderBoard();
  renderKeyboard();
  restoreKeyboardState();
  updateBoardFromState();
  updateStatus("Type a 5-letter guess.");
  updateSoundToggleText();
  maybeEnableDevControls();

  document.addEventListener("keydown", onPhysicalKey);
  keyboardEl.addEventListener("click", onKeyboardClick);
  soundToggleEl.addEventListener("click", toggleSound);
  devNewGameEl.addEventListener("click", startDevRandomPuzzle);

  if (state.status === "won") {
    updateStatus("You won! 🎉");
  } else if (state.status === "lost") {
    updateStatus(`Out of guesses. Answer: ${answer}`);
  }

  function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function getOrCreateUserSeed() {
    const existing = localStorage.getItem(STORAGE_SEED_KEY);
    if (existing && /^\d+$/.test(existing)) return Number(existing);

    let seed = Math.floor(Math.random() * 0xffffffff);
    if (window.crypto && window.crypto.getRandomValues) {
      const arr = new Uint32Array(1);
      window.crypto.getRandomValues(arr);
      seed = arr[0];
    }
    localStorage.setItem(STORAGE_SEED_KEY, String(seed));
    return seed;
  }

  function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i += 1) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), t | 1);
      r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generateDailyAnswer(date, seed) {
    const rng = mulberry32(hashString(`${seed}:${date}`));
    let out = "";
    for (let i = 0; i < WORD_LENGTH; i += 1) {
      out += LETTERS[Math.floor(rng() * LETTERS.length)];
    }
    return out;
  }

  function loadStateForToday() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_STATE_KEY) || "null");
      if (!parsed || parsed.date !== today) return null;
      if (!Array.isArray(parsed.guesses)) return null;
      if (typeof parsed.currentRow !== "number") return null;
      if (!["playing", "won", "lost"].includes(parsed.status)) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify(state));
  }

  function renderBoard() {
    boardEl.innerHTML = "";
    for (let r = 0; r < MAX_ATTEMPTS; r += 1) {
      const row = document.createElement("div");
      row.className = "row";
      for (let c = 0; c < WORD_LENGTH; c += 1) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.id = `tile-${r}-${c}`;
        tile.setAttribute("aria-label", `Row ${r + 1} Column ${c + 1}`);
        row.appendChild(tile);
      }
      boardEl.appendChild(row);
    }
  }

  function renderKeyboard() {
    keyboardEl.innerHTML = "";
    KEY_ROWS.forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "kb-row";
      let i = 0;
      while (i < row.length) {
        let keyText;
        if (row.startsWith("ENTER", i)) {
          keyText = "ENTER";
          i += 5;
        } else if (row.startsWith("BACK", i)) {
          keyText = "BACK";
          i += 4;
        } else {
          keyText = row[i];
          i += 1;
        }
        const key = document.createElement("button");
        key.type = "button";
        key.className = "key";
        if (keyText === "ENTER" || keyText === "BACK") key.classList.add("wide");
        key.dataset.key = keyText;
        key.textContent = keyText === "BACK" ? "⌫" : keyText;
        key.setAttribute("aria-label", keyText === "BACK" ? "Backspace" : keyText);
        rowEl.appendChild(key);
      }
      keyboardEl.appendChild(rowEl);
    });
  }

  function restoreKeyboardState() {
    keyboardStates = {};
    state.guesses.forEach((guess) => {
      const result = evaluateGuess(guess, answer);
      result.forEach(({ letter, status }) => updateKeyStatus(letter, status));
    });
    applyKeyboardClasses();
  }

  function updateBoardFromState() {
    for (let r = 0; r < MAX_ATTEMPTS; r += 1) {
      const guess = state.guesses[r] || "";
      const result = guess ? evaluateGuess(guess, answer) : null;
      for (let c = 0; c < WORD_LENGTH; c += 1) {
        const tile = document.getElementById(`tile-${r}-${c}`);
        const char = guess[c] || "";
        tile.textContent = char;
        tile.className = "tile";
        if (char) tile.classList.add("filled");
        if (result) tile.classList.add(result[c].status);
      }
    }
  }

  function onPhysicalKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter") {
      submitGuess();
      return;
    }
    if (e.key === "Backspace") {
      removeLetter();
      return;
    }
    if (/^[a-zA-Z]$/.test(e.key)) addLetter(e.key.toUpperCase());
  }

  function onKeyboardClick(e) {
    const key = e.target.closest("[data-key]");
    if (!key) return;
    const value = key.dataset.key;
    if (value === "ENTER") submitGuess();
    else if (value === "BACK") removeLetter();
    else addLetter(value);
  }

  function addLetter(letter) {
    if (state.status !== "playing") return;
    if (currentGuess.length >= WORD_LENGTH) return;
    currentGuess += letter;
    playSound("key");
    drawCurrentGuess();
  }

  function removeLetter() {
    if (state.status !== "playing") return;
    if (!currentGuess.length) return;
    currentGuess = currentGuess.slice(0, -1);
    playSound("key");
    drawCurrentGuess();
  }

  function drawCurrentGuess() {
    const row = state.currentRow;
    for (let c = 0; c < WORD_LENGTH; c += 1) {
      const tile = document.getElementById(`tile-${row}-${c}`);
      const char = currentGuess[c] || "";
      tile.textContent = char;
      tile.className = "tile";
      if (char) tile.classList.add("filled");
    }
  }

  function submitGuess() {
    if (state.status !== "playing") return;
    if (currentGuess.length !== WORD_LENGTH) {
      updateStatus("Guess must be 5 letters.");
      playSound("invalid");
      return;
    }
    if (!/^[A-Z]{5}$/.test(currentGuess)) {
      updateStatus("Use letters A-Z only.");
      playSound("invalid");
      return;
    }

    const guess = currentGuess;
    const result = evaluateGuess(guess, answer);
    state.guesses.push(guess);
    state.currentRow += 1;
    saveState();
    currentGuess = "";

    for (let c = 0; c < WORD_LENGTH; c += 1) {
      const tile = document.getElementById(`tile-${state.currentRow - 1}-${c}`);
      tile.textContent = guess[c];
      tile.className = `tile filled ${result[c].status}`;
      updateKeyStatus(result[c].letter, result[c].status);
    }
    applyKeyboardClasses();
    playSound("submit");

    if (guess === answer) {
      state.status = "won";
      saveState();
      updateStatus("You won! 🎉");
      playSound("win");
      return;
    }

    if (state.currentRow >= MAX_ATTEMPTS) {
      state.status = "lost";
      saveState();
      updateStatus(`Out of guesses. Answer: ${answer}`);
      playSound("lose");
      return;
    }

    updateStatus(`${MAX_ATTEMPTS - state.currentRow} attempts left.`);
  }

  function evaluateGuess(guess, target) {
    const result = Array.from(guess).map((letter) => ({ letter, status: "absent" }));
    const remaining = {};

    for (let i = 0; i < WORD_LENGTH; i += 1) {
      const g = guess[i];
      const t = target[i];
      if (g === t) {
        result[i].status = "correct";
      } else {
        remaining[t] = (remaining[t] || 0) + 1;
      }
    }

    for (let i = 0; i < WORD_LENGTH; i += 1) {
      if (result[i].status === "correct") continue;
      const g = guess[i];
      if (remaining[g] > 0) {
        result[i].status = "present";
        remaining[g] -= 1;
      }
    }
    return result;
  }

  function updateKeyStatus(letter, status) {
    const prior = keyboardStates[letter];
    if (!prior || STATUS_PRIORITY[status] > STATUS_PRIORITY[prior]) {
      keyboardStates[letter] = status;
    }
  }

  function applyKeyboardClasses() {
    keyboardEl.querySelectorAll("[data-key]").forEach((key) => {
      const value = key.dataset.key;
      if (!/^[A-Z]$/.test(value)) return;
      key.classList.remove("correct", "present", "absent");
      const status = keyboardStates[value];
      if (status) key.classList.add(status);
    });
  }

  function updateStatus(message) {
    statusEl.textContent = message;
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    localStorage.setItem(STORAGE_SOUND_KEY, soundEnabled ? "1" : "0");
    updateSoundToggleText();
    if (soundEnabled) playSound("key");
  }

  function updateSoundToggleText() {
    soundToggleEl.textContent = soundEnabled ? "🔊 Sound: On" : "🔇 Sound: Off";
  }

  function safeGetAudioContext() {
    if (!soundEnabled) return null;
    if (audioContext) return audioContext;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audioContext = new Ctx();
      return audioContext;
    } catch (_) {
      return null;
    }
  }

  function tone(freq, duration, offset) {
    const ctx = safeGetAudioContext();
    if (!ctx) return;
    try {
      const start = ctx.currentTime + (offset || 0);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    } catch (_) {
      // Graceful degradation on audio failures.
    }
  }

  function playSound(type) {
    if (!soundEnabled) return;
    if (type === "key") tone(440, 0.05);
    if (type === "submit") tone(660, 0.08);
    if (type === "invalid") {
      tone(240, 0.08);
      tone(180, 0.1, 0.09);
    }
    if (type === "win") {
      tone(523, 0.07);
      tone(659, 0.07, 0.08);
      tone(784, 0.12, 0.16);
    }
    if (type === "lose") {
      tone(392, 0.09);
      tone(293, 0.12, 0.1);
    }
  }

  function maybeEnableDevControls() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("dev") === "1") devNewGameEl.hidden = false;
  }

  function startDevRandomPuzzle() {
    const newSeed = Math.floor(Math.random() * 0xffffffff);
    answer = generateDailyAnswer(today, newSeed);
    state = {
      date: today,
      guesses: [],
      currentRow: 0,
      status: "playing"
    };
    currentGuess = "";
    keyboardStates = {};
    saveState();
    updateBoardFromState();
    applyKeyboardClasses();
    updateStatus("New dev puzzle started.");
  }
})();
