export type AudioLike = { play(): Promise<void>; pause(): void };
export type SpeechLike = {
  speak(u: unknown): void;
  cancel(): void;
  getVoices(): unknown[];
  addEventListener?(name: string, fn: () => void, opts?: unknown): void;
  removeEventListener?(name: string, fn: () => void): void;
};
export type VoiceOptions = {
  audio: (url: string) => AudioLike;
  synth: SpeechLike | null;
  recordings: (key: string) => Promise<string | null>;
  base: string;
  utter?: (text: string) => any;
};
// say resolves when a clip/recording starts playing, and when speech ends (or is superseded/stopped).
export declare function createVoice(o: VoiceOptions): { say(key: string, text: string): Promise<void>; stop(): void };
