let primed = false;

export function primeSpeech() {
  if (primed) return;
  try {
    const u = new SpeechSynthesisUtterance("");
    window.speechSynthesis.speak(u);
    primed = true;
  } catch {}
}

export function speak(text: string) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
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
