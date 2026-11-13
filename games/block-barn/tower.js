// The stack of blocks on the barn floor. Reaching max knocks it over (a friendly tumble), then it starts again.
export const TOWER_MAX = 6;

export function createTower(max = TOWER_MAX) {
  let stack = [];
  return {
    blocks: () => [...stack],
    add(letter) {
      stack.push(letter);
      if (stack.length >= max) {
        stack = [];
        return 'tumble';
      }
      return 'added';
    },
    tumble() {
      const held = stack;
      stack = [];
      return held;
    },
  };
}
