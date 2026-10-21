import { describe, expect, it } from 'vitest';
import { describeProp, validate, type ObjectSchema } from '../demo/debug/schema';

const schema: ObjectSchema = {
  type: 'object',
  properties: {
    phase: { type: 'number', minimum: 0, maximum: 1, description: 'Time of day.' },
    frames: { type: 'integer', minimum: 1, description: 'How many.' },
    glow: { type: 'boolean', description: 'Halo.' },
    view: { type: 'string', enum: ['final', 'raw'], description: 'What to draw.' },
  },
  required: ['view'],
  additionalProperties: false,
};

const fail = (args: unknown) => {
  const r = validate(schema, args);
  if (r.ok) throw new Error(`expected a failure for ${JSON.stringify(args)}`);
  return r;
};

describe('validate', () => {
  it('accepts valid args and returns them', () => {
    expect(validate(schema, { view: 'raw' })).toEqual({ ok: true, value: { view: 'raw' } });
    const all = { view: 'final', phase: 1, frames: 3, glow: false };
    expect(validate(schema, all)).toEqual({ ok: true, value: all });
    expect(validate(schema, { view: 'raw', phase: 0 })).toEqual({ ok: true, value: { view: 'raw', phase: 0 } });
  });

  it('treats missing args as an empty object', () => {
    const open: ObjectSchema = { type: 'object', properties: {}, additionalProperties: false };
    expect(validate(open, undefined)).toEqual({ ok: true, value: {} });
    expect(validate(open, null)).toEqual({ ok: true, value: {} });
    expect(fail(undefined)).toMatchObject({ path: 'args.view' });
  });

  it('rejects args that are not a plain object', () => {
    for (const args of [1, 'x', [], true]) expect(fail(args)).toMatchObject({ path: 'args' });
  });

  it('names the offending path', () => {
    expect(fail({ view: 'raw', phase: 2 })).toEqual({
      ok: false,
      path: 'args.phase',
      message: 'args.phase: must be at most 1, got 2',
    });
    expect(fail({ view: 'raw', phase: -1 }).message).toBe('args.phase: must be at least 0, got -1');
    expect(fail({ view: 'raw', phase: '0.5' }).message).toBe('args.phase: must be a number, got string');
    expect(fail({ view: 'raw', phase: NaN }).message).toBe('args.phase: must be a finite number, got NaN');
    expect(fail({ view: 'raw', frames: 1.5 }).message).toBe('args.frames: must be an integer, got 1.5');
    expect(fail({ view: 'raw', frames: 0 }).path).toBe('args.frames');
    expect(fail({ view: 'raw', glow: 1 }).message).toBe('args.glow: must be a boolean, got number');
    expect(fail({ view: 'wire' }).message).toBe('args.view: must be one of "final", "raw", got "wire"');
    expect(fail({ view: 3 }).message).toBe('args.view: must be one of "final", "raw", got 3');
    expect(fail({}).message).toBe('args.view: is required');
    expect(fail({ view: 'raw', nope: 1 }).message).toBe('args.nope: is not an argument of this tool (phase, frames, glow, view)');
  });

  it('ignores properties set to undefined', () => {
    expect(validate(schema, { view: 'raw', phase: undefined })).toEqual({ ok: true, value: { view: 'raw' } });
  });
});

describe('describeProp', () => {
  it('summarises a property for help text', () => {
    expect(describeProp(schema.properties.phase)).toBe('number 0…1');
    expect(describeProp(schema.properties.frames)).toBe('integer ≥ 1');
    expect(describeProp(schema.properties.glow)).toBe('boolean');
    expect(describeProp(schema.properties.view)).toBe('"final" | "raw"');
    expect(describeProp({ type: 'number', maximum: 5, default: 2, description: '' })).toBe('number ≤ 5, default 2');
    expect(describeProp({ type: 'number', default: 1 / 60, description: '' })).toBe('number, default 0.01667');
  });
});
