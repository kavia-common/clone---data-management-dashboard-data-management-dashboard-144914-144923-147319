import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import { useAuth } from "../auth/AuthContext";

// PUBLIC_INTERFACE
export default function Login() {
  /** Email/password login screen with error handling and redirect on success. */
  const { login, error } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form);
      navigate("/dashboard");
    } catch {
      // error already handled in context
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">◎</div>
          <h2>Welcome back</h2>
          <p className="muted">Log in to manage your data</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>
            <span>Email</span>
            <input type="email" required value={form.email} onChange={(e)=>setForm({...form, email: e.target.value})} placeholder="you@example.com" />
          </label>
          <label>
            <span>Password</span>
            <input type="password" required value={form.password} onChange={(e)=>setForm({...form, password: e.target.value})} placeholder="••••••••" />
          </label>

          {error && <div className="error">{error}</div>}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <div className="auth-footer">
          <span className="muted">No account?</span> <Link to="/register">Create one</Link>
        </div>
      </div>
    </div>
  );
}
