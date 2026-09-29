// src/fsm/evaluator.ts
var UnknownGuardError = class extends Error {
  guardName;
  constructor(guardName) {
    super(`aifsmjs: guard "${guardName}" not found in implementations.guards`);
    this.name = "UnknownGuardError";
    this.guardName = guardName;
  }
};
var AsyncGuardError = class extends Error {
  guardName;
  constructor(guardName) {
    super(
      `aifsmjs: guard "${guardName}" must be sync; received a Promise. Async guards break determinism and replay. Move I/O into an effect.`
    );
    this.name = "AsyncGuardError";
    this.guardName = guardName;
  }
};
function isAsyncGuardFn(fn) {
  if (typeof fn !== "function") return false;
  return fn.constructor?.name === "AsyncFunction";
}
function isThenable(x) {
  return x !== null && (typeof x === "object" || typeof x === "function") && typeof x.then === "function";
}
function ownValue(map, key) {
  return map !== void 0 && Object.hasOwn(map, key) ? map[key] : void 0;
}
function resolveGuard(ref, impl) {
  if (typeof ref === "function") return ref;
  const fn = ownValue(impl.guards, ref);
  if (!fn) throw new UnknownGuardError(ref);
  return fn;
}
function evalGuard(ref, context, event, impl, value) {
  const fn = resolveGuard(ref, impl);
  const guardName = typeof ref === "string" ? ref : fn.name || "<inline>";
  if (isAsyncGuardFn(fn)) {
    throw new AsyncGuardError(guardName);
  }
  const args = { context, event };
  const guardsMap = impl.guards;
  if (guardsMap) args.guards = guardsMap;
  if (value !== void 0) args.value = value;
  const result = fn(args);
  if (isThenable(result)) {
    throw new AsyncGuardError(guardName);
  }
  return result;
}

export { AsyncGuardError, UnknownGuardError, evalGuard, isAsyncGuardFn, isThenable, ownValue, resolveGuard };
//# sourceMappingURL=chunk-SSNKGEVB.js.map
//# sourceMappingURL=chunk-SSNKGEVB.js.map