import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/ui/Button";
import { useAuth } from "../auth/AuthContext";

// PUBLIC_INTERFACE
export default function Register() {
  /** Registration screen with name/email/password and auto-login on success. */
  const { register, error } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await register(form);
      navigate("/dashboard");
    } catch {
      // handled in context
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-logo">◎</div>
          <h2>Create your account</h2>
          <p className="muted">Join to access the dashboard</p>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>
            <span>Name</span>
            <input type="text" required value={form.name} onChange={(e)=>setForm({...form, name: e.target.value})} placeholder="Jane Doe" />
          </label>
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
            {loading ? "Creating account..." : "Create account"}
          </Button>
        </form>
        <div className="auth-footer">
          <span className="muted">Already have an account?</span> <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
