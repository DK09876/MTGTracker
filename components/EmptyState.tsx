/**
 * What an empty page says: what goes here, and the one thing to do first.
 * A fanned hand of card backs stands in for what is missing, tinted with
 * the page's accent.
 */

export default function EmptyState({ title, children, actions, ...rest }: {
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  'data-tour'?: string;
}) {
  return (
    <div data-tour={rest['data-tour']} className="mx-auto mt-10 flex max-w-md flex-col items-center px-4 text-center sm:mt-16">
      <div aria-hidden className="relative mb-7 h-28 w-40">
        {[-14, 0, 14].map((deg, i) => (
          <span
            key={deg}
            style={{ transform: `rotate(${deg}deg) translateY(${i === 1 ? -6 : 0}px)`, zIndex: i === 1 ? 2 : 1 }}
            className="absolute left-1/2 top-0 -ml-[2.1rem] h-[5.9rem] w-[4.2rem] origin-bottom rounded-[0.45rem] border border-white/10 bg-[linear-gradient(150deg,color-mix(in_srgb,var(--c1)_32%,var(--surface)),var(--surface)_60%,color-mix(in_srgb,var(--c3)_22%,var(--surface)))] shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
          >
            <span className="absolute inset-[5px] rounded-[0.3rem] border border-white/[0.07]" />
          </span>
        ))}
      </div>
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children && <div className="mt-2 text-sm leading-relaxed text-[var(--muted)]">{children}</div>}
      {actions && <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}
