// Reliable wrapper around window.speechSynthesis.
// Works around well-known browser bugs:
//  - Chrome's ~15s stall (keep-alive pause/resume heartbeat)
//  - Safari/Chrome zombie state when cancel() is followed synchronously by speak()
//  - Tab visibility leaving synthesis paused
//  - One-shot priming after mute/unmute or after a recovered stall

const STORAGE_KEY = "speech-muted";

let primed = false;
let heartbeat: number | null = null;
let visibilityBound = false;

let muted = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
})();

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

function startHeartbeat() {
  const s = synth();
  if (!s) return;
  if (heartbeat != null) return;
  heartbeat = window.setInterval(() => {
    const ss = synth();
    if (!ss) return;
    if (ss.speaking) {
      // The classic Chrome 15s workaround.
      try {
        ss.pause();
        ss.resume();
      } catch {}
    } else {
      stopHeartbeat();
    }
  }, 10000);
}

function stopHeartbeat() {
  if (heartbeat != null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function bindVisibilityOnce() {
  if (visibilityBound) return;
  if (typeof document === "undefined") return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    const s = synth();
    if (!s) return;
    if (document.visibilityState === "visible") {
      // If we were left in a paused-but-speaking zombie state, kick it.
      try {
        if (s.speaking && s.paused) s.resume();
      } catch {}
    }
  });
}

// Detect the zombie state and reset the engine. Returns true if a reset happened.
function recoverIfStuck(): boolean {
  const s = synth();
  if (!s) return false;
  try {
    if (s.speaking && s.paused) {
      s.resume();
      s.cancel();
      stopHeartbeat();
      primed = false;
      return true;
    }
  } catch {}
  return false;
}

function stripEmojis(text: string) {
  return text
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\p{Emoji_Modifier}/gu, "")
    .replace(/\p{Regional_Indicator}/gu, "")
    .replace(/[\u200D\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Split long text into <=180 char chunks on sentence/word boundaries.
function chunkText(text: string, max = 180): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  // Split on sentence boundaries first.
  const sentences = text.split(/(?<=[.!?;])\s+/);
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const sRaw of sentences) {
    let s = sRaw;
    // If a single sentence is still too long, break on words.
    if (s.length > max) {
      flush();
      const words = s.split(/\s+/);
      for (const w of words) {
        if ((buf + " " + w).trim().length > max) {
          flush();
        }
        buf = (buf ? buf + " " : "") + w;
      }
      flush();
      continue;
    }
    if ((buf + " " + s).trim().length > max) {
      flush();
    }
    buf = (buf ? buf + " " : "") + s;
  }
  flush();
  return out.length ? out : [text];
}

function speakChunks(chunks: string[]) {
  const s = synth();
  if (!s) return;
  bindVisibilityOnce();
  for (const c of chunks) {
    const u = new SpeechSynthesisUtterance(c);
    u.rate = 1;
    u.pitch = 1;
    u.onstart = () => startHeartbeat();
    u.onend = () => {
      // Stop heartbeat only when nothing else is queued.
      const ss = synth();
      if (ss && !ss.speaking && !ss.pending) stopHeartbeat();
    };
    u.onerror = () => {
      const ss = synth();
      if (ss && !ss.speaking && !ss.pending) stopHeartbeat();
    };
    try {
      s.speak(u);
    } catch {}
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {}
  if (v) {
    stopHeartbeat();
    try {
      synth()?.cancel();
    } catch {}
  } else {
    // Allow re-priming after unmute.
    primed = false;
  }
}

export function primeSpeech() {
  if (primed) return;
  if (muted) return;
  const s = synth();
  if (!s) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    s.speak(u);
    primed = true;
  } catch {}
  bindVisibilityOnce();
}

export function speak(text: string) {
  if (muted) return;
  const s = synth();
  if (!s) return;

  bindVisibilityOnce();

  // Auto-recover from the zombie state before queueing.
  recoverIfStuck();

  const cleaned = stripEmojis(text);
  if (!cleaned) return;

  const wasBusy = s.speaking || s.pending;

  // If something is currently speaking/queued, cancel and DEFER the new speak
  // call. Calling cancel() and speak() back-to-back synchronously is a known
  // trigger of the Safari/Chrome stuck state.
  if (wasBusy) {
    try {
      s.cancel();
    } catch {}
    stopHeartbeat();
    const chunks = chunkText(cleaned);
    window.setTimeout(() => {
      // If user muted in the meantime, abort.
      if (muted) return;
      // Recover again in case cancel left it odd.
      recoverIfStuck();
      speakChunks(chunks);
    }, 60);
    return;
  }

  // Idle path — speak immediately to preserve user-gesture context.
  speakChunks(chunkText(cleaned));
}

export function stopSpeech() {
  const s = synth();
  if (!s) return;
  try {
    s.cancel();
  } catch {}
  stopHeartbeat();
}
