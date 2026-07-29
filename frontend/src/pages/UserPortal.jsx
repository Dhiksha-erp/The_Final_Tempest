import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquarePlus, User, Lock, Moon, Sun, Home,
  CheckCircle2, Send, Hash, Inbox, ChevronDown, LifeBuoy
} from 'lucide-react';
import api from '../api';
import '../App.css';

const ISSUE_CATEGORIES = [
  {
    key: "delivery_delay",
    label: "My order hasn't arrived",
    hint: "Your order shows as placed or out for delivery, but it hasn't reached you yet.",
    category: "Delivery Delay"
  },
  {
    key: "missing_item",
    label: "Item(s) missing from my order",
    hint: "You were charged for something that wasn't in the bag.",
    category: "Missing Item"
  },
  {
    key: "damaged",
    label: "Item(s) damaged or spoiled",
    hint: "Something arrived broken, leaking, or past its best.",
    category: "Spoiled/Damaged Goods"
  },
  {
    key: "wrong_item",
    label: "Wrong item(s) delivered",
    hint: "You received something different from what you ordered.",
    category: "Wrong Item Delivered"
  },
  {
    key: "payment",
    label: "Payment or billing issue",
    hint: "Double charge, refund not received, or a failed payment.",
    category: "App/Payment Issue"
  },
  {
    key: "partner",
    label: "Delivery partner behavior",
    hint: "An issue with how your delivery partner treated you.",
    category: "Rude Delivery Partner"
  },
  {
    key: "other",
    label: "Something else",
    hint: "Anything else you'd like us to know.",
    category: "General Feedback"
  }
];

function composeFeedbackText(orderId, category, message) {
  const tags = [];
  if (category && category !== "General Feedback") tags.push(category);
  if (orderId.trim()) tags.push(`Order ${orderId.trim()}`);
  const prefix = tags.length > 0 ? `[${tags.join(" | ")}] ` : "";
  return `${prefix}${message.trim()}`;
}

