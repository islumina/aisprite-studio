import { UnknownGuardError, isThenable, AsyncGuardError } from '../chunk-A7U7QQL5.js';
import '../chunk-PZ5AY32C.js';

// src/guards/index.ts
function resolveItem(item, args) {
  const fn = typeof item === "function" ? item : args.guards?.[item];
  if (!fn) throw new UnknownGuardError(item);
  const result = fn(args);
  if (isThenable(result)) {
    throw new AsyncGuardError(typeof item === "string" ? item : fn.name || "<inline>");
  }
  return result;
}
function and(items) {
  return (args) => {
    for (const item of items) {
      if (!resolveItem(item, args)) return false;
    }
    return true;
  };
}
function or(items) {
  return (args) => {
    for (const item of items) {
      if (resolveItem(item, args)) return true;
    }
    return false;
  };
}
function not(item) {
  return (args) => !resolveItem(item, args);
}
function stateIn(...states) {
  const set = new Set(states);
  return ({ value }) => typeof value === "string" && set.has(value);
}

export { and, not, or, stateIn };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map