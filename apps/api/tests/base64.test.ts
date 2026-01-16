import { describe, expect, it } from 'vitest';

import { base64UrlDecode, base64UrlEncode } from '../src/utils/base64';

describe('base64UrlEncode', () => {
  it('encodes empty array', () => {
    const result = base64UrlEncode(new Uint8Array([]));
    expect(result).toBe('');
  });

  it('encodes simple data', () => {
    const data = new TextEncoder().encode('hello');
    const result = base64UrlEncode(data);
    expect(result).toBe('aGVsbG8');
  });

  it('produces URL-safe output without + / or =', () => {
    // Create data that would produce + and / in standard base64
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      data[i] = i;
    }
    const encoded = base64UrlEncode(data);

    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('replaces + with -', () => {
    // 0xfb encodes to include + in standard base64
    const data = new Uint8Array([0xfb, 0xff]);
    const encoded = base64UrlEncode(data);
    expect(encoded).toContain('-');
    expect(encoded).not.toContain('+');
  });

  it('replaces / with _', () => {
    // 0xff, 0xfe produces / in standard base64
    const data = new Uint8Array([0xff, 0xff]);
    const encoded = base64UrlEncode(data);
    expect(encoded).toContain('_');
    expect(encoded).not.toContain('/');
  });
});

describe('base64UrlDecode', () => {
  it('decodes empty string', () => {
    const result = base64UrlDecode('');
    expect(result.length).toBe(0);
  });

  it('decodes simple data', () => {
    const result = base64UrlDecode('aGVsbG8');
    const text = new TextDecoder().decode(result);
    expect(text).toBe('hello');
  });

  it('handles URL-safe characters (- and _)', () => {
    // First encode with standard chars, then convert manually to test decode
    const original = new Uint8Array([0xfb, 0xff, 0xff, 0xfe]);
    const encoded = base64UrlEncode(original);

    const decoded = base64UrlDecode(encoded);
    expect(decoded).toEqual(original);
  });

  it('handles missing padding', () => {
    // 'aGVsbG8' should work without padding (would be 'aGVsbG8=' with padding)
    const result = base64UrlDecode('aGVsbG8');
    expect(new TextDecoder().decode(result)).toBe('hello');
  });
});

describe('base64Url roundtrip', () => {
  it('roundtrips correctly for various lengths', () => {
    for (const length of [0, 1, 2, 3, 4, 5, 16, 32, 64, 65, 100, 255]) {
      const original = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        original[i] = i % 256;
      }

      const encoded = base64UrlEncode(original);
      const decoded = base64UrlDecode(encoded);

      expect(decoded).toEqual(original);
    }
  });

  it('roundtrips binary data with all byte values', () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      original[i] = i;
    }

    const encoded = base64UrlEncode(original);
    const decoded = base64UrlDecode(encoded);

    expect(decoded).toEqual(original);
  });

  it('roundtrips random-like data', () => {
    // Pseudo-random pattern to test various byte combinations
    const original = new Uint8Array(128);
    let seed = 12345;
    for (let i = 0; i < 128; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      original[i] = seed % 256;
    }

    const encoded = base64UrlEncode(original);
    const decoded = base64UrlDecode(encoded);

    expect(decoded).toEqual(original);
  });
});