function UserPortal() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  const [expandedKey, setExpandedKey] = useState(null);
  const [orderId, setOrderId] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lastTicket, setLastTicket] = useState(null);
  const [sessionHistory, setSessionHistory] = useState([]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    try {
      await api.post('/user/login', { username: loginUsername, password: loginPassword });
      setIsAuthenticated(true);
    } catch (err) {
      setLoginError(
        err.response?.status === 401
          ? "Invalid user ID or password."
          : "Could not reach the server. Ensure the backend is running."
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const toggleAccordion = (key) => {
    setSubmitError("");
    setOrderId("");
    setMessage("");
    setExpandedKey(prev => prev === key ? null : key);
  };

  const handleSubmitFeedback = async (e, issue) => {
    e.preventDefault();
    if (!message.trim()) return;
    setIsSubmitting(true);
    setSubmitError("");
    setLastTicket(null);
    try {
      const text = composeFeedbackText(orderId, issue.category, message);
      const res = await api.post('/user/submit-feedback', { text });
      setLastTicket(res.data.ticket_id);
      setSessionHistory(prev => [
        { ticket_id: res.data.ticket_id, category: issue.label, message: message.trim() },
        ...prev
      ]);
      setOrderId("");
      setMessage("");
      setExpandedKey(null);
    } catch (err) {
      setSubmitError("Submission failed. Ensure the backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Login screen ----
  if (!isAuthenticated) {
    return (
      <div className={`login-container ${isDarkMode ? 'dark-theme' : ''}`}>
        <div className="login-card fade-in">
          <div className="login-badge" style={{ background: '#14b8a6', boxShadow: '0 8px 20px -6px rgba(20, 184, 166, 0.5)' }}>
            <LifeBuoy size={32} color="white" />
          </div>
          <h2>User Portal</h2>
          <p>Sign in to access Help &amp; Support</p>
          <form onSubmit={handleLogin}>
            <div className="login-input-group">
              <User size={16} className="login-input-icon" />
              <input
                type="text"
                className="login-input"
                placeholder="User ID"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>
            <div className="login-input-group">
              <Lock size={16} className="login-input-icon" />
              <input
                type="password"
                className="login-input"
                placeholder="Password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {loginError && <div className="login-error">{loginError}</div>}

            <button type="submit" className="login-btn" style={{ background: '#14b8a6' }} disabled={isLoggingIn}>
              {isLoggingIn ? <><span className="loading-spinner"></span> Verifying...</> : 'Sign In'}
            </button>
          </form>

          <div className="login-footer" onClick={() => setIsDarkMode(!isDarkMode)}>
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />} {isDarkMode ? 'Light Mode' : 'Dark Mode'}
          </div>
        </div>
        <Link to="/" className="portal-back-link">
          <Home size={14} /> Back to home
        </Link>
      </div>
    );
  }

  // ---- Portal ----
  return (
    <div className={`user-portal-layout ${isDarkMode ? 'dark-theme' : ''}`}>
      <header className="user-portal-header">
        <div className="user-portal-brand">
          <div className="portal-card-icon portal-card-icon-user" style={{ margin: 0 }}>
            <LifeBuoy size={20} color="white" />
          </div>
          <div>
            <h1>Help &amp; Support</h1>
            <p>How can we help you today?</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link to="/" className="theme-toggle-btn" style={{ textDecoration: 'none' }}>
            <Home size={18} /> Home
          </Link>
          <div className="theme-toggle-btn" onClick={() => setIsDarkMode(!isDarkMode)}>
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            {isDarkMode ? "Light Mode" : "Dark Mode"}
          </div>
        </div>
      </header>

      <main className="user-portal-content">
        <div className="card">
          <h2>What's this about?</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Pick the option that best matches your issue and tell us what happened.
          </p>

          <div className="accordion">
            {ISSUE_CATEGORIES.map(issue => {
              const isOpen = expandedKey === issue.key;
              return (
                <div key={issue.key} className={`accordion-item ${isOpen ? 'expanded' : ''}`}>
                  <button type="button" className="accordion-header" onClick={() => toggleAccordion(issue.key)}>
                    <span>{issue.label}</span>
                    <ChevronDown size={18} className="accordion-chevron" />
                  </button>

                  {isOpen && (
                    <div className="accordion-body">
                      <p className="accordion-hint">{issue.hint}</p>
                      <form onSubmit={(e) => handleSubmitFeedback(e, issue)}>
                        <div className="login-input-group">
                          <Hash size={16} className="login-input-icon" />
                          <input
                            type="text"
                            className="login-input"
                            placeholder="Order ID (optional)"
                            value={orderId}
                            onChange={(e) => setOrderId(e.target.value)}
                          />
                        </div>

                        <textarea
                          className="login-input feedback-textarea"
                          placeholder="Tell us what happened &mdash; we're listening..."
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          rows={4}
                          required
                        />

                        {submitError && <div className="login-error">{submitError}</div>}

                        <button
                          type="submit"
                          className="login-btn"
                          style={{ background: '#14b8a6', maxWidth: '220px' }}
                          disabled={isSubmitting || !message.trim()}
                        >
                          {isSubmitting ? <><span className="loading-spinner"></span> Submitting...</> : <><Send size={16} /> Submit Feedback</>}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {lastTicket && (
            <div className="submit-success">
              <CheckCircle2 size={20} color="#10b981" />
              <div>
                <strong>Thank you for sharing your feedback!</strong>
                <p>Your reference is <strong>{lastTicket}</strong>. Our team will review it shortly.</p>
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Your Feedback This Session</h2>
          {sessionHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              <Inbox size={24} style={{ display: 'block', margin: '0 auto 0.5rem' }} />
              Nothing submitted yet in this session.
            </div>
          ) : (
            <ul className="upload-preview-list" style={{ gap: '0.6rem' }}>
              {sessionHistory.map((item, i) => (
                <li key={i} style={{ whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.75rem 1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                    <span className="font-semibold" style={{ fontFamily: 'monospace' }}>{item.ticket_id}</span>
                    <span className="badge badge-low" style={{ flexShrink: 0 }}>{item.category}</span>
                  </div>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}

export default UserPortal;
