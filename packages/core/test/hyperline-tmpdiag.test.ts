import { expect, it } from 'vitest';
import { createCourse, extendCourse } from '../../../games/hyperline/lib/course.js';

it('crumble panels are deterministic per seed', () => {
  const a = createCourse(5), b = createCourse(5);
  extendCourse(a, 2600); extendCourse(b, 2600);
  const pick = (c: typeof a) => c.objs.filter((o) => o.c).map((o) => [o.x, o.w, o.glow, o.drop]);
  expect(pick(a).length).toBeGreaterThan(0);
  expect(pick(a)).toEqual(pick(b));
});
