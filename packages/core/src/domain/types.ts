export type Stage = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const STAGE_NAMES = [
  'concept', 'prototype', 'web_test', 'beta', 'soft_launch', 'expansion', 'live_ops', 'sunset',
] as const;
