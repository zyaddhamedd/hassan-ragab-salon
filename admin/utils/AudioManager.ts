/**
 * AudioManager singleton to handle notification sounds with queuing and anti-spam protection.
 */
class AudioManager {
  private static instance: AudioManager;
  private audio: HTMLAudioElement;
  private queue: number = 0;
  private isProcessing: boolean = false;
  private lastPlayTime: number = 0;
  private readonly MIN_GAP_MS = 800;
  private readonly SOUND_URL = 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3';

  private constructor() {
    this.audio = new Audio(this.SOUND_URL);
    this.audio.preload = 'auto'; // Instant loading
    this.audio.volume = 0.4; // Soft, premium level
  }

  public static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  /**
   * Triggers the notification sound. If already playing or recently played,
   * adds to a virtual queue to ensure sequential, spaced-out playback.
   */
  public playNotificationSound() {
    this.queue++;
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.queue <= 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const now = Date.now();
    const timeSinceLastPlay = now - this.lastPlayTime;

    // Enforce minimum gap between sounds for anti-spam
    if (timeSinceLastPlay < this.MIN_GAP_MS) {
      await new Promise(resolve => setTimeout(resolve, this.MIN_GAP_MS - timeSinceLastPlay));
    }

    try {
      // Reset sound to start before playing (if still playing from previous burst)
      this.audio.currentTime = 0;
      await this.audio.play();
      this.lastPlayTime = Date.now();
    } catch (error) {
      console.warn('Audio playback failed (usually due to browser autoplay policy):', error);
    }

    this.queue--;
    // Continue processing the queue
    this.processQueue();
  }
}

export default AudioManager.getInstance();
