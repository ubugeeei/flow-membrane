/* @flow strict */

import type {
  Lazy,
  LazyState,
} from "./Types";

type Loader<T> = () => Promise<T>;

function unwrapModule<T>(value: mixed): T {
  if (
    value != null &&
    typeof value === "object" &&
    Object.hasOwn(value as { ... }, "default") &&
    !Object.hasOwn(value as { ... }, "__esModule") &&
    Object.keys(value as { ... }).length === 1
  ) {
    return (value as $FlowFixMe).default as T;
  }
  return value as $FlowFixMe as T;
}

class LazyImpl<T> {
  _loader: Loader<T>;
  _state: LazyState<T> = { status: "idle" };

  constructor(loader: Loader<T>): void {
    this._loader = loader;
  }

  state(): LazyState<T> {
    return this._state;
  }

  peek(): ?T {
    return this._state.status === "loaded" ? this._state.value : null;
  }

  load(): Promise<T> {
    if (this._state.status === "loaded") {
      return Promise.resolve(this._state.value);
    }
    if (this._state.status === "loading") {
      return this._state.promise;
    }
    const promise = Promise.resolve()
      .then(() => this._loader())
      .then(value => {
        const loaded: T = value as $FlowFixMe;
        this._state = { status: "loaded", value: loaded };
        return loaded;
      })
      .catch(error => {
        this._state = { status: "rejected", error };
        throw error;
      });
    this._state = { status: "loading", promise };
    return promise;
  }

  preload(): Promise<T> {
    return this.load();
  }

  read(): T {
    if (this._state.status === "loaded") {
      return this._state.value;
    }
    if (this._state.status === "rejected") {
      throw this._state.error;
    }
    throw this.load();
  }
}

export function lazy<T>(loader: Loader<T>): Lazy<T> {
  const impl = new LazyImpl<T>(async () => {
    const value = await loader();
    return unwrapModule<T>(value);
  });
  return {
    load: () => impl.load(),
    read: () => impl.read(),
    peek: () => impl.peek(),
    preload: () => impl.preload(),
    state: () => impl.state(),
  };
}

export function resolved<T>(value: T): Lazy<T> {
  return {
    load: () => Promise.resolve(value),
    read: () => value,
    peek: () => value,
    preload: () => Promise.resolve(value),
    state: () => ({ status: "loaded", value }),
  };
}
