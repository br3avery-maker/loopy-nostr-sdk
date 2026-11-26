/**
 * Pure, stateless, deterministic schema version migrator.
 * Walks explicit step functions `migrations[currentSchema] -> nextDocument` with cycle protection.
 */
export function migrateSchema(input, { targetSchema, migrations = {}, validate, maxSteps = 32 } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Schema document object required');
  }
  if (typeof input.schema !== 'string' || !input.schema) {
    throw new TypeError('Document must declare a non-empty string schema version');
  }
  if (typeof targetSchema !== 'string' || !targetSchema) {
    throw new TypeError('targetSchema must be a non-empty string');
  }
  if (!migrations || typeof migrations !== 'object' || Array.isArray(migrations)) {
    throw new TypeError('migrations map object required');
  }
  if (validate !== undefined && typeof validate !== 'function') {
    throw new TypeError('validate must be a function');
  }
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 128) {
    throw new RangeError('maxSteps must be an integer between 1 and 128');
  }

  let current = structuredClone(input);
  const from = current.schema;
  const visited = new Set([from]);
  const steps = [];

  while (current.schema !== targetSchema) {
    if (steps.length >= maxSteps) {
      throw new RangeError(`Schema migration exceeded maxSteps (${maxSteps}) from ${from} to ${targetSchema}`);
    }
    const stepFn = Object.hasOwn(migrations, current.schema) ? migrations[current.schema] : null;
    if (typeof stepFn !== 'function') {
      throw new Error(`No migration path from schema "${current.schema}" to "${targetSchema}"`);
    }
    const next = stepFn(structuredClone(current));
    if (!next || typeof next !== 'object' || Array.isArray(next) || typeof next.schema !== 'string' || !next.schema) {
      throw new TypeError(`Migration from "${current.schema}" did not return a valid schema document`);
    }
    if (visited.has(next.schema)) {
      throw new Error(`Cyclic schema migration detected at "${next.schema}"`);
    }
    steps.push({ from: current.schema, to: next.schema });
    visited.add(next.schema);
    current = next;
  }

  if (validate) validate(current);
  return {
    schema: current.schema,
    from,
    to: targetSchema,
    migrated: steps.length > 0,
    steps,
    data: current,
  };
}
