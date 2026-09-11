import { Abstract, Provider, Type } from '@nestjs/common';

export type InjectionToken = Type<unknown> | Abstract<unknown>;

// Use-cases are plain classes (no @Injectable) constructed with `new` -
// this factory helper is the one place that bridges them into Nest's DI
// container, injecting each declared dependency (a port's abstract-class
// token, or another use-case's concrete-class token) and calling
// `new UseCase(...)` explicitly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors
// Nest's own useFactory typing; the deps array is the real type safety
// (each call site's factory signature is checked against its own args).
export function provideUseCase<T>(
  useCase: Type<T>,
  deps: InjectionToken[],
  factory: (...args: any[]) => T,
): Provider {
  return {
    provide: useCase,
    useFactory: factory,
    inject: deps,
  };
}
