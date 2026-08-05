import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import {
  LayoutDashboard, Tags, Smile, MessageSquare, Moon, Sun,
  Sparkles, Layers, Package, Search, ChevronDown, UploadCloud, FileSpreadsheet,
  ArrowUpRight, ArrowDownRight, ShieldAlert, Database,
  User, Lock, Trash2, Home
} from 'lucide-react';
import api from '../api';
import { COLORS, CHART_PALETTE } from '../constants';
import { useDarkMode } from '../useDarkMode';
import '../App.css';

const RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function AdminDashboard() {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // App State
  const [results, setResults] = useState([]);
  const [batches, setBatches] = useState([]); // List of batches, one per submission day
  const [orders, setOrders] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [summary, setSummary] = useState("");
  const [summaryKeywords, setSummaryKeywords] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [insightRange, setInsightRange] = useState('week');
  const [customMonth, setCustomMonth] = useState(""); // 'YYYY-MM' from the month picker

  // Tabs and UI State
  const [activeTab, setActiveTab] = useState('Overview');
  const [selectedBatchId, setSelectedBatchId] = useState(""); // Filters by File ID
  const [isDarkMode, setIsDarkMode] = useDarkMode();
  const [feedbackSearch, setFeedbackSearch] = useState("");

  // Batch Upload state
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [bulkError, setBulkError] = useState("");

  const loadDashboardData = async () => {
    const [feedbackRes, batchRes, orderRes, addressRes] = await Promise.all([
      api.get('/feedbacks'),
      api.get('/batches'),
      api.get('/user/orders'),
      api.get('/user/addresses')
    ]);

    const feedbacks = feedbackRes.data?.data || [];
    setResults(feedbacks);
    if (batchRes.data) setBatches(batchRes.data.data);
    setOrders(orderRes.data?.data || []);
    setAddresses(addressRes.data?.data || []);
    return feedbacks;
  };

  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const computeInsightRange = (preset, monthValue) => {
    if (preset === 'custom' && monthValue) {
      const [y, m] = monthValue.split('-').map(Number);
      return {
        start: toISO(new Date(y, m - 1, 1)),
        end: toISO(new Date(y, m, 0)),
        label: `${MONTH_NAMES[m - 1]} ${y}`
      };
    }
    const daysBack = { today: 0, week: 6, month: 29, sixmonths: 181, year: 364 }[preset] ?? 6;
    const label = { today: 'today', week: 'the past 7 days', month: 'the past 30 days', sixmonths: 'the past 6 months', year: 'the past 12 months' }[preset] ?? 'the past 7 days';
    const start = new Date();
    start.setDate(start.getDate() - daysBack);
    return { start: toISO(start), end: toISO(new Date()), label };
  };

  const generateInsights = async (preset, monthValue) => {
    setSummaryLoading(true);
    try {
      const { start, end, label } = computeInsightRange(preset, monthValue);
      const res = await api.post('/generate-summary', { start_date: start, end_date: end, period_label: label });
      setSummary(res.data.summary);
      setSummaryKeywords(res.data.keywords || []);
    } catch (error) {
      console.error("Could not generate executive summary:", error);
      setSummary("Unable to generate the summary right now. Ensure the backend is running.");
      setSummaryKeywords([]);
    } finally {
      setSummaryLoading(false);
    }
  };

  // Regenerate insights whenever the selected range changes
  useEffect(() => {
    if (!isAuthenticated) return;
    if (insightRange === 'custom' && !customMonth) return;
    generateInsights(insightRange, customMonth);
  }, [isAuthenticated, insightRange, customMonth]);

  // Fetch initial data
  useEffect(() => {
    if (!isAuthenticated) return;
    loadDashboardData().catch(e => console.error("Could not fetch dashboard data", e));
  }, [isAuthenticated]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    try {
      await api.post('/login', { username: loginUsername, password: loginPassword });
      setIsAuthenticated(true);
    } catch (err) {
      setLoginError(
        err.response?.status === 401
          ? "Invalid admin ID or password."
          : "Could not reach the server. Ensure the backend is running."
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleDeleteBatch = async (batchId, label) => {
    const confirmed = window.confirm(
      `Delete "${label}" and all its feedback records? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await api.delete(`/batches/${batchId}`);
      setBatches(prev => prev.filter(b => b.id !== batchId));
      setResults(prev => prev.filter(r => r.batch_id !== batchId));
      if (selectedBatchId === batchId) setSelectedBatchId("");
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete this batch. Ensure FastAPI is running.");
    }
  };

  const handleSetRiskLevel = async (feedbackId, newLevel) => {
    setResults(prev => prev.map(r => r.id === feedbackId ? { ...r, risk_level: newLevel, risk_override: true } : r));
    try {
      const res = await api.put(`/feedbacks/${feedbackId}/risk-level`, { risk_level: newLevel });
      setResults(prev => prev.map(r => r.id === feedbackId ? { ...r, recommendation: res.data.recommendation } : r));
    } catch (error) {
      console.error("Could not update risk level:", error);
      alert("Failed to update the risk level. Ensure the backend is running.");
      loadDashboardData().catch(() => {});
    }
  };

  const handleBulkUpload = async () => {
    if (!bulkFile) return;
    setBulkUploading(true);
    setBulkError("");
    setBulkResult(null);
    try {
      const formData = new FormData();
      formData.append('file', bulkFile);
      const res = await api.post('/admin/bulk-upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setBulkResult(res.data);
      setBulkFile(null);
      await loadDashboardData();
    } catch (error) {
      console.error("Bulk upload failed:", error);
      setBulkError(error.response?.data?.detail || "Upload failed. Ensure the backend is running.");
    } finally {
      setBulkUploading(false);
    }
  };

  // -------------------------
  // Filtering & Metrics Calculations
  // -------------------------
  // Feedback is analyzed synchronously on submit, so every record here already
  // has a category by the time it reaches the dashboard - this filter just
  // guards against any legacy pre-analysis rows.
  const analyzedResults = useMemo(() => results.filter(r => r.analysis?.category), [results]);

  const filteredResults = useMemo(() => {
    let finalRes = analyzedResults;

    if (selectedBatchId) {
       finalRes = finalRes.filter(r => r.batch_id === selectedBatchId);
    }

    return finalRes;
  }, [analyzedResults, selectedBatchId]);

  const totalProcessed = filteredResults.length;

  const resultsByRisk = useMemo(() => {
    return [...filteredResults].sort((a, b) => {
      const ra = RISK_ORDER[(a.risk_level || 'low').toLowerCase()] ?? 4;
      const rb = RISK_ORDER[(b.risk_level || 'low').toLowerCase()] ?? 4;
      return ra - rb;
    });
  }, [filteredResults]);

  const searchedFeedbacks = useMemo(() => {
    const q = feedbackSearch.trim().toLowerCase();
    if (!q) return resultsByRisk;
    return resultsByRisk.filter(r => {
      const haystack = [r.ticket_id, r.text, r.analysis?.category, r.risk_level, r.recommendation, r.confidence_score]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [resultsByRisk, feedbackSearch]);

  const highlightMatch = (value, query) => {
    const str = String(value ?? '');
    const q = query.trim();
    if (!q) return str;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = str.split(new RegExp(`(${escaped})`, 'gi'));
    if (parts.length === 1) return str;
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase()
        ? <mark key={i} className="search-highlight">{part}</mark>
        : part
    );
  };

  const highlightKeywords = (text, keywords) => {
    const unique = [...new Set((keywords || []).filter(Boolean))].sort((a, b) => b.length - a.length);
    if (unique.length === 0) return text;
    const escaped = unique.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
    return parts.map((part, i) =>
      unique.some(k => k.toLowerCase() === part.toLowerCase())
        ? <mark key={i} className="insight-keyword">{part}</mark>
        : part
    );
  };

  const categories = useMemo(() => {
    const counts = {};
    filteredResults.forEach(r => {
      const cat = r.analysis?.category || 'Other';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    const arr = Object.keys(counts).map(k => ({ name: k, value: counts[k] }));
    return arr.sort((a,b) => b.value - a.value);
  }, [filteredResults]);

  const themesList = useMemo(() => {
    const counts = {};
    filteredResults.forEach(r => {
      (r.analysis?.themes || []).forEach(t => {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return Object.keys(counts).map(k => ({ name: k, value: counts[k], percent: totalProcessed ? Math.round((counts[k]/totalProcessed)*100) : 0 }))
      .sort((a,b) => b.value - a.value);
  }, [filteredResults, totalProcessed]);

  const topThemes = themesList.slice(0, 5);

  const riskMetrics = useMemo(() => {
    let critical = 0, high = 0, medium = 0, low = 0;
    let totalConfidence = 0;
    filteredResults.forEach(r => {
      const risk = (r.risk_level || '').toLowerCase();
      if (risk === 'critical') critical++;
      else if (risk === 'high') high++;
      else if (risk === 'medium') medium++;
      else low++;
      totalConfidence += (r.confidence_score || 100);
    });
    return {
      critical, high, medium, low,
      avgConfidence: totalProcessed ? Math.round(totalConfidence / totalProcessed) : 0,
      highRiskPct: totalProcessed ? Math.round(((critical + high) / totalProcessed) * 100) : 0
    };
  }, [filteredResults, totalProcessed]);

  const sentimentMetrics = useMemo(() => {
    let pos = 0, neu = 0, neg = 0;
    filteredResults.forEach(r => {
      const s = (r.analysis?.sentiment || 'Neutral').toLowerCase();
      if (s === 'positive') pos++;
      else if (s === 'negative') neg++;
      else neu++;
    });
    return {
      pos, neu, neg,
      posPct: totalProcessed ? Math.round((pos / totalProcessed) * 100) : 0,
      neuPct: totalProcessed ? Math.round((neu / totalProcessed) * 100) : 0,
      negPct: totalProcessed ? Math.round((neg / totalProcessed) * 100) : 0
    };
  }, [filteredResults, totalProcessed]);

  const riskChartData = [
    { name: 'Critical', value: riskMetrics.critical, fill: COLORS.red },
    { name: 'High', value: riskMetrics.high, fill: COLORS.yellow },
    { name: 'Medium', value: riskMetrics.medium, fill: COLORS.blue },
    { name: 'Low', value: riskMetrics.low, fill: COLORS.green }
  ];

  const sentimentChartData = [
    { name: 'Positive', value: sentimentMetrics.pos, fill: COLORS.green },
    { name: 'Neutral', value: sentimentMetrics.neu, fill: COLORS.yellow },
    { name: 'Negative', value: sentimentMetrics.neg, fill: COLORS.red }
  ].filter(d => d.value > 0);


  // Components
  const NavItem = ({ icon: Icon, label, badge }) => (
    <div
      className={`nav-item ${activeTab === label ? 'active' : ''}`}
      onClick={() => setActiveTab(label)}
    >
      <Icon size={18} /> {label}
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </div>
  );

  const KPICard = ({ title, value, subtext, icon: Icon, color, trendUp, noTrend }) => (
    <div className="kpi-card">
      <div className="kpi-header">
        <div className="kpi-icon-wrapper" style={{ background: `${color}15`, color: color }}>
          <Icon size={24} />
        </div>
        <div className="kpi-title">{title}</div>
      </div>
      <div className="kpi-value">{value}</div>
      {!noTrend && (
        <div className={`kpi-trend ${trendUp === true ? 'trend-up' : trendUp === false ? 'trend-down' : 'trend-flat'}`}>
          {trendUp === true ? <ArrowUpRight size={14} /> : trendUp === false ? <ArrowDownRight size={14} /> : null}
          {subtext}
        </div>
      )}
    </div>
  );

  // Render Login
  if (!isAuthenticated) {
    return (
      <div className={`login-container ${isDarkMode ? 'dark-theme' : ''}`}>
        <div className="login-card fade-in">
          <div className="login-badge">
            <ShieldAlert size={32} color="white" />
          </div>
          <h2>Admin Login</h2>
          <p>Sign in to the Risk Engine Platform</p>
          <form onSubmit={handleLogin}>
            <div className="login-input-group">
              <User size={16} className="login-input-icon" />
              <input
                type="text"
                className="login-input"
                placeholder="Admin ID"
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

            <button type="submit" className="login-btn" disabled={isLoggingIn}>
              {isLoggingIn ? <><span className="loading-spinner"></span> Verifying...</> : 'Secure Login'}
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

  // Views rendering
  const renderOverview = () => (
    <>
      <div className="kpi-row">
        <KPICard title="Total Feedback" value={totalProcessed} subtext="Database Total" icon={MessageSquare} color={COLORS.purple} />
        <KPICard title="Categories Detected" value={categories.length} subtext="Unique themes" icon={Tags} color={COLORS.blue} />
        <KPICard title="High/Critical Risk" value={`${riskMetrics.highRiskPct}%`} subtext="Needs Attention" icon={ShieldAlert} color={COLORS.red} trendUp={false} />
        <KPICard title="Positive Sentiment" value={`${sentimentMetrics.posPct}%`} subtext="User happiness" icon={Smile} color={COLORS.green} trendUp={true} />
      </div>

      <div className="charts-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)'}}>
        <div className="chart-card">
          <div className="chart-header">
            <h3>Business Risk Distribution</h3>
          </div>
          <div className="chart-content">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={riskChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <RechartsTooltip contentStyle={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}/>
                <Bar dataKey="value" radius={[4,4,0,0]}>
                   {riskChartData.map((entry, index) => (
                     <Cell key={`cell-${index}`} fill={entry.fill} />
                   ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h3>Feedback by Category</h3>
          </div>
          <div className="chart-content" style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '180px', height: '180px', position: 'relative' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categories} dataKey="value" innerRadius={60} outerRadius={80} stroke="none">
                    {categories.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 'bold' }}>{totalProcessed}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total</div>
              </div>
            </div>
            <div className="legend-list" style={{ marginLeft: '2rem', flex: 1 }}>
              {categories.slice(0, 5).map((c, i) => (
                <div key={i} className="legend-item">
                  <div className="legend-label"><div className="dot" style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length]}}></div> {c.name}</div>
                  <div>{c.value} <span style={{color:'var(--text-muted)'}}>({Math.round((c.value/totalProcessed)*100)}%)</span></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Executive Insights</h2>
        <div className="insight-range-row">
          {[
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'Weekly' },
            { key: 'month', label: 'Monthly' },
            { key: 'sixmonths', label: '6 Months' },
            { key: 'year', label: 'Yearly' }
          ].map(r => (
            <button
              key={r.key}
              className={`insight-range-btn ${insightRange === r.key ? 'active' : ''}`}
              onClick={() => { setInsightRange(r.key); setCustomMonth(""); }}
            >
              {r.label}
            </button>
          ))}
          <label className={`insight-month-picker ${insightRange === 'custom' ? 'active' : ''}`}>
            <span>Custom Date:</span>
            <input
              type="month"
              value={customMonth}
              onChange={(e) => { setCustomMonth(e.target.value); setInsightRange('custom'); }}
            />
          </label>
        </div>

        {summaryLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-secondary)', padding: '1rem 0' }}>
            <span className="loading-spinner" style={{ borderTopColor: COLORS.purple }}></span> Generating insights...
          </div>
        ) : (
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{highlightKeywords(summary, summaryKeywords)}</p>
        )}
      </div>
    </>
  );

  const renderRiskAnalysis = () => (
    <>
      <div className="kpi-row">
        <KPICard title="Critical Risks" value={riskMetrics.critical} subtext="Requires Immediate Escalation" icon={ShieldAlert} color={COLORS.red} trendUp={false} />
        <KPICard title="High Risks" value={riskMetrics.high} subtext="Monitor Closely" icon={ShieldAlert} color={COLORS.orange} trendUp={false} />
        <KPICard title="Average AI Confidence" value={`${riskMetrics.avgConfidence}%`} subtext="Engine Accuracy" icon={Sparkles} color={COLORS.purple} trendUp={true} />
      </div>

      <div className="chart-card" style={{ marginBottom: '1.5rem' }}>
        <div className="chart-header">
          <h3>Risk Distribution Map</h3>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={riskChartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} />
            <YAxis axisLine={false} tickLine={false} />
            <RechartsTooltip contentStyle={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}/>
            <Bar dataKey="value" radius={[4,4,0,0]}>
               {riskChartData.map((entry, index) => (
                 <Cell key={`cell-${index}`} fill={entry.fill} />
               ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h2>High & Critical Priority Items</h2>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Risk Level</th>
                <th>Category</th>
                <th>Feedback</th>
                <th>Recommended Action</th>
              </tr>
            </thead>
            <tbody>
              {resultsByRisk.filter(r => ['critical', 'high'].includes((r.risk_level || '').toLowerCase())).map(r => (
                <tr key={r.id}>
                  <td><span className={`badge badge-${r.risk_level.toLowerCase()}`}>{r.risk_level}</span></td>
                  <td className="font-semibold">{r.analysis?.category}</td>
                  <td style={{ maxWidth: '350px' }}>{r.text}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.recommendation}</td>
                </tr>
              ))}
              {resultsByRisk.filter(r => ['critical', 'high'].includes((r.risk_level || '').toLowerCase())).length === 0 && (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '2rem' }}>No high or critical risk items found. Great job!</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  const renderCategories = () => (
    <>
      <div className="charts-grid" style={{gridTemplateColumns: 'repeat(2, 1fr)'}}>

        <div className="chart-card">
          <div className="chart-header">
            <h3>Feedback by Category</h3>
          </div>
          <div className="chart-content" style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: '200px', height: '200px', position: 'relative' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={categories} dataKey="value" innerRadius={70} outerRadius={90} stroke="none">
                    {categories.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{totalProcessed}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total</div>
              </div>
            </div>
            <div className="legend-list" style={{ marginLeft: '2rem', flex: 1 }}>
              {categories.slice(0, 6).map((c, i) => (
                <div key={i} className="legend-item">
                  <div className="legend-label"><div className="dot" style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length]}}></div> {c.name}</div>
                  <div>{c.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-header">
            <h3>Top Recurring Themes</h3>
          </div>
          <div className="legend-list">
            {topThemes.map((t, i) => (
              <div key={i} className="legend-item" style={{ padding: '0.75rem 0' }}>
                <div className="legend-label" style={{ fontWeight: 500, color: 'var(--text-primary)' }}># {t.name}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ width: '100px', height: '6px', background: 'var(--border-color)', borderRadius: '3px', overflow: 'hidden' }}>
                     <div style={{ width: `${t.percent}%`, height: '100%', background: COLORS.purple }}></div>
                  </div>
                  <div style={{ width: '35px', textAlign: 'right' }}>{t.percent}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );

  const renderSentiment = () => (
    <>
      <div className="kpi-row">
        <KPICard title="Positive" value={`${sentimentMetrics.posPct}%`} subtext={`${sentimentMetrics.pos} interactions`} icon={Smile} color={COLORS.green} trendUp={true} />
        <KPICard title="Neutral" value={`${sentimentMetrics.neuPct}%`} subtext={`${sentimentMetrics.neu} interactions`} icon={MessageSquare} color={COLORS.yellow} noTrend={true} />
        <KPICard title="Negative" value={`${sentimentMetrics.negPct}%`} subtext={`${sentimentMetrics.neg} interactions`} icon={ShieldAlert} color={COLORS.red} trendUp={false} />
      </div>

      <div className="chart-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div className="chart-header" style={{ textAlign: 'center' }}>
            <h3>Sentiment Distribution</h3>
          </div>
          <div style={{ width: '300px', height: '300px', margin: '0 auto', position: 'relative' }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sentimentChartData} dataKey="value" innerRadius={90} outerRadius={120} stroke="none">
                    {sentimentChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{totalProcessed}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Total</div>
              </div>
          </div>
      </div>
    </>
  );

  const renderFeedbacksTable = () => (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '0.5rem' }}>
        <h2 style={{ marginBottom: 0 }}>Feedback Risk Registry</h2>
        <div className="grocery-search-wrap" style={{ width: '280px' }}>
          <div className="grocery-search-input-wrap">
            <Search size={16} className="grocery-search-icon" />
            <input
              className="grocery-search-input"
              placeholder="Search tickets..."
              value={feedbackSearch}
              onChange={(e) => setFeedbackSearch(e.target.value)}
            />
            {feedbackSearch && (
              <button type="button" className="grocery-search-clear" onClick={() => setFeedbackSearch("")}>
                ×
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="table-container">
        <table style={{minWidth: '1100px'}}>
          <thead>
            <tr>
              <th style={{ width: '12%' }}>Ticket ID</th>
              <th style={{ width: '28%' }}>Feedback</th>
              <th style={{ width: '15%' }}>Category</th>
              <th style={{ width: '15%' }}>Confidence</th>
              <th style={{ width: '15%' }}>Risk Level</th>
              <th style={{ width: '15%' }}>Action Recommended</th>
            </tr>
          </thead>
          <tbody>
            {searchedFeedbacks.map(r => {
              const riskCls = `badge-${(r.risk_level || 'low').toLowerCase()}`;
              return (
                <tr key={r.id}>
                  <td className="font-semibold" style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{highlightMatch(r.ticket_id, feedbackSearch)}</td>
                  <td style={{ paddingRight: '2rem' }}>
                    {highlightMatch(r.text, feedbackSearch)}
                    {r.image_data && (
                      <a href={r.image_data} target="_blank" rel="noopener noreferrer" title="View attached photo">
                        <img src={r.image_data} alt="Attached" style={{ width: '28px', height: '28px', objectFit: 'cover', borderRadius: '6px', marginLeft: '8px', verticalAlign: 'middle', border: '1px solid var(--border-color)' }} />
                      </a>
                    )}
                  </td>
                  <td className="font-semibold">{highlightMatch(r.analysis?.category || 'N/A', feedbackSearch)}</td>
                  <td>
                      <span style={{color: r.confidence_score > 80 ? COLORS.green : COLORS.orange, fontWeight: 600}}>
                        {highlightMatch(`${r.confidence_score}%`, feedbackSearch)}
                      </span>
                  </td>
                  <td>
                    <span className="risk-select-wrap">
                      <select
                        className={`badge risk-select ${riskCls}`}
                        value={r.risk_level || 'Low'}
                        onChange={(e) => handleSetRiskLevel(r.id, e.target.value)}
                        title={r.risk_override ? "Manually set by admin (LLM classified this differently)" : "Set by AI — change to override"}
                      >
                        <option value="Critical">Critical Risk</option>
                        <option value="High">High Risk</option>
                        <option value="Medium">Medium Risk</option>
                        <option value="Low">Low Risk</option>
                      </select>
                      <ChevronDown size={12} className="risk-select-chevron" />
                    </span>
                    {r.risk_override && <User size={12} style={{ marginLeft: '6px', color: 'var(--text-muted)', verticalAlign: 'middle' }} />}
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      {highlightMatch(r.recommendation || '-', feedbackSearch)}
                  </td>
                </tr>
              );
            })}
            {searchedFeedbacks.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  {feedbackSearch ? `No tickets match "${feedbackSearch}".` : 'No analyzed feedback yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderBatches = () => (
    <div className="card">
      <h2>Submitted Batches</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Feedback submitted through the User Portal automatically groups into one batch per calendar day and is analyzed immediately — view the report any time.
      </p>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Submitted</th>
              <th>Total Tickets</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No batches yet. Once feedback is submitted via the User Portal, today's batch will appear here.
                </td>
              </tr>
            )}
            {batches.map(b => (
              <tr key={b.id}>
                <td className="font-semibold"><Layers size={16} style={{ verticalAlign: 'middle', marginRight: '8px', color: COLORS.purple }} /> {b.label}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{new Date(b.uploaded_at).toLocaleString()}</td>
                <td><span className="badge badge-low" style={{ background: `${COLORS.blue}20`, color: COLORS.blue }}>{b.feedback_count} items</span></td>
                <td>
                  <span className="badge badge-low">{b.status}</span>
                </td>
                <td style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}
                    onClick={() => {
                      setSelectedBatchId(b.id);
                      setActiveTab('Overview');
                    }}
                  >
                    View Report
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', color: COLORS.red, borderColor: `${COLORS.red}50`, display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                    onClick={() => handleDeleteBatch(b.id, b.label)}
                    title="Delete this batch and its feedback records"
                  >
                    <Trash2 size={14} /> Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderBulkUpload = () => (
    <div className="card">
      <h2>Batch Upload</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Upload a CSV or Excel file to bulk-import feedback tickets. Each row becomes its own ticket and is analyzed immediately, just like a normal submission. There's no file size limit.
      </p>

      <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Expected columns</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
          <strong>Required:</strong> a column named <code>text</code>, <code>feedback</code>, <code>message</code>, or <code>comment</code> — the ticket content.<br />
          <strong>Optional:</strong> a column named <code>order_id</code> — tags the ticket to that order.
        </div>
      </div>

      <label className="feedback-image-label" style={{ marginBottom: '1rem' }}>
        <FileSpreadsheet size={16} />
        {bulkFile ? bulkFile.name : 'Choose a .csv, .xlsx, or .xls file'}
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          hidden
          onChange={(e) => { setBulkFile(e.target.files?.[0] || null); setBulkResult(null); setBulkError(""); }}
        />
      </label>

      <div>
        <button className="btn-primary" onClick={handleBulkUpload} disabled={!bulkFile || bulkUploading}>
          {bulkUploading ? <><span className="loading-spinner"></span> Uploading &amp; analyzing...</> : <><UploadCloud size={16} /> Upload</>}
        </button>
      </div>

      {bulkError && <div className="login-error" style={{ marginTop: '1rem' }}>{bulkError}</div>}

      {bulkResult && (
        <div className="submit-success" style={{ marginTop: '1rem' }}>
          <div>
            <strong>Import complete!</strong>
            <p>{bulkResult.imported} ticket{bulkResult.imported === 1 ? '' : 's'} imported and analyzed{bulkResult.skipped > 0 ? `, ${bulkResult.skipped} row${bulkResult.skipped === 1 ? '' : 's'} skipped (empty text)` : ''}.</p>
          </div>
        </div>
      )}
    </div>
  );

  const renderOrders = () => (
    <div className="card">
      <h2>Customer Orders</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Every order placed through the User Portal, persisted in the database — survives logout and refresh.
      </p>

      <div className="table-container">
        <table style={{ minWidth: '900px' }}>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Items</th>
              <th>Deliver To</th>
              <th>Total</th>
              <th>Status</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No orders yet. Once a customer checks out via the User Portal, it will appear here.
                </td>
              </tr>
            )}
            {orders.map(o => {
              const address = addresses.find(a => a.id === o.address_id);
              return (
                <tr key={o.id}>
                  <td className="font-semibold" style={{ fontFamily: 'monospace' }}>{o.order_id}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {o.items.map(i => `${i.name} x${i.qty}`).join(', ')}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>
                    {address ? `${address.label} — ${address.city}` : '—'}
                  </td>
                  <td className="font-semibold">
                    ₹{o.total}
                    {o.coupon_code && (
                      <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 500 }}>
                        {o.coupon_code} saved ₹{o.discount}
                      </div>
                    )}
                  </td>
                  <td><span className="badge badge-low">{o.status}</span></td>
                  <td style={{ color: 'var(--text-secondary)' }}>{new Date(o.placed_at).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className={`app-layout ${isDarkMode ? 'dark-theme' : ''}`}>
      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-icon">
            <ShieldAlert size={20} color="white" />
          </div>
          Risk Engine
        </div>

        <div className="nav-section">
          <NavItem icon={LayoutDashboard} label="Overview" />
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Analytics</div>
          <NavItem icon={ShieldAlert} label="Risk Analysis" />
          <NavItem icon={Tags} label="Categories" />
          <NavItem icon={Smile} label="Sentiment" />
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Data Management</div>
          <NavItem icon={MessageSquare} label="Feedbacks" />
          <NavItem icon={Package} label="Orders" />
          <NavItem icon={UploadCloud} label="Batch Upload" />
          <NavItem icon={Database} label="Batches" />
        </div>

        <div className="sidebar-footer">
          <Link to="/" className="nav-item">
            <Home size={18} /> Home
          </Link>
          <div
            className="nav-item"
            onClick={() => setIsDarkMode(!isDarkMode)}
          >
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            {isDarkMode ? "Light Mode" : "Dark Mode"}
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="main-content">

        {/* HEADER */}
        <header className="top-header">
          <div className="header-title">
            <h1><Sparkles size={24} color={COLORS.purple} /> {activeTab}</h1>
            <p>
               {selectedBatchId
                 ? `Viewing filtered report for: ${batches.find(b => b.id === selectedBatchId)?.label || 'Unknown'}`
                 : "Automated confidence scoring and business risk evaluation."}
            </p>
          </div>
          <div className="header-actions">
            {selectedBatchId && (
                <button
                  className="btn-secondary"
                  onClick={() => setSelectedBatchId("")}
                  style={{ color: COLORS.red, borderColor: `${COLORS.red}50` }}
                  title="Clear File Filter"
                >
                  Clear File Filter
                </button>
            )}
          </div>
        </header>

        {activeTab === 'Batches' ? (
          <div className="fade-in">{renderBatches()}</div>
        ) : activeTab === 'Orders' ? (
          <div className="fade-in">{renderOrders()}</div>
        ) : activeTab === 'Batch Upload' ? (
          <div className="fade-in">{renderBulkUpload()}</div>
        ) : filteredResults.length === 0 ? (
          <div className="empty-state fade-in">
            <h2>No Feedback Yet</h2>
            <p>Ask users to submit feedback via the User Portal — it's analyzed automatically and will show up here.</p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn-secondary" onClick={() => setActiveTab('Batches')}>
                <Database size={18} /> Go to Batches
              </button>
            </div>
          </div>
        ) : (
          <div className="fade-in">
            {activeTab === 'Overview' && renderOverview()}
            {activeTab === 'Risk Analysis' && renderRiskAnalysis()}
            {activeTab === 'Categories' && renderCategories()}
            {activeTab === 'Sentiment' && renderSentiment()}
            {activeTab === 'Feedbacks' && renderFeedbacksTable()}
          </div>
        )}
      </main>
    </div>
  );
}

export default AdminDashboard;
