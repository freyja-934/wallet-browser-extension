// Types for the local run beacon. The module is plain JS and is bundled by Vite;
// declaring it here keeps `tsc --noEmit` (allowJs is off) green.
export declare function install(): void;
export declare function tick(force?: boolean): Promise<void>;
