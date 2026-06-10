export function Logo({ className = "" }: { className?: string }) {
  // Custom monogram: clean solid "Z" inside a rounded square. No accent lines.
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      aria-label="ZooTown"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="1" width="38" height="38" rx="9" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M11 12 H29 L12 28 H29"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  // The TopBar renders its own "Missoula, MT" pill next to the wordmark,
  // so we keep the wordmark itself clean — monogram + name only.
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <Logo className="h-8 w-8 text-foreground" />
      <span className="font-serif text-[1.25rem] font-semibold tracking-tight text-foreground leading-none">
        ZooTown
      </span>
    </div>
  );
}
