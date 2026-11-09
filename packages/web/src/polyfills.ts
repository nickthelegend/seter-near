import { Buffer } from 'buffer';
const g = globalThis as unknown as { Buffer?: typeof Buffer; global?: unknown };
g.Buffer ??= Buffer;
g.global ??= globalThis;
