// src/inspect/index.ts
function logger(out = (l) => console.log(l)) {
  return (mw, next) => {
    next();
    if (mw.changed) {
      out(`[${mw.event.type}] ${mw.prev.value} \u2192 ${mw.next.value}`, mw);
    }
  };
}
function persist(opts) {
  return (mw, next) => {
    next();
    if (mw.changed) {
      opts.storage.setItem(opts.key, JSON.stringify(mw.next));
    }
  };
}
function recorder(sink) {
  return (mw, next) => {
    next();
    sink.push({
      event: mw.event,
      prev: mw.prev,
      next: mw.next,
      changed: mw.changed
    });
  };
}

export { logger, persist, recorder };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map