// Documentary narration through the browser's speech synthesis, with a preference for a
// measured British voice. Silent (subtitles only) if the platform has no voices.

export class Narrator {
  constructor(settings) {
    this.settings = settings;
    this.voice = null;
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.ok) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        const pref = ['Daniel', 'Arthur', 'Google UK English Male', 'Microsoft Ryan', 'Oliver', 'Malcolm', 'Rishi', 'Serena', 'Google UK English Female'];
        this.voice = pref.map((n) => vs.find((v) => v.name.includes(n))).find(Boolean) || vs.find((v) => v.lang === 'en-GB') || vs.find((v) => v.lang.startsWith('en')) || null;
      };
      pick();
      speechSynthesis.onvoiceschanged = pick;
    }
  }
  // iOS only allows speech after a gesture; call this from one.
  prime() { if (this.ok && !this.primed) { this.primed = true; const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } }
  speak(text, onEnd) {
    if (!this.ok || !this.settings.narration) { if (onEnd) setTimeout(onEnd, Math.max(3500, text.length * 55)); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 0.93; u.pitch = 0.92; u.volume = this.settings.voice ?? 0.9;
    let done = false;
    const finish = () => { if (!done) { done = true; onEnd && onEnd(); } };
    u.onend = finish; u.onerror = finish;
    // Safety net: some browsers never fire onend.
    setTimeout(finish, Math.max(6000, text.length * 95));
    speechSynthesis.speak(u);
  }
  stop() { if (this.ok) speechSynthesis.cancel(); }
}
