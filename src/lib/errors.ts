/** Pull a string out of Error, RTK SerializedError, or rejectWithValue. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message.trim()) {
    const logs = (error as Error & { logs?: string[] }).logs;
    if (logs?.length) return `${error.message}: ${logs.slice(-2).join(' | ')}`;
    return error.message;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}
