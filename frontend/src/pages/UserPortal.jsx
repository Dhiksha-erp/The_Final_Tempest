import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageSquarePlus, User, Lock, Moon, Sun, Home,
  CheckCircle2, Send, Hash, ChevronDown, LifeBuoy,
  ShoppingCart, Package, MapPin, Settings, LogOut,
  Plus, Minus, Star, Pencil, Trash2, Tag, X, Search, ImagePlus
} from 'lucide-react';
import api from '../api';
import { GROCERY_CATALOG } from '../constants';
import { useDarkMode } from '../useDarkMode';
import '../App.css';

const ISSUE_CATEGORIES = [
  {
    key: "order",
    label: "Order Related",
    hint: "Anything about a specific order — missing, damaged, or wrong items, a delivery that hasn't arrived, or delivery partner behavior.",
    category: "Order Issue"
  },
  {
    key: "app",
    label: "App Related",
    hint: "Issues with the app itself — payments, billing, login, or something not working right.",
    category: "App/Payment Issue"
  },
  {
    key: "other",
    label: "Other",
    hint: "General feedback, a suggestion, or anything else you'd like us to know.",
    category: "General Feedback"
  }
];

const EMPTY_ADDRESS_FORM = { label: "Home", full_name: "", phone: "", line1: "", line2: "", city: "", state: "", pincode: "", is_default: false };

function composeFeedbackText(orderId, category, message, itemNames) {
  const tags = [];
  if (category && category !== "General Feedback") tags.push(category);
  if (orderId && orderId.trim()) tags.push(`Order ${orderId.trim()}`);
  if (itemNames && itemNames.length > 0) tags.push(`Item(s): ${itemNames.join(", ")}`);
  const prefix = tags.length > 0 ? `[${tags.join(" | ")}] ` : "";
  return `${prefix}${message.trim()}`;
}

