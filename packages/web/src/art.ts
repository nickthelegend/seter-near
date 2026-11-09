// Generated 3D art lands in public/art as mienai-gen-<subject>.webp; until a file exists the page uses the
// nearest existing Mienai art, never a broken image.
const files = __ART__;
const FALLBACK: Record<string, string> = {
  enclave: 'mienai-feature-enclave.webp', envelope: 'mienai-hero.webp', slip: 'mienai-og.webp', 'slip-fired': 'mienai-og.webp',
  camera: 'mienai-feature-tripwire.webp', seal: 'mienai-hero.webp', tripwire: 'mienai-feature-tripwire.webp', whale: 'mienai-hero.webp',
};
export function art(subject: keyof typeof FALLBACK | string, fallback?: string): { src: string; generated: boolean } {
  const hit = files.find((f) => f === `mienai-gen-${subject}.webp`) ?? files.find((f) => f.startsWith(`mienai-gen-${subject}.`));
  return hit ? { src: `/art/${hit}`, generated: true } : { src: `/art/${fallback ?? FALLBACK[subject] ?? 'mienai-hero.webp'}`, generated: false };
}
