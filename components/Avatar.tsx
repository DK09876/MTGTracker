'use client';

/** A round picture from a commander's art, or the name's first letter. */
export default function Avatar({ art, name, size, shine = false }: { art: string | null; name: string; size: number; shine?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--accent)] font-display font-bold text-[#221c08] ${shine ? 'foil-shine' : ''}`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {art ? <img src={art} alt="" className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
    </span>
  );
}
