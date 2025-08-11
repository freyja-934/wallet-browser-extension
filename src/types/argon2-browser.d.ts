declare module 'argon2-browser' {
  export enum ArgonType {
    Argon2d = 0,
    Argon2i = 1,
    Argon2id = 2
  }
  
  export interface ArgonOptions {
    pass: string;
    salt: Uint8Array;
    time: number;
    mem: number;
    parallelism: number;
    hashLen: number;
    type: ArgonType;
  }
  
  export interface ArgonResult {
    hash: Uint8Array;
    hashHex: string;
    encoded: string;
  }
  
  export function hash(options: ArgonOptions): Promise<ArgonResult>;
}
