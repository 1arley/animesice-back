type MockDelegate = Record<string, unknown>;
type MockClient = Record<string, unknown>;

/** Keeps root and interactive clients separate while sharing configurable spies. */
export function createTransactionAwarePrismaMock<T extends MockClient>(
  spies: T,
) {
  let inInteractiveTransaction = false;
  const transaction = Object.fromEntries(
    Object.entries(spies).filter(([key]) => key !== '$transaction'),
  ) as Omit<T, '$transaction'>;
  const root = {} as T;
  const rootGuards: Array<{
    guard: jest.Mock;
    spy: jest.Mock;
    label: string;
  }> = [];

  for (const [key, value] of Object.entries(spies)) {
    if (key === '$transaction') continue;
    if (typeof value === 'function') {
      const spy = value as jest.Mock;
      const guard = jest.fn();
      rootGuards.push({ guard, spy, label: key });
      (root as MockClient)[key] = guard;
      continue;
    }
    if (!value || typeof value !== 'object') {
      (root as MockClient)[key] = value;
      continue;
    }

    const rootDelegate: MockDelegate = {};
    for (const [method, candidate] of Object.entries(value)) {
      if (typeof candidate !== 'function') {
        rootDelegate[method] = candidate;
        continue;
      }
      const spy = candidate as jest.Mock;
      const guard = jest.fn();
      rootGuards.push({ guard, spy, label: `${key}.${method}` });
      rootDelegate[method] = guard;
    }
    (root as MockClient)[key] = rootDelegate;
  }

  const transactionSpy = spies.$transaction as jest.Mock;
  const reset = () => {
    inInteractiveTransaction = false;
    for (const { guard, spy, label } of rootGuards) {
      guard.mockImplementation((...args: unknown[]) => {
        if (inInteractiveTransaction) {
          throw new Error(
            `Root Prisma client call inside interactive transaction: ${label}`,
          );
        }
        return spy(...args);
      });
    }
    const rootTransaction = jest.fn((...args: unknown[]) => {
      if (inInteractiveTransaction) {
        throw new Error(
          'Root Prisma transaction inside interactive transaction',
        );
      }
      return transactionSpy(...args);
    });
    (root as MockClient).$transaction = rootTransaction;
    transactionSpy.mockImplementation(
      async (input: unknown[] | ((tx: Omit<T, '$transaction'>) => unknown)) => {
        if (Array.isArray(input)) return Promise.all(input);
        inInteractiveTransaction = true;
        try {
          return await input(transaction);
        } finally {
          inInteractiveTransaction = false;
        }
      },
    );
  };

  reset();
  return { root, transaction, reset };
}
