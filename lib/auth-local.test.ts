import { describe, expect, it } from 'vitest';

import { trustedLocal } from './auth';

// As the dev server hands a request on: the URL on 0.0.0.0, the caller's address in x-forwarded-for.
const dev = (caller: string, host = 'localhost:3250', more: Record<string, string> = {}) =>
  new Request('http://0.0.0.0:3250/api/lists?profile=dk', { headers: { 'x-forwarded-for': caller, 'x-forwarded-host': host, host, ...more } });

describe('no passwords on the dev server, from this machine only', () => {
  it('trusts the dev server reached from this machine', () => {
    expect(trustedLocal(dev('127.0.0.1'), 'development')).toBe(true);
    expect(trustedLocal(dev('::1', '[::1]:3250'), 'development')).toBe(true);
    expect(trustedLocal(dev('::ffff:127.0.0.1', '127.0.0.1:3250'), 'development')).toBe(true);
    expect(trustedLocal(new Request('http://localhost:3250/api/lists'), 'development')).toBe(true);
  });

  it('never trusts a production build, as the Pi runs', () => {
    expect(trustedLocal(dev('127.0.0.1'), 'production')).toBe(false);
    expect(trustedLocal(dev('127.0.0.1'), undefined)).toBe(false);
  });

  it('never trusts another device, or anything through a proxy', () => {
    expect(trustedLocal(dev('192.168.1.20', '192.168.1.5:3250'), 'development')).toBe(false);
    expect(trustedLocal(dev('192.168.1.20'), 'development')).toBe(false);
    expect(trustedLocal(dev('1.2.3.4, 127.0.0.1'), 'development')).toBe(false);
    expect(trustedLocal(dev('127.0.0.1', 'mtg.example.com'), 'development')).toBe(false);
  });
});
