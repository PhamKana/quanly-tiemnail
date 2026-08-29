/**
 * Premium Web Audio API Chime synthesizer
 * This utility acts as the reception desk active-screen bell signaling incoming appointments.
 * It is non-redundant and crucial for high ambient noise salon environments:
 * 1. Native background notifications only play sounds if browser permissions are granted and the user is locked/idle.
 * 2. This synthesizer provides immediate, sub-millisecond acoustic feedback to active front-desk operators.
 * 3. It utilizes pure synthesized sine/triangle waves instead of bulky sound assets, preserving offline-friendliness.
 */
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!sharedCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        sharedCtx = new AudioContextClass();
      }
    }
    // If browser auto-suspended, try to resume
    if (sharedCtx && sharedCtx.state === 'suspended') {
      sharedCtx.resume().catch(() => {});
    }
    return sharedCtx;
  } catch (e) {
    console.warn("Shared AudioContext not supported on this platform", e);
    return null;
  }
}

// Automatically bind interaction listeners to unlock the audio context proactively
if (typeof window !== 'undefined') {
  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    // Remove listeners once unlocked
    window.removeEventListener('click', unlock);
    window.removeEventListener('touchstart', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('click', unlock, { passive: true });
  window.addEventListener('touchstart', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

export function playLoudNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    // Trigger ding-dong sound with rich overlay of carrier waves
    const playTone = (frequency: number, startTime: number, duration: number, volume: number) => {
      // Create oscillator for sweet fundamental sine tone
      const osc1 = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(frequency, startTime);
      
      // Create a triangle oscillator slightly offset to add rich, warm, chime-like timbre
      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(frequency * 2.002, startTime); // Harmonic overtone
      
      // Gain envelope
      gainNode.gain.setValueAtTime(0.001, startTime);
      gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.04);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      
      // Connect
      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc1.start(startTime);
      osc1.stop(startTime + duration + 0.1);
      
      osc2.start(startTime);
      osc2.stop(startTime + duration + 0.1);
    };

    // Ensure state is running
    if (ctx.state === 'suspended') {
      ctx.resume().then(() => {
        const now = ctx.currentTime;
        playTone(659.25, now, 0.5, 0.45); // DING: E
        playTone(523.25, now + 0.22, 0.7, 0.5); // DONG: C
        playTone(1046.50, now + 0.12, 0.3, 0.25); // Sparkle
      }).catch(err => {
        console.warn("Could not resume AudioContext during play", err);
      });
    } else {
      const now = ctx.currentTime;
      playTone(659.25, now, 0.5, 0.45); // DING: E
      playTone(523.25, now + 0.22, 0.7, 0.5); // DONG: C
      playTone(1046.50, now + 0.12, 0.3, 0.25); // Sparkle
    }
    
  } catch (err) {
    console.warn("Failed to generate custom notification audio chime via Web Audio API", err);
  }
}
