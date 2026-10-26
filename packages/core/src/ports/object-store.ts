/** Blob-style storage for events, clips, builds and audit archives. Keys are `/`-separated. */
export interface ObjectStore {
  put(key: string, body: string): Promise<void>;
  get(key: string): Promise<string | undefined>;
  /** Keys under `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}
