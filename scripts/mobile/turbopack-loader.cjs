// Turbopack loader for the phone build (see next.config.ts).
//
// - With `replaceWith`, the whole module becomes a re-export of that module.
//   resolveAlias only matches import specifiers, and the desktop server code
//   reaches the database, scheduler and encryption modules through relative
//   imports too, so these modules are swapped by file path instead.
// - Otherwise it drops `import "server-only"`. Next rejects that import in
//   client code with a compile-time check on the import string itself, so
//   aliasing the package is not enough. The phone runs these modules in the
//   WebView on purpose, against the local snapshot.
module.exports = function spentMobileLoader(source) {
  const { replaceWith } = this.getOptions() || {};
  if (replaceWith) {
    return `export * from ${JSON.stringify(replaceWith)};\n`;
  }
  return source.replace(/^import\s+["']server-only["'];?[ \t]*$/m, "");
};
