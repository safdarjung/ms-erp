// Presentational download link: a ghost-button <a download> with a small download
// glyph. Server-safe (no 'use client'), so it drops straight into list pages.

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5" aria-hidden>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function ExportLink({ href, label = 'Export CSV' }: { href: string; label?: string }) {
  return (
    <a href={href} download className="btn-ghost text-xs">
      <DownloadIcon />{label}
    </a>
  );
}
