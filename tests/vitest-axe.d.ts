import "vitest";

// vitest-axe 0.1.0 ships matcher types for an older Vitest namespace; declare them for the current one.
declare module "vitest" {
  interface Assertion<T> {
    toHaveNoViolations(): T;
  }
  interface AsymmetricMatchersContaining {
    toHaveNoViolations(): void;
  }
}
