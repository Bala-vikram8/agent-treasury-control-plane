"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fatal-error">
      <p className="eyebrow">CONTROL ROOM UNAVAILABLE</p>
      <h1>The database request failed.</h1>
      <p>Verify the database connection and migrations, then retry.</p>
      <button type="button" onClick={reset}>Retry</button>
    </main>
  );
}
