// WhatsApp deep-link button (opens WhatsApp with the intro pre-filled to the lead).
// `href` is a wa.me link built server-side via buildWhatsappLink(); this is a
// plain <a>, so it works in server components with no client JS.

function WaIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M17.47 14.38c-.29-.15-1.7-.84-1.96-.93-.26-.1-.45-.15-.64.14-.19.29-.74.93-.9 1.12-.17.19-.33.21-.62.07-.29-.15-1.22-.45-2.33-1.44-.86-.77-1.44-1.72-1.61-2.01-.17-.29-.02-.45.13-.59.13-.13.29-.34.44-.51.15-.17.19-.29.29-.48.1-.19.05-.36-.02-.51-.07-.14-.64-1.54-.88-2.11-.23-.55-.46-.48-.64-.49l-.55-.01c-.19 0-.5.07-.76.36-.26.29-1 .98-1 2.38 0 1.4 1.02 2.76 1.16 2.95.14.19 2.01 3.07 4.87 4.31.68.29 1.21.47 1.62.6.68.22 1.3.19 1.79.11.55-.08 1.7-.69 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.26-.19-.55-.34zM12.02 2C6.5 2 2.02 6.48 2.02 12c0 1.77.46 3.42 1.28 4.86L2 22l5.27-1.38A9.94 9.94 0 0 0 12.02 22c5.52 0 10-4.48 10-10s-4.48-10-10-10z" />
    </svg>
  );
}

export function WhatsappButton({ href, prominent = false }: { href: string; prominent?: boolean }) {
  return prominent ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] hover:bg-[#20bd5a] text-white font-medium px-4 py-2 text-sm shadow-sm transition-colors"
    >
      <WaIcon /> Message on WhatsApp
    </a>
  ) : (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Send intro on WhatsApp"
      className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366]/12 hover:bg-[#25D366]/25 text-[#128C7E] font-medium px-2.5 py-1 text-xs transition-colors"
    >
      <WaIcon className="w-3.5 h-3.5" /> WhatsApp
    </a>
  );
}
