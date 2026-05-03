// Reliable wrapper around window.speechSynthesis.
//
// Core principle: treat the speech engine as untrusted. Any browser audio-
// session change (tab background, OS dictation, route change, dropped
// utterance, long idle) silently kills queued utterances on iOS Safari and
// Android Chrome — with no error event. So we mark the engine "dirty" on
// every such signal, and the next user gesture (or the next speak call
// reached from inside a gesture) re-runs the exact same recovery the
// Mute → Unmute toggle does, which is known to work 100% of the time.

const STORAGE_KEY = "speech-muted";
const IDLE_DIRTY_MS = 30000;
const WATCHDOG_MS = 1500;

let primed = false;
let engineDirty = false;
let heartbeat: number | null = null;
let visibilityBound = false;
let lastSuccessAt = 0;
let dictationActive = false;

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

// ---- Voice selection ----
//
// The Web Speech API does not expose "the OS default voice" directly, but
// `SpeechSynthesisVoice.default === true` flags the voice the engine
// considers default. On iOS this tracks the system voice already; on
// Windows, Chrome/Edge default to their own pick unless we explicitly set
// `utterance.voice`. So we pick the best available voice and assign it.
let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesBound = false;

function pickVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  const voices = s.getVoices();
  if (!voices || voices.length === 0) return null;
  const navLang = (typeof navigator !== "undefined" && navigator.language) || "en-US";
  const prefix = navLang.split("-")[0].toLowerCase();
  const langMatch = (v: SpeechSynthesisVoice) => v.lang?.toLowerCase().startsWith(prefix);
  return (
    voices.find((v) => v.default && langMatch(v)) ||
    voices.find((v) => v.default) ||
    voices.find((v) => v.localService && v.lang?.toLowerCase() === navLang.toLowerCase()) ||
    voices.find((v) => v.localService && langMatch(v)) ||
    voices.find(langMatch) ||
    voices[0] ||
    null
  );
}

function refreshVoice() {
  cachedVoice = pickVoice();
}

function bindVoicesOnce() {
  if (voicesBound) return;
  const s = synth();
  if (!s) return;
  voicesBound = true;
  refreshVoice();
  if ("onvoiceschanged" in s) {
    s.addEventListener?.("voiceschanged", refreshVoice);
    // Some browsers only support the property assignment.
    try { (s as any).onvoiceschanged = refreshVoice; } catch {}
  }
}

function markDirty() {
  engineDirty = true;
  primed = false;
}

function startHeartbeat() {
  const s = synth();
  if (!s) return;
  if (heartbeat != null) return;
  heartbeat = window.setInterval(() => {
    const ss = synth();
    if (!ss) return;
    if (ss.speaking) {
      try { ss.pause(); ss.resume(); } catch {}
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

function bindLifecycleOnce() {
  if (visibilityBound) return;
  if (typeof document === "undefined") return;
  visibilityBound = true;

  // Visibility / page lifecycle: mark engine dirty on ANY transition.
  // iOS Safari often only fires pagehide/pageshow when switching apps.
  const onHide = () => { markDirty(); stopHeartbeat(); };
  const onShow = () => { markDirty(); };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onHide();
    else onShow();
  });
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", onShow);
  window.addEventListener("blur", () => { markDirty(); });
  window.addEventListener("focus", () => { markDirty(); });
}

// Hard reset the speech engine. Required after the OS audio session was held
// by another input (e.g. mobile keyboard dictation), which leaves the engine
// in a state our flag-based recovery cannot detect.
function resetEngine() {
  const s = synth();
  if (!s) return;
  try { s.resume(); } catch {}
  try { s.cancel(); } catch {}
  try { s.resume(); } catch {}
  try { s.cancel(); } catch {}
  stopHeartbeat();
  primed = false;
}

const isIOS = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
};

// Briefly open and close an AudioContext to nudge the OS audio route back to
// playback after a dictation/recording session held the input route. iOS only.
function nudgeAudioRoute() {
  if (!isIOS()) return;
  try {
    const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ac = new Ctx();
    const close = () => { try { ac.close(); } catch {} };
    if (ac.state === "suspended" && typeof ac.resume === "function") {
      ac.resume().then(close).catch(close);
    } else {
      setTimeout(close, 0);
    }
  } catch {}
}

// Synchronous recovery sequence — must be called inside a user gesture for
// iOS to honor the subsequent speak(). This is exactly what Mute→Unmute does.
function rearmInGesture() {
  resetEngine();
  nudgeAudioRoute();
  primeSpeech();
  engineDirty = false;
}

// ---- Dictation hooks ----

// Called by ItemRow when dictation is detected via onInput. We DO NOT cancel
// any current speech here — focus alone is not dictation. We just mark the
// engine dirty so the next speak/gesture re-arms.
export function notifyDictationDetected() {
  dictationActive = true;
  markDirty();
}

// Called on textarea blur. Idempotent. Only nudges the audio route if we
// actually saw dictation, to avoid pointless AudioContext churn.
export function notifyDictationEnd() {
  if (!dictationActive) return;
  dictationActive = false;
  resetEngine();
  nudgeAudioRoute();
  markDirty();
}

// Kept as a no-op for backwards compat with any caller still importing it.
// Focus is NOT dictation — never cancel speech on focus.
export function notifyDictationStart() {
  /* no-op */
}

// Called from a global pointer/touch listener. If the engine is dirty,
// perform the full recovery synchronously inside this real user gesture.
export function notifyUserGesture() {
  if (muted) return;
  if (engineDirty) {
    rearmInGesture();
    return;
  }
  if (!primed) primeSpeech();
}

// Called on route changes — same audio-session risk as backgrounding.
export function notifyRouteChange() {
  markDirty();
  try { synth()?.cancel(); } catch {}
  stopHeartbeat();
}

let gestureInstalled = false;
export function installGestureRearm() {
  if (gestureInstalled) return;
  if (typeof window === "undefined") return;
  gestureInstalled = true;
  bindLifecycleOnce();
  const handler = () => notifyUserGesture();
  window.addEventListener("pointerup", handler, { capture: true, passive: true });
  window.addEventListener("touchend", handler, { capture: true, passive: true });
  window.addEventListener("click", handler, { capture: true, passive: true });
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

function chunkText(text: string, max = 180): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  const sentences = text.split(/(?<=[.!?;])\s+/);
  let buf = "";
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ""; };
  for (const sRaw of sentences) {
    let s = sRaw;
    if (s.length > max) {
      flush();
      const words = s.split(/\s+/);
      for (const w of words) {
        if ((buf + " " + w).trim().length > max) flush();
        buf = (buf ? buf + " " : "") + w;
      }
      flush();
      continue;
    }
    if ((buf + " " + s).trim().length > max) flush();
    buf = (buf ? buf + " " : "") + s;
  }
  flush();
  return out.length ? out : [text];
}

