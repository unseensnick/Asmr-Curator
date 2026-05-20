/** Pure utilities shared by SelectedFilePanel + RenameSection. Kept separate
 *  from `helpers.tsx` so the components module is HMR-friendly (the
 *  react-refresh/only-export-components rule wants single-purpose files).
 */

export const MAX_BYTES = 255;

export function getExt(name: string): string {
    return name.match(/(\.[^.]+)$/)?.[1] ?? "";
}

export function byteLength(str: string): number {
    return new TextEncoder().encode(str).length;
}
