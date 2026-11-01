export type Rng = ReturnType<typeof createRng>;

// mulberry32: small, fast, and identical across Node versions, which is all a
// reproducible seed needs.
export function createRng(seed: number) {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const chance = (p: number) => next() < p;
  const weighted = <T>(items: readonly T[], weights: readonly number[]): T => {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return items[i]!;
    }
    return items[items.length - 1]!;
  };
  const uuid = () => {
    const hex = Array.from({ length: 16 }, () => int(0, 255).toString(16).padStart(2, "0"));
    hex[6] = ((parseInt(hex[6]!, 16) & 0x0f) | 0x40).toString(16).padStart(2, "0");
    hex[8] = ((parseInt(hex[8]!, 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
    const h = hex.join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const bytes = (n: number) => Buffer.from(Array.from({ length: n }, () => int(0, 255)));
  return { next, int, pick, chance, weighted, uuid, bytes };
}
