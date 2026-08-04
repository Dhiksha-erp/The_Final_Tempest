import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import UserPortal from './pages/UserPortal';
import AdminDashboard from './pages/AdminDashboard';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/user" element={<UserPortal />} />
        <Route path="/admin" element={<AdminDashboard />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
