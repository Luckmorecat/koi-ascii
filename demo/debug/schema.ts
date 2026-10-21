// The JSON Schema subset tool inputs are declared in, and its validator. Small
// on purpose: an object of typed properties is all a tool takes, and the panel
// generates one control per property type.

export interface NumberProp {
  type: 'number' | 'integer';
  description: string;
  minimum?: number;
  maximum?: number;
  default?: number;
}

export interface BooleanProp {
  type: 'boolean';
  description: string;
  default?: boolean;
}

export interface EnumProp {
  type: 'string';
  enum: readonly string[];
  description: string;
  default?: string;
}

export type PropSchema = NumberProp | BooleanProp | EnumProp;

export interface ObjectSchema {
  type: 'object';
  properties: Record<string, PropSchema>;
  required?: readonly string[];
  additionalProperties: false;
}

export type Validation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; path: string; message: string };

const show = (v: unknown) => (typeof v === 'string' ? JSON.stringify(v) : String(v));

function kind(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Why `v` doesn't fit `prop`, or null when it does. */
function check(prop: PropSchema, v: unknown): string | null {
  switch (prop.type) {
    case 'number':
    case 'integer':
      if (typeof v !== 'number') return `must be a number, got ${kind(v)}`;
      // NaN and Infinity aren't JSON, so no caller can mean them.
      if (!Number.isFinite(v)) return `must be a finite number, got ${v}`;
      if (prop.type === 'integer' && !Number.isInteger(v)) return `must be an integer, got ${v}`;
      if (prop.minimum !== undefined && v < prop.minimum) return `must be at least ${prop.minimum}, got ${v}`;
      if (prop.maximum !== undefined && v > prop.maximum) return `must be at most ${prop.maximum}, got ${v}`;
      return null;
    case 'boolean':
      return typeof v === 'boolean' ? null : `must be a boolean, got ${kind(v)}`;
    case 'string':
      return prop.enum.includes(v as string)
        ? null
        : `must be one of ${prop.enum.map(show).join(', ')}, got ${show(v)}`;
  }
}

/**
 * Checks tool args against `schema`. Missing args (undefined or null) count as
 * `{}`, and properties set to undefined as absent. The first problem found is
 * reported with its path, e.g. `args.phase`.
 */
export function validate(schema: ObjectSchema, args: unknown): Validation {
  const bad = (path: string, why: string): Validation => ({ ok: false, path, message: `${path}: ${why}` });
  if (args === undefined || args === null) args = {};
  if (kind(args) !== 'object') return bad('args', `must be an object, got ${kind(args)}`);
  const value: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(args as Record<string, unknown>)) {
    if (v === undefined) continue;
    const prop = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    const names = Object.keys(schema.properties);
    if (!prop) {
      return bad(`args.${key}`, `is not an argument of this tool${names.length ? ` (${names.join(', ')})` : ''}`);
    }
    const why = check(prop, v);
    if (why) return bad(`args.${key}`, why);
    value[key] = v;
  }
  for (const key of schema.required ?? []) {
    if (!(key in value)) return bad(`args.${key}`, 'is required');
  }
  return { ok: true, value };
}

/** One-line type summary of a property, for help text and tooltips. */
export function describeProp(prop: PropSchema): string {
  let text: string;
  if (prop.type === 'string') {
    text = prop.enum.map(show).join(' | ');
  } else if (prop.type === 'boolean') {
    text = 'boolean';
  } else {
    const { minimum: min, maximum: max } = prop;
    text = prop.type;
    if (min !== undefined && max !== undefined) text += ` ${min}…${max}`;
    else if (min !== undefined) text += ` ≥ ${min}`;
    else if (max !== undefined) text += ` ≤ ${max}`;
  }
  if (prop.default === undefined) return text;
  // 1/60 reads better as 0.01667.
  const def = typeof prop.default === 'number' ? String(Number(prop.default.toPrecision(4))) : show(prop.default);
  return `${text}, default ${def}`;
}
