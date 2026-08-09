/**
 * A tiny synthesized "pop" — a short pitch-swept oscillator behind a fast
 * attack/decay envelope, built with the Web Audio API rather than an
 * embedded audio file, so there's no binary asset to ship or host. Safe to
 * call from anywhere; silently does nothing if the browser has no
 * `AudioContext` (e.g. some embedded/sandboxed iframe contexts) or blocks
 * autoplay-adjacent audio before any user gesture.
 */
export function playPopSound() {
  try {
    const AudioContextClass =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(180, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(720, context.currentTime + 0.09);

    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.35, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.24);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Audio is a nice-to-have for this animation, never a hard requirement.
  }
}
