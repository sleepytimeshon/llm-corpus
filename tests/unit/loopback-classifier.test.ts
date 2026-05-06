// T037 — Unit test for loopback classifier (NFR-002a).
// Source of truth: contracts/egress-hook-api.md §"Loopback classification"
//
// Exhaustive table covering: 127.x.x.x → loopback, ::1 → loopback,
// 'localhost' → loopback, '8.8.8.8' → remote, 'example.org' → remote.

import { describe, it, expect } from 'vitest';
import {
  isLoopbackIPv4,
  isLoopbackIPv6,
  classifyHost,
} from '../../packages/transport/src/loopback-classifier.js';

describe('isLoopbackIPv4 (NFR-002a)', () => {
  it('accepts 127.0.0.1 as loopback', () => {
    expect(isLoopbackIPv4('127.0.0.1')).toBe(true);
  });

  it('accepts the entire 127.0.0.0/8 block', () => {
    expect(isLoopbackIPv4('127.0.0.0')).toBe(true);
    expect(isLoopbackIPv4('127.255.255.254')).toBe(true);
    expect(isLoopbackIPv4('127.42.42.42')).toBe(true);
  });

  it('rejects non-loopback IPv4 literals', () => {
    expect(isLoopbackIPv4('8.8.8.8')).toBe(false);
    expect(isLoopbackIPv4('192.168.1.1')).toBe(false);
    expect(isLoopbackIPv4('10.0.0.1')).toBe(false);
    expect(isLoopbackIPv4('128.0.0.1')).toBe(false);
    expect(isLoopbackIPv4('126.255.255.255')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isLoopbackIPv4('127.0.0')).toBe(false);
    expect(isLoopbackIPv4('127')).toBe(false);
    expect(isLoopbackIPv4('localhost')).toBe(false);
    expect(isLoopbackIPv4('::1')).toBe(false);
    expect(isLoopbackIPv4('')).toBe(false);
  });
});

describe('isLoopbackIPv6 (NFR-002a)', () => {
  it('accepts ::1', () => {
    expect(isLoopbackIPv6('::1')).toBe(true);
  });

  it('accepts the long-form 0:0:0:0:0:0:0:1', () => {
    expect(isLoopbackIPv6('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('rejects non-loopback IPv6 literals', () => {
    expect(isLoopbackIPv6('::2')).toBe(false);
    expect(isLoopbackIPv6('2001:db8::1')).toBe(false);
    expect(isLoopbackIPv6('fe80::1')).toBe(false);
  });

  it('rejects malformed and IPv4 input', () => {
    expect(isLoopbackIPv6('127.0.0.1')).toBe(false);
    expect(isLoopbackIPv6('localhost')).toBe(false);
    expect(isLoopbackIPv6('')).toBe(false);
  });
});

describe('classifyHost (NFR-002a)', () => {
  it('classifies IPv4 loopback as loopback', () => {
    expect(classifyHost('127.0.0.1', 80)).toBe('loopback');
    expect(classifyHost('127.0.0.1', 11434)).toBe('loopback'); // Ollama
    expect(classifyHost('127.42.42.42', 443)).toBe('loopback');
  });

  it('classifies IPv6 loopback as loopback', () => {
    expect(classifyHost('::1', 80)).toBe('loopback');
    expect(classifyHost('0:0:0:0:0:0:0:1', 443)).toBe('loopback');
  });

  it('classifies the literal hostname "localhost" as loopback', () => {
    expect(classifyHost('localhost', 80)).toBe('loopback');
    expect(classifyHost('localhost', 11434)).toBe('loopback');
  });

  it('classifies non-loopback IPv4 as remote', () => {
    expect(classifyHost('8.8.8.8', 53)).toBe('remote');
    expect(classifyHost('1.1.1.1', 443)).toBe('remote');
    expect(classifyHost('192.168.1.1', 80)).toBe('remote'); // RFC1918 still remote
  });

  it('classifies non-loopback hostnames as remote', () => {
    expect(classifyHost('example.org', 443)).toBe('remote');
    expect(classifyHost('api.openai.com', 443)).toBe('remote');
    expect(classifyHost('google.com', 443)).toBe('remote');
  });

  it('classifies non-loopback IPv6 as remote', () => {
    expect(classifyHost('2001:db8::1', 443)).toBe('remote');
    expect(classifyHost('fe80::1', 443)).toBe('remote');
  });
});
