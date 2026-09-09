import { Buffer as NodeBuffer } from 'buffer';

Object.assign(globalThis, { Buffer: NodeBuffer });
