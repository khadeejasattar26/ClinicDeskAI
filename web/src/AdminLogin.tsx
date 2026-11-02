import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { DEMO_MODE } from './api';
import { Brand, Icon } from './Icon';
import styles from './Admin.module.css';
export function AdminLogin() {
  const auth = useAuth(); const navigate = useNavigate();
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (!auth.ready) return <main className={styles.loading} role="status">Checking your session…</main>;
  if (auth.token) return <Navigate to="/admin" replace/>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const values = new FormData(event.currentTarget);
    try { await auth.signIn(String(values.get('email')), String(values.get('password'))); navigate('/admin'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to sign in'); }
    finally { setBusy(false); }
  }
  return <main id="main-content" className={styles.loginPage}><Link to="/" className={styles.loginBrand}><Brand/></Link><div className={styles.loginCard}><p className={styles.eyebrow}>A LITTLE SPACE FOR YOUR TEAM</p><h1>Welcome <em>back.</em></h1><p>Keep the day running smoothly.<br/>Your clinic, all in one place.</p><form onSubmit={submit}><label>Email address<input name="email" type="email" required autoComplete="username" placeholder="you@yourclinic.com"/></label><label>Password<input name="password" type="password" required autoComplete="current-password"/></label>{error && <p className={styles.error} role="alert">{error}</p>}<button className={styles.primary} disabled={busy}>{busy ? 'Signing in…' : 'Sign in to your clinic'}<Icon name="arrow" size={18}/></button></form>{DEMO_MODE && <div className={styles.demoLogin}><span>Exploring the portfolio?</span><button onClick={() => { auth.demoLogin(); navigate('/admin'); }}>Open local demo dashboard <Icon name="arrow" size={15}/></button><small>Uses local demo data. No account needed.</small></div>}<Link to="/" className={styles.back}>← Back to the clinic</Link></div><span className={styles.loginFooter}>CAREWELL RECEPTION · POWERED BY CLINICDESK AI</span></main>;
}
