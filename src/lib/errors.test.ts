import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors';

describe('errorMessage', () => {
  it('uses Error.message and optional logs', () => {
    const error = Object.assign(new Error('boom'), { logs: ['a', 'b'] });
    expect(errorMessage(error)).toBe('boom: a | b');
  });

  it('unwraps a string or { message }', () => {
    expect(errorMessage('nope')).toBe('nope');
    expect(errorMessage({ message: 'rpc down' })).toBe('rpc down');
    expect(errorMessage({}, 'fallback')).toBe('fallback');
  });
});