function speakChunks(chunks: string[]) {
  const s = synth();
  if (!s) return;
  bindLifecycleOnce();

  let watchdog: number | null = null;
  const armWatchdog = () => {
    if (watchdog != null) return;
    watchdog = window.setTimeout(() => {
      const ss = synth();
      // If after WATCHDOG_MS nothing started AND nothing is queued, the
      // utterance was silently dropped — mark dirty so the next gesture
      // self-heals. This is the only way to detect a dead engine.
      if (ss && !ss.speaking && !ss.pending) {
        markDirty();
      }
      watchdog = null;
    }, WATCHDOG_MS);
  };
  const clearWatchdog = () => {
    if (watchdog != null) { clearTimeout(watchdog); watchdog = null; }
  };

  for (const c of chunks) {
    const u = new SpeechSynthesisUtterance(c);
    u.rate = 1;
    u.pitch = 1;
    u.onstart = () => { clearWatchdog(); startHeartbeat(); };
    u.onend = () => {
      lastSuccessAt = Date.now();
      const ss = synth();
      if (ss && !ss.speaking && !ss.pending) stopHeartbeat();
    };
    u.onerror = () => {
      clearWatchdog();
      markDirty();
      const ss = synth();
      if (ss && !ss.speaking && !ss.pending) stopHeartbeat();
    };
    try {
      s.speak(u);
      armWatchdog();
    } catch {
      markDirty();
    }
  }
}

export function isMuted() {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch {}
  if (v) {
    stopHeartbeat();
    try { synth()?.cancel(); } catch {}
  } else {
    // Same recovery a manual unmute always triggers.
    primed = false;
    engineDirty = true;
  }
}

export function primeSpeech() {
  if (muted) return;
  const s = synth();
  if (!s) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    s.speak(u);
    primed = true;
    lastSuccessAt = Date.now();
  } catch {}
  bindLifecycleOnce();
}

export function speak(text: string) {
  if (muted) return;
  const s = synth();
  if (!s) return;

  bindLifecycleOnce();

  const cleaned = stripEmojis(text);
  if (!cleaned) return;

  // Idle timeout — engines silently die after long pauses.
  if (lastSuccessAt && Date.now() - lastSuccessAt > IDLE_DIRTY_MS) {
    markDirty();
  }

  // If anything has changed since the last success, recover synchronously
  // inside the current call stack (which is reached from a user gesture in
  // every real call site). This is the same sequence as Mute→Unmute.
  if (engineDirty || !primed) {
    rearmInGesture();
  } else if (s.speaking || s.pending) {
    // Cancel safely; without an audio-session change pending this is fine.
    try { s.cancel(); } catch {}
    stopHeartbeat();
  }

  speakChunks(chunkText(cleaned));
}

export function stopSpeech() {
  const s = synth();
  if (!s) return;
  try { s.cancel(); } catch {}
  stopHeartbeat();
}
