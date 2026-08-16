import { login } from "./actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">AT</div>
        <p className="eyebrow">OPERATOR ACCESS</p>
        <h1>Agent Treasury</h1>
        <p className="login-copy">
          Sign in to review machine initiated test payment requests.
        </p>
        <form action={login}>
          <label htmlFor="password">Demo operator password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          {params.error ? (
            <p className="form-error" role="alert">
              The password is incorrect.
            </p>
          ) : null}
          <button type="submit">Enter control room</button>
        </form>
        <small>Stripe sandbox only. No real funds move through this project.</small>
      </section>
    </main>
  );
}
