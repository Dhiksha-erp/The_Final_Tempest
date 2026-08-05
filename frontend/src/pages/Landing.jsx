import { Link } from 'react-router-dom';
import { ShieldAlert, LifeBuoy, Moon, Sun, ArrowRight } from 'lucide-react';
import { useDarkMode } from '../useDarkMode';
import '../App.css';

function Landing() {
  const [isDarkMode, setIsDarkMode] = useDarkMode();

  return (
    <div className={`login-container ${isDarkMode ? 'dark-theme' : ''}`}>
      <div className="landing-wrapper fade-in">
        <div className="landing-heading">
          <h1>The Final Tempest</h1>
          <p>AI-powered Voice of Customer risk engine</p>
        </div>

    


        <div className="landing-grid">
          <Link to="/user" className="portal-card portal-card-user">
            <div className="portal-card-icon portal-card-icon-user">
              <LifeBuoy size={28} color="white" />
            </div>
            <h2>My Account</h2>
            <p>Dive in  </p>
            <span className="portal-card-cta">Start Exploring <ArrowRight size={16} /></span>
          </Link>

          <Link to="/admin" className="portal-card portal-card-admin">
            <div className="portal-card-icon portal-card-icon-admin">
              <ShieldAlert size={28} color="white" />
            </div>
            <h2>Admin Portal</h2>
            <p>Review submitted batches, trigger AI analysis, and monitor risk across all feedback.</p>
            <span className="portal-card-cta">Open Admin Dashboard <ArrowRight size={16} /></span>
          </Link>
        </div>

        <div className="login-footer" onClick={() => setIsDarkMode(!isDarkMode)}>
          {isDarkMode ? <Sun size={16} /> : <Moon size={16} />} {isDarkMode ? 'Light Mode' : 'Dark Mode'}
        </div>
      </div>
    </div>
  );
}

export default Landing;
