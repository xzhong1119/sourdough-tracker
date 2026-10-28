import { useState } from "react";
import { supabase } from "./supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function signIn(e) {
    e.preventDefault();
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  return (
    <main className="app">
      <div className="card login">
        <h1>Sourdough Log</h1>
        <p className="muted">Sign in to see your bakes.</p>
        <form onSubmit={signIn} className="fields">
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn primary block">Sign in</button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </main>
  );
}