function UserPortal() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isDarkMode, setIsDarkMode] = useDarkMode();

  const [activeTab, setActiveTab] = useState('Place Order');

  // Help Centre state
  const [expandedKey, setExpandedKey] = useState(null);
  const [orderId, setOrderId] = useState("");
  const [selectedOrderItems, setSelectedOrderItems] = useState([]);
  const [message, setMessage] = useState("");
  const [feedbackImage, setFeedbackImage] = useState(null);
  const [feedbackImageError, setFeedbackImageError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [lastTicket, setLastTicket] = useState(null);

  // Place Order state
  const [cart, setCart] = useState({});
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(null);
  const [grocerySearch, setGrocerySearch] = useState("");

  // Post-order feedback prompt state
  const [feedbackPromptOrder, setFeedbackPromptOrder] = useState(null);
  const [orderRating, setOrderRating] = useState(null);
  const [orderFeedbackText, setOrderFeedbackText] = useState("");
  const [orderFeedbackSubmitting, setOrderFeedbackSubmitting] = useState(false);
  const [orderFeedbackDone, setOrderFeedbackDone] = useState(false);

  // Coupons state
  const [coupons, setCoupons] = useState([]);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCouponCode, setAppliedCouponCode] = useState(null);
  const [couponError, setCouponError] = useState("");
  const [preview, setPreview] = useState(null);
  const [applyingCoupon, setApplyingCoupon] = useState(false);

  // My Orders state
  const [orders, setOrders] = useState([]);

  // Addresses state
  const [addresses, setAddresses] = useState([]);
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);
  const [addressForm, setAddressForm] = useState(EMPTY_ADDRESS_FORM);
  const [savingAddress, setSavingAddress] = useState(false);

  // Profile Settings state
  const [profileForm, setProfileForm] = useState({ full_name: "", email: "", phone: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const loadUserData = async () => {
    const [addressRes, orderRes, profileRes, couponRes] = await Promise.all([
      api.get('/user/addresses'),
      api.get('/user/orders'),
      api.get('/user/profile'),
      api.get('/coupons')
    ]);
    const loadedAddresses = addressRes.data?.data || [];
    setAddresses(loadedAddresses);
    setOrders(orderRes.data?.data || []);
    if (profileRes.data?.data) setProfileForm(profileRes.data.data);
    setCoupons(couponRes.data?.data || []);

    const defaultAddress = loadedAddresses.find(a => a.is_default) || loadedAddresses[0];
    if (defaultAddress) setSelectedAddressId(defaultAddress.id);
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    loadUserData().catch(e => console.error("Could not fetch user data", e));
  }, [isAuthenticated]);

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

  const handleSignOut = () => {
    setIsAuthenticated(false);
    setActiveTab('Place Order');
    setCart({});
    setOrderSuccess(null);
    setAppliedCouponCode(null);
    setCouponInput("");
    setCouponError("");
    setPreview(null);
  };

  // ---- Help Centre ----
  const toggleAccordion = (key) => {
    setSubmitError("");
    setOrderId("");
    setSelectedOrderItems([]);
    setMessage("");
    setFeedbackImage(null);
    setFeedbackImageError("");
    setExpandedKey(prev => prev === key ? null : key);
  };

  const selectedOrderForFeedback = useMemo(
    () => orders.find(o => o.order_id === orderId) || null,
    [orders, orderId]
  );

  const toggleOrderItem = (name) => {
    setSelectedOrderItems(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  const handleImageSelect = (file) => {
    setFeedbackImageError("");
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFeedbackImageError("Please choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setFeedbackImage(reader.result);
    reader.readAsDataURL(file);
  };

  const handleSubmitFeedback = async (e, issue) => {
    e.preventDefault();
    if (!message.trim()) return;
    setIsSubmitting(true);
    setSubmitError("");
    setLastTicket(null);
    try {
      const text = composeFeedbackText(orderId, issue.category, message, selectedOrderItems);
      const res = await api.post('/user/submit-feedback', { text, image_data: feedbackImage });
      setLastTicket(res.data.ticket_id);
      setOrderId("");
      setSelectedOrderItems([]);
      setMessage("");
      setFeedbackImage(null);
      setExpandedKey(null);
    } catch (err) {
      setSubmitError(err.response?.data?.detail || "Submission failed. Ensure the backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Place Order ----
  const grocerySearchMatches = useMemo(() => {
    const q = grocerySearch.trim().toLowerCase();
    if (!q) return [];
    return GROCERY_CATALOG.filter(item => item.name.toLowerCase().includes(q)).slice(0, 6);
  }, [grocerySearch]);

  const cartItems = useMemo(() => {
    return Object.entries(cart)
      .filter(([, qty]) => qty > 0)
      .map(([id, qty]) => ({ ...GROCERY_CATALOG.find(g => g.id === id), qty }));
  }, [cart]);

  const cartCount = useMemo(() => cartItems.reduce((sum, item) => sum + item.qty, 0), [cartItems]);
  const cartTotal = useMemo(() => cartItems.reduce((sum, item) => sum + item.cost * item.qty, 0), [cartItems]);

  const cartSummaryText = useMemo(() => {
    const parts = cartItems.map(item => `${item.name} (x${item.qty})`);
    if (parts.length <= 2) return parts.join(', ');
    return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} more`;
  }, [cartItems]);

  const changeQty = (itemId, delta) => {
    setCart(prev => {
      const nextQty = Math.max(0, (prev[itemId] || 0) + delta);
      return { ...prev, [itemId]: nextQty };
    });
  };

  useEffect(() => {
    if (cartCount === 0) {
      setPreview(null);
      return;
    }
    const items = cartItems.map(({ name, weight, cost, qty }) => ({ name, weight, cost, qty }));
    api.post('/user/orders/preview', { items, coupon_code: appliedCouponCode })
      .then(res => {
        const data = res.data.data;
        if (data.error && appliedCouponCode) {
          setCouponError(data.error);
          setAppliedCouponCode(null);
        }
        setPreview(data);
      })
      .catch(e => console.error("Could not preview order totals", e));
  }, [cartTotal, cartCount, appliedCouponCode]);

  const applyCouponCode = async (rawCode) => {
    const code = rawCode.trim().toUpperCase();
    if (!code || cartCount === 0) return;
    setApplyingCoupon(true);
    setCouponError("");
    try {
      const items = cartItems.map(({ name, weight, cost, qty }) => ({ name, weight, cost, qty }));
      const res = await api.post('/user/orders/preview', { items, coupon_code: code });
      const data = res.data.data;
      if (data.error) {
        setCouponError(data.error);
        setAppliedCouponCode(null);
      } else {
        setAppliedCouponCode(code);
        setPreview(data);
      }
    } catch (err) {
      console.error("Coupon check failed:", err);
      setCouponError("Could not validate this coupon right now.");
    } finally {
      setApplyingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCouponCode(null);
    setCouponInput("");
    setCouponError("");
  };

  const canPlaceOrder = cartCount > 0 && !!selectedAddressId && !placingOrder;

  const handlePlaceOrder = async () => {
    if (!canPlaceOrder) return;
    setPlacingOrder(true);
    try {
      const items = cartItems.map(({ name, weight, cost, qty }) => ({ name, weight, cost, qty }));
      const res = await api.post('/user/orders', { address_id: selectedAddressId || null, items, coupon_code: appliedCouponCode });
      const newOrder = res.data.data;
      setOrders(prev => [newOrder, ...prev]);
      setOrderSuccess(newOrder.order_id);
      setCart({});
      handleRemoveCoupon();
      setFeedbackPromptOrder(newOrder.order_id);
      setOrderRating(null);
      setOrderFeedbackText("");
      setOrderFeedbackDone(false);
    } catch (err) {
      console.error("Order failed:", err);
      alert("Could not place your order. Ensure the backend is running.");
    } finally {
      setPlacingOrder(false);
    }
  };

  const ORDER_RATINGS = [
    { key: 'Sad', emoji: '😞', label: 'Not great' },
    { key: 'Good', emoji: '🙂', label: 'Good' },
    { key: 'Excellent', emoji: '🤩', label: 'Excellent' }
  ];

  const handleSkipOrderFeedback = () => {
    setFeedbackPromptOrder(null);
  };

  const handleSubmitOrderFeedback = async () => {
    if (!orderRating) return;
    setOrderFeedbackSubmitting(true);
    try {
      const comment = orderFeedbackText.trim() || `Customer rated this order as ${orderRating.toLowerCase()}.`;
      const text = `[Order Feedback | Order ${feedbackPromptOrder} | Rating: ${orderRating}] ${comment}`;
      await api.post('/user/submit-feedback', { text, image_data: null });
      setOrderFeedbackDone(true);
      setTimeout(() => setFeedbackPromptOrder(null), 1800);
    } catch (err) {
      console.error("Order feedback submission failed:", err);
      alert("Could not submit your feedback. Ensure the backend is running.");
    } finally {
      setOrderFeedbackSubmitting(false);
    }
  };

  // ---- Addresses ----
  const resetAddressForm = () => {
    setAddressForm(EMPTY_ADDRESS_FORM);
    setEditingAddressId(null);
    setShowAddressForm(false);
  };

  const handleEditAddress = (address) => {
    setAddressForm({
      label: address.label, full_name: address.full_name, phone: address.phone,
      line1: address.line1, line2: address.line2 || "", city: address.city, state: address.state,
      pincode: address.pincode, is_default: address.is_default
    });
    setEditingAddressId(address.id);
    setShowAddressForm(true);
  };

  const handleSaveAddress = async (e) => {
    e.preventDefault();
    setSavingAddress(true);
    try {
      const res = editingAddressId
        ? await api.put(`/user/addresses/${editingAddressId}`, addressForm)
        : await api.post('/user/addresses', addressForm);
      const saved = res.data.data;

      setAddresses(prev => {
        const withoutSaved = prev.filter(a => a.id !== saved.id);
        const next = saved.is_default
          ? withoutSaved.map(a => ({ ...a, is_default: false }))
          : withoutSaved;
        return [...next, saved];
      });
      if (saved.is_default || addresses.length === 0) setSelectedAddressId(saved.id);
      resetAddressForm();
    } catch (err) {
      console.error("Save address failed:", err);
      alert("Could not save this address. Ensure the backend is running.");
    } finally {
      setSavingAddress(false);
    }
  };

  const handleDeleteAddress = async (address) => {
    const confirmed = window.confirm(`Delete the "${address.label}" address?`);
    if (!confirmed) return;
    try {
      await api.delete(`/user/addresses/${address.id}`);
      setAddresses(prev => prev.filter(a => a.id !== address.id));
      if (selectedAddressId === address.id) setSelectedAddressId("");
    } catch (err) {
      console.error("Delete address failed:", err);
      alert("Could not delete this address. Ensure the backend is running.");
    }
  };

  // ---- Profile Settings ----
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSaved(false);
    try {
      const res = await api.put('/user/profile', profileForm);
      setProfileForm(res.data.data);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch (err) {
      console.error("Save profile failed:", err);
      alert("Could not save your profile. Ensure the backend is running.");
    } finally {
      setSavingProfile(false);
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
          <p>Sign in to your account</p>
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

  // ---- Views ----
  const renderPlaceOrder = () => (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2 style={{ marginBottom: 0 }}>Groceries</h2>
          <div className="grocery-search-wrap">
            <div className="grocery-search-input-wrap">
              <Search size={16} className="grocery-search-icon" />
              <input
                className="grocery-search-input"
                placeholder="Search groceries..."
                value={grocerySearch}
                onChange={(e) => setGrocerySearch(e.target.value)}
              />
              {grocerySearch && (
                <button type="button" className="grocery-search-clear" onClick={() => setGrocerySearch("")}>
                  <X size={14} />
                </button>
              )}
            </div>
            {grocerySearch.trim() && (
              <div className="grocery-search-popup">
                {grocerySearchMatches.length === 0 ? (
                  <div className="grocery-search-empty">No matches for &quot;{grocerySearch}&quot;</div>
                ) : grocerySearchMatches.map(item => (
                  <div key={item.id} className="grocery-search-result" onClick={() => changeQty(item.id, 1)}>
                    <span>{item.emoji}</span>
                    <span className="grocery-search-result-name">{item.name} <span style={{ color: 'var(--text-muted)' }}>({item.weight})</span></span>
                    <span className="grocery-search-result-cost">₹{item.cost}</span>
                    <Plus size={14} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="grocery-grid">
          {GROCERY_CATALOG.map(item => {
            const qty = cart[item.id] || 0;
            return (
              <div key={item.id} className="grocery-card">
                <div className="grocery-card-image">{item.emoji}</div>
                <div className="grocery-card-name">{item.name}</div>
                <div className="grocery-card-weight">{item.weight}</div>
                <div className="grocery-card-footer">
                  <div className="grocery-card-cost">₹{item.cost}</div>
                  <div className="qty-stepper">
                    <button type="button" className="qty-btn" onClick={() => changeQty(item.id, -1)} disabled={qty === 0}>
                      <Minus size={14} />
                    </button>
                    <span className="qty-value">{qty}</span>
                    <button type="button" className="qty-btn" onClick={() => changeQty(item.id, 1)}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Have a Coupon?</h2>
        {appliedCouponCode ? (
          <div className="coupon-applied-chip">
            <span><Tag size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />{appliedCouponCode} applied</span>
            <button type="button" onClick={handleRemoveCoupon}><X size={13} style={{ verticalAlign: 'middle' }} /> Remove</button>
          </div>
        ) : (
          <div className="coupon-apply-row">
            <input
              placeholder="Enter coupon code"
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
            />
            <button
              className="btn-primary"
              onClick={() => applyCouponCode(couponInput)}
              disabled={applyingCoupon || !couponInput.trim() || cartCount === 0}
            >
              {applyingCoupon ? <><span className="loading-spinner"></span> Checking...</> : 'Apply'}
            </button>
          </div>
        )}
        {couponError && <div className="login-error">{couponError}</div>}
        <a href="#" onClick={(e) => { e.preventDefault(); setActiveTab('Coupons'); }} style={{ color: 'var(--sidebar-active-bg)', fontWeight: 600, fontSize: '0.9rem' }}>
          View available coupons
        </a>
      </div>

      <div className="card">
        <h2>Deliver To</h2>
        {addresses.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)' }}>
            You haven't added an address yet. <a href="#" onClick={(e) => { e.preventDefault(); setActiveTab('Addresses'); }} style={{ color: 'var(--sidebar-active-bg)', fontWeight: 600 }}>Add one now</a> so we know where to deliver your order.
          </div>
        ) : (
          <div className="address-grid">
            {addresses.map(address => (
              <div
                key={address.id}
                className={`address-card ${selectedAddressId === address.id ? 'selected' : ''}`}
                onClick={() => setSelectedAddressId(address.id)}
              >
                <div className="address-card-label">
                  {address.label} {address.is_default && <Star size={14} fill="#f59e0b" color="#f59e0b" />}
                </div>
                <div className="address-card-body">
                  {address.full_name} &middot; {address.phone}<br />
                  {address.line1}, {address.city}, {address.state} {address.pincode}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {orderSuccess && (
        <div className="submit-success">
          <CheckCircle2 size={20} color="#10b981" />
          <div>
            <strong>Order placed!</strong>
            <p>Your order reference is <strong>{orderSuccess}</strong>. Track it under My Orders.</p>
          </div>
        </div>
      )}

      {cartCount > 0 && preview && (
        <div className="card">
          <h2>Order Summary</h2>
          {cartItems.map(item => (
            <div key={item.id} className="order-summary-row">
              <span>{item.emoji} {item.name} <span style={{ color: 'var(--text-muted)' }}>x{item.qty}</span></span>
              <span>₹{item.cost * item.qty}</span>
            </div>
          ))}
          <div className="order-summary-row" style={{ borderTop: '1px solid var(--border-color)', marginTop: '0.5rem', paddingTop: '0.75rem' }}>
            <span>Subtotal</span>
            <span>₹{preview.subtotal}</span>
          </div>
          {preview.discount > 0 && (
            <div className="order-summary-row discount">
              <span>Coupon discount {appliedCouponCode ? `(${appliedCouponCode})` : ''}</span>
              <span>-₹{preview.discount}</span>
            </div>
          )}
          <div className="order-summary-row">
            <span>Delivery Fee</span>
            <span>{preview.delivery_fee === 0 ? 'FREE' : `₹${preview.delivery_fee}`}</span>
          </div>
          <div className="order-summary-row">
            <span>Tax</span>
            <span>₹{preview.tax}</span>
          </div>
          <div className="order-summary-row total">
            <span>Total</span>
            <span>₹{preview.total}</span>
          </div>
        </div>
      )}

      {cartCount > 0 && !selectedAddressId && (
        <div className="login-error" style={{ marginBottom: '1rem' }}>
          Please select or add a delivery address before placing your order.
        </div>
      )}

      <div className="cart-bar">
        <div className="cart-bar-summary">
          <div>{cartCount} item{cartCount === 1 ? '' : 's'} in cart</div>
          {cartSummaryText && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>{cartSummaryText}</div>}
        </div>
        <div className="cart-bar-total">₹{preview ? preview.total : cartTotal}</div>
        <button className="btn-primary" onClick={handlePlaceOrder} disabled={!canPlaceOrder}>
          {placingOrder ? <><span className="loading-spinner"></span> Placing Order...</> : <><ShoppingCart size={16} /> Place Order</>}
        </button>
      </div>
    </>
  );

  const renderCoupons = () => (
    <div className="card">
      <h2>Available Coupons</h2>
      <div className="coupon-grid">
        {coupons.map(c => (
          <div key={c.code} className="coupon-card">
            <div className="coupon-card-code"><Tag size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />{c.code}</div>
            <div className="coupon-card-desc">{c.description}</div>
            <div className="coupon-card-min">Minimum order ₹{c.min_order}</div>
            <button
              className="btn-secondary"
              onClick={() => { applyCouponCode(c.code); setActiveTab('Place Order'); }}
            >
              Apply at Checkout
            </button>
          </div>
        ))}
        {coupons.length === 0 && (
          <div style={{ color: 'var(--text-muted)' }}>No coupons available right now.</div>
        )}
      </div>
    </div>
  );

  const renderMyOrders = () => (
    <div className="card">
      <h2>My Orders</h2>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
              <th>Placed</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No orders yet. Place your first order from the Place Order tab.
                </td>
              </tr>
            )}
            {orders.map(order => (
              <tr key={order.id}>
                <td className="font-semibold" style={{ fontFamily: 'monospace' }}>{order.order_id}</td>
                <td style={{ color: 'var(--text-secondary)' }}>
                  {order.items.map(i => `${i.name} x${i.qty}`).join(', ')}
                </td>
                <td className="font-semibold">
                  ₹{order.total}
                  {order.coupon_code && (
                    <div style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 500 }}>
                      {order.coupon_code} saved ₹{order.discount}
                    </div>
                  )}
                </td>
                <td><span className="badge badge-low">{order.status}</span></td>
                <td style={{ color: 'var(--text-secondary)' }}>{new Date(order.placed_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderAddresses = () => (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: 0 }}>Addresses</h2>
        {!showAddressForm && (
          <button className="btn-primary" onClick={() => setShowAddressForm(true)}>
            <Plus size={16} /> Add Address
          </button>
        )}
      </div>

      {showAddressForm && (
        <form onSubmit={handleSaveAddress} style={{ marginBottom: '1.5rem' }}>
          <div className="form-grid">
            <div className="form-field">
              <label>Label</label>
              <input value={addressForm.label} onChange={(e) => setAddressForm({ ...addressForm, label: e.target.value })} placeholder="Home / Work / Other" required />
            </div>
            <div className="form-field">
              <label>Full Name</label>
              <input value={addressForm.full_name} onChange={(e) => setAddressForm({ ...addressForm, full_name: e.target.value })} required />
            </div>
            <div className="form-field">
              <label>Phone</label>
              <input value={addressForm.phone} onChange={(e) => setAddressForm({ ...addressForm, phone: e.target.value })} required />
            </div>
            <div className="form-field">
              <label>Pincode</label>
              <input value={addressForm.pincode} onChange={(e) => setAddressForm({ ...addressForm, pincode: e.target.value })} required />
            </div>
            <div className="form-field form-field-full">
              <label>Address Line 1</label>
              <input value={addressForm.line1} onChange={(e) => setAddressForm({ ...addressForm, line1: e.target.value })} required />
            </div>
            <div className="form-field form-field-full">
              <label>Address Line 2 (optional)</label>
              <input value={addressForm.line2} onChange={(e) => setAddressForm({ ...addressForm, line2: e.target.value })} />
            </div>
            <div className="form-field">
              <label>City</label>
              <input value={addressForm.city} onChange={(e) => setAddressForm({ ...addressForm, city: e.target.value })} required />
            </div>
            <div className="form-field">
              <label>State</label>
              <input value={addressForm.state} onChange={(e) => setAddressForm({ ...addressForm, state: e.target.value })} required />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={addressForm.is_default} onChange={(e) => setAddressForm({ ...addressForm, is_default: e.target.checked })} />
            Set as default address
          </label>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" className="btn-primary" disabled={savingAddress}>
              {savingAddress ? <><span className="loading-spinner"></span> Saving...</> : (editingAddressId ? 'Update Address' : 'Save Address')}
            </button>
            <button type="button" className="btn-secondary" onClick={resetAddressForm}>Cancel</button>
          </div>
        </form>
      )}

      {addresses.length === 0 && !showAddressForm ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          <MapPin size={24} style={{ display: 'block', margin: '0 auto 0.5rem' }} />
          No addresses saved yet.
        </div>
      ) : (
        <div className="address-grid">
          {addresses.map(address => (
            <div key={address.id} className="address-card" style={{ cursor: 'default' }}>
              <div className="address-card-label">
                {address.label} {address.is_default && <Star size={14} fill="#f59e0b" color="#f59e0b" />}
              </div>
              <div className="address-card-body">
                {address.full_name} &middot; {address.phone}<br />
                {address.line1}{address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.state} {address.pincode}
              </div>
              <div className="address-card-actions">
                <button className="btn-secondary" onClick={() => handleEditAddress(address)}>
                  <Pencil size={13} /> Edit
                </button>
                <button className="btn-secondary" style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }} onClick={() => handleDeleteAddress(address)}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderProfileSettings = () => (
    <div className="card">
      <h2>Profile Settings</h2>
      <form onSubmit={handleSaveProfile}>
        <div className="form-grid">
          <div className="form-field">
            <label>Full Name</label>
            <input value={profileForm.full_name} onChange={(e) => { setProfileSaved(false); setProfileForm({ ...profileForm, full_name: e.target.value }); }} required />
          </div>
          <div className="form-field">
            <label>Email</label>
            <input type="email" value={profileForm.email} onChange={(e) => { setProfileSaved(false); setProfileForm({ ...profileForm, email: e.target.value }); }} required />
          </div>
          <div className="form-field">
            <label>Phone</label>
            <input value={profileForm.phone} onChange={(e) => { setProfileSaved(false); setProfileForm({ ...profileForm, phone: e.target.value }); }} required />
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={savingProfile}>
          {savingProfile ? <><span className="loading-spinner"></span> Saving...</> : 'Save Changes'}
        </button>
        {profileSaved && <span style={{ marginLeft: '1rem', color: '#10b981', fontWeight: 600 }}>Saved!</span>}
      </form>
    </div>
  );

  const renderHelpCentre = () => (
    <>
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
                      {issue.key === 'order' && (
                        orders.length === 0 ? (
                          <div className="login-error" style={{ marginBottom: '1rem' }}>
                            You don't have any orders yet — place one first so we can link your feedback to it.
                          </div>
                        ) : (
                          <>
                            <div className="login-input-group">
                              <Hash size={16} className="login-input-icon" />
                              <select
                                className="login-input"
                                value={orderId}
                                onChange={(e) => { setOrderId(e.target.value); setSelectedOrderItems([]); }}
                                required
                              >
                                <option value="">Select the order this is about...</option>
                                {orders.map(o => (
                                  <option key={o.id} value={o.order_id}>
                                    {o.order_id} — {new Date(o.placed_at).toLocaleDateString()} (₹{o.total})
                                  </option>
                                ))}
                              </select>
                            </div>

                            {selectedOrderForFeedback && (
                              <div style={{ marginBottom: '1rem' }}>
                                <p className="accordion-hint" style={{ marginBottom: '0.5rem' }}>Which item(s) does this concern?</p>
                                {selectedOrderForFeedback.items.map(item => (
                                  <label key={item.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    <input
                                      type="checkbox"
                                      style={{ width: 'auto' }}
                                      checked={selectedOrderItems.includes(item.name)}
                                      onChange={() => toggleOrderItem(item.name)}
                                    />
                                    {item.name} (x{item.qty})
                                  </label>
                                ))}
                              </div>
                            )}
                          </>
                        )
                      )}

                      <textarea
                        className="login-input feedback-textarea"
                        placeholder="Tell us what happened &mdash; we're listening..."
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={4}
                        required
                      />

                      <div className="feedback-image-upload">
                        {feedbackImage ? (
                          <div className="feedback-image-preview">
                            <img src={feedbackImage} alt="Attached" />
                            <button type="button" onClick={() => setFeedbackImage(null)}>
                              <X size={13} style={{ verticalAlign: 'middle' }} /> Remove photo
                            </button>
                          </div>
                        ) : (
                          <label className="feedback-image-label">
                            <ImagePlus size={16} /> Attach a photo (optional)
                            <input
                              type="file"
                              accept="image/*"
                              hidden
                              onChange={(e) => handleImageSelect(e.target.files?.[0])}
                            />
                          </label>
                        )}
                        {feedbackImageError && <div className="login-error">{feedbackImageError}</div>}
                      </div>

                      {submitError && <div className="login-error">{submitError}</div>}

                      <button
                        type="submit"
                        className="login-btn"
                        style={{ background: '#14b8a6', maxWidth: '220px' }}
                        disabled={isSubmitting || !message.trim() || (issue.key === 'order' && (orders.length === 0 || !orderId))}
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
    </>
  );

  const TAB_SUBTITLES = {
    'Place Order': 'Pick your groceries and check out in a few taps.',
    'Coupons': 'Save more with these codes.',
    'My Orders': 'Track every order you have placed.',
    'Addresses': 'Manage where your orders get delivered.',
    'Profile Settings': 'Keep your contact details up to date.',
    'Help Centre': 'How can we help you today?'
  };

  const NavItem = ({ icon: Icon, label, badge }) => (
    <div
      className={`nav-item ${activeTab === label ? 'active' : ''}`}
      onClick={() => setActiveTab(label)}
    >
      <Icon size={18} /> {label}
      {badge > 0 && <span className="nav-badge">{badge}</span>}
    </div>
  );

  // ---- Portal ----
  return (
    <div className={`app-layout ${isDarkMode ? 'dark-theme' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="portal-card-icon portal-card-icon-user" style={{ margin: 0, padding: '6px' }}>
            <LifeBuoy size={20} color="white" />
          </div>
          My Account
        </div>

        <div className="nav-section">
          <NavItem icon={ShoppingCart} label="Place Order" />
          <NavItem icon={Tag} label="Coupons" />
          <NavItem icon={Package} label="My Orders" />
          <NavItem icon={MapPin} label="Addresses" />
          <NavItem icon={Settings} label="Profile Settings" />
          <NavItem icon={LifeBuoy} label="Help Centre" />
        </div>

        <div className="sidebar-footer">
          <Link to="/" className="nav-item">
            <Home size={18} /> Home
          </Link>
          <div className="nav-item" onClick={() => setIsDarkMode(!isDarkMode)}>
            {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            {isDarkMode ? "Light Mode" : "Dark Mode"}
          </div>
          <div className="nav-item" style={{ color: '#ef4444' }} onClick={handleSignOut}>
            <LogOut size={18} /> Sign Out
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-header">
          <div className="header-title">
            <h1><MessageSquarePlus size={24} color="#14b8a6" /> {activeTab}</h1>
            <p>{TAB_SUBTITLES[activeTab]}</p>
          </div>
        </header>

        <div className="fade-in">
          {activeTab === 'Place Order' && renderPlaceOrder()}
          {activeTab === 'Coupons' && renderCoupons()}
          {activeTab === 'My Orders' && renderMyOrders()}
          {activeTab === 'Addresses' && renderAddresses()}
          {activeTab === 'Profile Settings' && renderProfileSettings()}
          {activeTab === 'Help Centre' && renderHelpCentre()}
        </div>
      </main>

      {feedbackPromptOrder && (
        <div className="order-feedback-overlay">
          <div className="order-feedback-modal fade-in">
            {orderFeedbackDone ? (
              <>
                <CheckCircle2 size={40} color="#10b981" style={{ margin: '0 auto 1rem', display: 'block' }} />
                <h2 style={{ textAlign: 'center' }}>Thank you!</h2>
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Your feedback helps us improve.</p>
              </>
            ) : (
              <>
                <button type="button" className="order-feedback-close" onClick={handleSkipOrderFeedback}><X size={18} /></button>
                <h2 style={{ textAlign: 'center' }}>Your feedback matters!</h2>
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                  How was your experience with order <strong>{feedbackPromptOrder}</strong>?
                </p>
                <div className="order-rating-row">
                  {ORDER_RATINGS.map(r => (
                    <button
                      type="button"
                      key={r.key}
                      className={`order-rating-btn ${orderRating === r.key ? 'selected' : ''}`}
                      onClick={() => setOrderRating(r.key)}
                    >
                      <span className="order-rating-emoji">{r.emoji}</span>
                      <span>{r.label}</span>
                    </button>
                  ))}
                </div>
                <textarea
                  className="login-input feedback-textarea"
                  placeholder="Tell us more (optional)..."
                  value={orderFeedbackText}
                  onChange={(e) => setOrderFeedbackText(e.target.value)}
                  rows={3}
                  style={{ marginTop: '1.25rem' }}
                />
                <button
                  className="btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
                  onClick={handleSubmitOrderFeedback}
                  disabled={!orderRating || orderFeedbackSubmitting}
                >
                  {orderFeedbackSubmitting ? <><span className="loading-spinner"></span> Submitting...</> : <><Send size={16} /> Submit Feedback</>}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default UserPortal;
