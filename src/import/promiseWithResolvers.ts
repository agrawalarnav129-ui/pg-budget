/**
 * pdfjs 6 calls Promise.withResolvers, which only exists in Safari/iOS 17.4+ and
 * Chrome 119+. Without this, opening any PDF throws "Promise.withResolvers is not
 * a function" on an older iPhone. Imported for its side effect by both the main
 * thread and the PDF worker shim.
 */
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
  (Promise as unknown as { withResolvers: <T>() => PromiseWithResolvers<T> }).withResolvers = function <T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

export {};
