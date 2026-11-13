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
export type VoiceLike = { name: string; lang: string; localService?: boolean; default?: boolean; voiceURI?: string };
/** One line: its key (for recordings and clips) and its text, or several texts spoken as separate parts with gaps. */
export type Line = [key: string, text: string | string[]];
export declare const SPEECH: { rate: number; pitch: number; gapMs: number };
/** Premium, then Enhanced, then Chrome's Google US English / UK English Female, then a local en-US/en-GB voice; English only; null = browser default. */
export declare function pickVoice<V extends VoiceLike>(voices: V[]): V | null;
// say resolves when a clip/recording has played (play() resolved), and when speech ends (or is superseded/stopped).
// sayAll says lines in order with SPEECH.gapMs between them; onLine(key) is called as each line starts.
export declare function createVoice(o: VoiceOptions): {
  say(key: string, text: string | string[]): Promise<void>;
  sayAll(lines: Line[], onLine?: (key: string) => void): Promise<void>;
  stop(): void;
};
