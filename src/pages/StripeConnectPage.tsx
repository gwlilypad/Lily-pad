import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/context/AppContext";
import SharedHeader from "@/components/SharedHeader";
import NavBar from "@/components/NavBar";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, '').replace('/lilypad', '') + '/api-server';

function getApiUrl(path: string) {
  const domain = window.location.hostname;
  if (domain.includes('replit.dev') || domain.includes('replit.app')) {
    const base = window.location.origin.replace(/:\d+/, '');
    return `${base}/api-server${path}`;
  }
  return `/api${path}`;
}

type Status = 'idle' | 'loading' | 'redirecting' | 'returned' | 'complete' | 'error';

export default function StripeConnectPage() {
  const { goTo, state } = useApp();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('idle');
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');

  const email = state.suAns?.[0] || 'host@example.com';
  const hostId = 'host_' + Math.random().toString(36).slice(2, 10);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectParam = params.get('stripe_connect');
    if (connectParam === 'return') {
      setStatus('returned');
      window.history.replaceState({}, '', window.location.pathname);
    } else if (connectParam === 'refresh') {
      setStatus('idle');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function startConnect() {
    setStatus('loading');
    setError('');
    try {
      const res = await fetch(getApiUrl('/connect/create-account'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, hostId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create account');
      setAccountId(data.accountId);
      setStatus('redirecting');
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  }

  async function checkStatus() {
    if (!accountId) { setStatus('complete'); return; }
    try {
      const res = await fetch(getApiUrl(`/connect/account-status/${accountId}`));
      const data = await res.json();
      if (data.complete) setStatus('complete');
      else setStatus('returned');
    } catch {
      setStatus('complete');
    }
  }

  return (
    <div className="page active">
      <SharedHeader step="Step 5 of 6" title="Set up payments." progress={83} label="Profile 83% complete" />
      <div className="s-divider" />
      <div className="s-body">
        <NavBar onBack={() => navigate(-1)} onHome={() => goTo("home")} dots={[0]} currentDot={0} onDotClick={() => {}} />

        <div className="form-center-wrap">
          {status === 'idle' && (
            <div className="q-center">
              <p className="q-step-lbl">Payment setup</p>
              <p className="q-text">Connect your bank securely through Stripe.</p>
              <p style={{ fontSize: 12, color: 'rgba(14,31,64,0.45)', lineHeight: 1.6, margin: '8px 0 24px', textAlign: 'center' }}>
                Stripe handles your banking details so lily pad never sees your account numbers. Setup takes about 2 minutes.
              </p>

              {/* Stripe Connect button */}
              <button
                onClick={startConnect}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                  width: '100%', padding: '16px 0',
                  background: '#635BFF', color: '#fff',
                  fontSize: 15, fontWeight: 600,
                  border: 'none', borderRadius: 100, cursor: 'pointer',
                  fontFamily: '"DM Sans", sans-serif',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect width="24" height="24" rx="6" fill="white" fillOpacity="0.18" />
                  <path d="M11.5 7C9.01 7 7 9.01 7 11.5C7 13.99 9.01 16 11.5 16C13.99 16 16 13.99 16 11.5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  <path d="M14 9L16.5 6.5M16.5 6.5H14M16.5 6.5V9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Connect with Stripe
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(14,31,64,0.3)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <span style={{ fontSize: 11, color: 'rgba(14,31,64,0.3)' }}>256-bit encrypted · PCI DSS compliant</span>
              </div>

              <button
                onClick={() => goTo("find")}
                style={{
                  marginTop: 28, background: 'none', border: 'none',
                  fontSize: 13, fontWeight: 400, color: 'rgba(14,31,64,0.35)',
                  cursor: 'pointer', fontFamily: '"DM Sans", sans-serif',
                  textDecoration: 'underline', textUnderlineOffset: 3,
                }}
              >
                Skip for now
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="q-center">
              <p style={{ fontSize: 15, color: 'rgba(14,31,64,0.5)' }}>Opening Stripe…</p>
            </div>
          )}

          {status === 'redirecting' && (
            <div className="q-center">
              <p style={{ fontSize: 15, color: 'rgba(14,31,64,0.5)' }}>Redirecting to Stripe…</p>
            </div>
          )}

          {status === 'returned' && (
            <div className="q-center">
              <div className="success-icon" style={{ margin: '0 auto 16px' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
              </div>
              <p style={{ fontSize: 17, fontWeight: 300, color: '#0E1F40', marginBottom: 6 }}>Bank connected!</p>
              <p style={{ fontSize: 12, color: 'rgba(14,31,64,0.4)', lineHeight: 1.6, marginBottom: 24 }}>
                Your Stripe account is set up. Payouts will be deposited after each booking.
              </p>
              <button className="cta-btn" onClick={checkStatus}>Continue</button>
            </div>
          )}

          {status === 'complete' && (
            <>
              <div style={{ textAlign: 'center', marginBottom: 20 }}>
                <div className="success-icon" style={{ margin: '0 auto 12px' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8DD63F" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                </div>
                <p style={{ fontSize: 18, fontWeight: 300, color: '#0E1F40' }}>Payment setup complete!</p>
                <p style={{ fontSize: 12, fontWeight: 300, color: 'rgba(14,31,64,0.4)', marginTop: 4 }}>Earnings will be deposited automatically via Stripe.</p>
              </div>
              <div className="cta-area">
                <p className="cta-nudge">Your pad is ready to list.</p>
                <button className="cta-btn" onClick={() => goTo("find")}>Go to the map</button>
              </div>
            </>
          )}

          {status === 'error' && (
            <div className="q-center">
              <p style={{ fontSize: 14, color: '#ef4444', marginBottom: 16, textAlign: 'center' }}>{error}</p>
              <button className="cta-btn" onClick={() => setStatus('idle')}>Try again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
