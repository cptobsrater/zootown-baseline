export function Logo({ className = "" }: { className?: string }) {
  // Custom monogram: "Z" with a mountain horizon — Missoula / ZooTown identity.
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-label="ZooTown"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="38" height="38" rx="9" stroke="currentColor" strokeWidth="1.5" />
      {/* Z stroke */}
      <path
        d="M11 12 H29 L12 27 H29"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      {/* Mountain mark (accent) */}
      <path
        d="M8 31 L16 23 L22 27 L28 21 L32 31"
        stroke="hsl(var(--primary))"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <Logo className="h-8 w-8 text-foreground" />
      <div className="flex flex-col leading-none">
        <span className="font-serif text-[1.15rem] font-semibold tracking-tight text-foreground">
          ZooTown
        </span>
        <span className="mt-0.5 font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
          Missoula · MT
        </span>
      </div>
    </div>
  );
}
