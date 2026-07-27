import { useState, useRef, useMemo, useEffect } from 'react';
import axios from 'axios';
import { 
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import {
  LayoutDashboard, Tags, Smile, MessageSquare, Moon, Sun,
  Sparkles, UploadCloud, Play, FileJson,
  ArrowUpRight, ArrowDownRight, ShieldAlert, Info, Database,
  User, Lock, Trash2
} from 'lucide-react';
import './App.css';

const API_BASE = "http://localhost:8000/api";

const COLORS = {
  purple: '#6366f1',
  blue: '#3b82f6',
  green: '#10b981',
  yellow: '#f59e0b',
  red: '#ef4444',
  teal: '#14b8a6',
  orange: '#f97316'
};

const CHART_PALETTE = [COLORS.purple, COLORS.blue, COLORS.green, COLORS.yellow, COLORS.teal, COLORS.orange, COLORS.red];

function App() {
  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // App State
  const [isProcessing, setIsProcessing] = useState(false);
  const [dataset, setDataset] = useState(null); // { filename: string, data: array }
  const [results, setResults] = useState([]);
  const [batches, setBatches] = useState([]); // List of uploaded files
  const [summary, setSummary] = useState("");

  // Tabs and UI State
  const [activeTab, setActiveTab] = useState('Overview');
  const [selectedBatchId, setSelectedBatchId] = useState(""); // Filters by File ID
  const [isDarkMode, setIsDarkMode] = useState(false);
  
  const fileInputRef = useRef(null);

  // Fetch initial data
  useEffect(() => {
    if (!isAuthenticated) return;
    
    const fetchHistoricalData = async () => {
      try {
        const [feedbackRes, batchRes] = await Promise.all([
           axios.get(`${API_BASE}/feedbacks`),
           axios.get(`${API_BASE}/batches`)
        ]);
        
        if (feedbackRes.data && feedbackRes.data.data) {
          setResults(feedbackRes.data.data);
          // Generate an initial summary from the latest data if possible
          const allThemes = feedbackRes.data.data.flatMap(item => item.analysis?.themes || []).slice(0, 20);
          if (allThemes.length > 0) {
             axios.post(`${API_BASE}/generate-summary`, allThemes).then(res => setSummary(res.data.summary));
          }
        }
        
        if (batchRes.data && batchRes.data.data) {
           setBatches(batchRes.data.data);
        }
      } catch (e) {
        console.error("Could not fetch historical data", e);
      }
    };
    fetchHistoricalData();
  }, [isAuthenticated]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    try {
      await axios.post(`${API_BASE}/login`, {
        username: loginUsername,
        password: loginPassword
      });
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

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const json = JSON.parse(e.target.result);
          if (Array.isArray(json)) {
            setDataset({ filename: file.name, data: json });
          } else {
            alert("Please upload a valid JSON array.");
          }
        } catch (err) {
          alert("Invalid JSON file.");
        }
      };
      reader.readAsText(file);
    }
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRunAnalysis = async () => {
    if (!dataset || dataset.data.length === 0) return;
    setIsProcessing(true);
    try {
      const payload = {
        filename: dataset.filename,
        feedbacks: dataset.data
      };
      
      const response = await axios.post(`${API_BASE}/batch-analyze`, payload);
      const data = response.data.data;
      
      setResults(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newResults = data.filter(d => !existingIds.has(d.id));
        return [...prev, ...newResults];
      });

      // Refresh batches
      const batchRes = await axios.get(`${API_BASE}/batches`);
      if (batchRes.data) setBatches(batchRes.data.data);
      
      // Auto-filter to the new batch
      if (response.data.batch_id) {
         setSelectedBatchId(response.data.batch_id);
      }
      
      const allThemes = data.flatMap(item => item.analysis?.themes || []);
      const summaryRes = await axios.post(`${API_BASE}/generate-summary`, allThemes);
      setSummary(summaryRes.data.summary);
      
      setDataset(null); 
    } catch (error) {
      console.error("Analysis failed:", error);
      alert("Analysis failed. Ensure FastAPI is running.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteBatch = async (batchId, filename) => {
    const confirmed = window.confirm(
      `Delete "${filename}" and all its analyzed feedback records? This cannot be undone.`
    );
    if (!confirmed) return;

    try {
      await axios.delete(`${API_BASE}/batches/${batchId}`);
      setBatches(prev => prev.filter(b => b.id !== batchId));
      setResults(prev => prev.filter(r => r.batch_id !== batchId));
      if (selectedBatchId === batchId) setSelectedBatchId("");
    } catch (error) {
      console.error("Delete failed:", error);
      alert("Failed to delete this upload. Ensure FastAPI is running.");
    }
  };

  // -------------------------
  // Filtering & Metrics Calculations
  // -------------------------
  const filteredResults = useMemo(() => {
    let finalRes = results;

    // Filter by Batch ID if selected
    if (selectedBatchId) {
       finalRes = finalRes.filter(r => r.batch_id === selectedBatchId);
    }

    return finalRes;
  }, [results, selectedBatchId]);

  const totalProcessed = filteredResults.length;
  
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
  const NavItem = ({ icon: Icon, label }) => (
    <div 
      className={`nav-item ${activeTab === label ? 'active' : ''}`}
      onClick={() => setActiveTab(label)}
    >
      <Icon size={18} /> {label}
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
        <p className="login-subfooter">Authorized administrators only</p>
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
      
      {summary && (
        <div className="card">
          <h2>Executive Insights</h2>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{summary}</p>
        </div>
      )}
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
              {filteredResults.filter(r => ['critical', 'high'].includes((r.risk_level || '').toLowerCase())).map(r => (
                <tr key={r.id}>
                  <td><span className={`badge badge-${r.risk_level.toLowerCase()}`}>{r.risk_level}</span></td>
                  <td className="font-semibold">{r.analysis?.category}</td>
                  <td style={{ maxWidth: '350px' }}>{r.text}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{r.recommendation}</td>
                </tr>
              ))}
              {filteredResults.filter(r => ['critical', 'high'].includes((r.risk_level || '').toLowerCase())).length === 0 && (
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
      <h2>Feedback Risk Registry</h2>
      <div className="table-container">
        <table style={{minWidth: '1000px'}}>
          <thead>
            <tr>
              <th style={{ width: '35%' }}>Feedback</th>
              <th style={{ width: '15%' }}>Category</th>
              <th style={{ width: '15%' }}>Confidence</th>
              <th style={{ width: '15%' }}>Risk Level</th>
              <th style={{ width: '20%' }}>Action Recommended</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.map(r => {
              const riskCls = `badge-${(r.risk_level || 'low').toLowerCase()}`;
              return (
                <tr key={r.id}>
                  <td style={{ paddingRight: '2rem' }}>{r.text}</td>
                  <td className="font-semibold">{r.analysis?.category || 'N/A'}</td>
                  <td>
                      <span style={{color: r.confidence_score > 80 ? COLORS.green : COLORS.orange, fontWeight: 600}}>
                        {r.confidence_score}%
                      </span>
                  </td>
                  <td>
                    <span className={`badge ${riskCls}`}>
                      {r.risk_level || 'Low'} Risk
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      {r.recommendation || '-'}
                  </td>
                </tr>
              );
            })}
            {filteredResults.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  No feedback data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderUploadHistory = () => (
    <div className="card">
      <h2>JSON File Upload History</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>Track previously analyzed datasets and generate specific file reports.</p>
      
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>File Name</th>
              <th>Upload Date</th>
              <th>Total Tickets</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr>
                <td colSpan="4" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No files have been uploaded yet.
                </td>
              </tr>
            )}
            {batches.map(b => (
              <tr key={b.id}>
                <td className="font-semibold"><FileJson size={16} style={{ verticalAlign: 'middle', marginRight: '8px', color: COLORS.purple }} /> {b.filename}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{new Date(b.uploaded_at).toLocaleString()}</td>
                <td><span className="badge badge-low" style={{ background: `${COLORS.blue}20`, color: COLORS.blue }}>{b.feedback_count} items</span></td>
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
                    onClick={() => handleDeleteBatch(b.id, b.filename)}
                    title="Delete this upload and its feedback records"
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
          <NavItem icon={Database} label="Upload History" />
        </div>

        <div className="sidebar-footer">
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
                 ? `Viewing filtered report for file: ${batches.find(b => b.id === selectedBatchId)?.filename || 'Unknown'}` 
                 : "Automated confidence scoring and business risk evaluation."}
            </p>
          </div>
          <div className="header-actions">
            
            {/* Always visible upload button */}
            <div style={{ position: 'relative' }} title={`Format: [\n  {"id": "1", "text": "Issue..."}\n]`}>
              <input type="file" accept=".json" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
              <button className="btn-secondary" onClick={() => fileInputRef.current.click()} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <UploadCloud size={16} /> Upload JSON
                <Info size={14} color="var(--text-muted)" style={{ marginLeft: '4px' }} />
              </button>
            </div>

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

            {dataset && dataset.data.length > 0 && (
               <button className="btn-primary" onClick={handleRunAnalysis} disabled={isProcessing}>
                {isProcessing ? <><span className="loading-spinner"></span> Generating...</> : <><Play size={16} /> Analyze New Upload ({dataset.data.length})</>}
              </button>
            )}
          </div>
        </header>

        {results.length === 0 && (!dataset || dataset.data.length === 0) ? (
          <div className="empty-state fade-in">
            <h2>No Data Found in Risk Database</h2>
            <p>Upload a JSON dataset containing feedback text to process through the Risk Engine.</p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn-secondary" onClick={() => fileInputRef.current.click()}>
                <UploadCloud size={18} /> Upload JSON
              </button>
            </div>
            <div style={{ marginTop: '2rem', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'left', background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <strong>Required JSON Format:</strong><br/>
              <pre style={{ margin: '0.5rem 0', fontFamily: 'monospace' }}>
{`[
  { 
    "id": "1", 
    "text": "The app is crashing." 
  }
]`}
              </pre>
            </div>
          </div>
        ) : (
          <div className="fade-in">
            {activeTab === 'Overview' && renderOverview()}
            {activeTab === 'Risk Analysis' && renderRiskAnalysis()}
            {activeTab === 'Categories' && renderCategories()}
            {activeTab === 'Sentiment' && renderSentiment()}
            {activeTab === 'Feedbacks' && renderFeedbacksTable()}
            {activeTab === 'Upload History' && renderUploadHistory()}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
