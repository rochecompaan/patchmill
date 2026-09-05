type ContractTestAssertion = (...arguments_: readonly any[]) => void;

declare module "node:assert/strict" {
  const assert: {
    deepEqual: ContractTestAssertion;
    doesNotMatch: ContractTestAssertion;
    equal: ContractTestAssertion;
    match: ContractTestAssertion;
    throws: ContractTestAssertion;
  };
  export default assert;
}

declare module "node:test" {
  type TestFunction = () => void | Promise<void>;

  function test(name: string, fn: TestFunction): void;

  export default test;
}

declare module "node:crypto" {
  export type BinaryLike = any;
  export const createHash: (...arguments_: readonly any[]) => any;
}

declare module "node:fs" {
  export const existsSync: (...arguments_: readonly any[]) => any;
  export const statSync: (...arguments_: readonly any[]) => any;
}

declare module "node:path" {
  export const dirname: (...arguments_: readonly any[]) => any;
  export const isAbsolute: (...arguments_: readonly any[]) => any;
  export const join: (...arguments_: readonly any[]) => any;
  export const resolve: (...arguments_: readonly any[]) => any;
  export const win32: any;
}

declare module "node:url" {
  export const fileURLToPath: (...arguments_: readonly any[]) => any;
}
