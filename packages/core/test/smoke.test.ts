import { describe, expect, it } from 'vitest';

describe('@studio/core', () => {
  it('resolves as a package', async () => {
    const mod = await import('@studio/core');
    expect(mod).toBeDefined();
  });
});
