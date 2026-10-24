export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:text-on-accent"
      >
        Skip to main content
      </a>
      <header className="border-b border-border px-4 py-4">
        <h1 className="text-2xl font-bold">AccessPilot</h1>
      </header>
      <main id="main" tabIndex={-1} className="px-4 py-6">
        <p>Voice-first help for confusing websites.</p>
      </main>
      <footer className="border-t border-border px-4 py-4 text-muted">
        <p>Built at Gator Hack V.</p>
      </footer>
    </>
  );
}
