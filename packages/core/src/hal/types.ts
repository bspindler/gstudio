// Shared Hal types. Every hal module imports these from here so parallel work agrees on shapes.

/** One seeded, unassisted robot play of one Tidepool level. */
export type PlayResult = {
  won: boolean; movesUsed: number; movesLeft: number; stars: 0 | 1 | 2 | 3;
  shuffles: number; tideTurns: number; rescued: number;
  goalFrac: number; // 0..1, mean over goals of min(got, need) / need at the end
};

export type LevelStats = { n: number; winRate: number; avgMovesLeftFrac: number; avgGoalFrac: number; difficulty: number; errors: string[] };

/** Each measure is 0..100, higher is better. */
export type Measures = Record<string, number>;

export type ScoreReport = {
  game: string; levels: LevelStats[]; measures: Measures; fitness: number;
  hardFailures: string[]; // non-empty means the gate must discard
};
