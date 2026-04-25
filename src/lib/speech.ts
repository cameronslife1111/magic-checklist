let primed = false;

const STORAGE_KEY = "speech-muted";

let muted = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
})();

export function isMuted() {
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {}
  if (v) {
    try {
      window.speechSynthesis?.cancel();
    } catch {}
  }
}

export function primeSpeech() {
  if (primed) return;
  if (muted) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(u);
    primed = true;
  } catch {}
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

export function speak(text: string) {
  if (muted) return;
  if (!("speechSynthesis" in window)) return;
  const cleaned = stripEmojis(text);
  try {
    window.speechSynthesis.cancel();
    if (!cleaned) return;
    const u = new SpeechSynthesisUtterance(cleaned);
    u.rate = 1;
    u.pitch = 1;
    window.speechSynthesis.speak(u);
  } catch {}
}

export function stopSpeech() {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {}
}
