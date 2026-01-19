import React, { useState, useEffect, useRef } from 'react';
import { Activity, Shield, Cpu, Zap, Search, Bell, History, ArrowUpRight, TrendingUp, MessageCircle, X, Phone, Key, Lock, QrCode, Smartphone, Settings, Plus, Trash2, Rss, Hash, Globe, Share2 } from 'lucide-react';
import ForceGraph2D from 'react-force-graph-2d';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const API_BASE = 'https://api.moecapital.com';

interface Signal {
  id: string;
  source: string;
  summary: string;
  relevance: number;
  sentiment: string;
  timestamp: number;
  urgent: boolean;
  tags?: string[];
}

interface RSSFeed {
  id: string;
  name: string;
  feed_url: string;
  last_ingested_at?: number;
}

interface AlphaNode {
  id: string;
  label: string;
  alpha_score: number;
  sentiment_score: number;
  velocity: number;
}

interface Narrative {
  id: string;
  title: string;
  summary: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  signals: string[];
  created_at: number;
}

type TelegramStatus = 'unconfigured' | 'offline' | 'online' | 'error' | 'loading';

const TelegramLoginModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}> = ({ isOpen, onClose, onSuccess }) => {
  const [loginMethod, setLoginMethod] = useState<'qr' | 'phone'>('qr');
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // QR Login state
  const [qrUrl, setQrUrl] = useState('');
  const [qrToken, setQrToken] = useState('');
  const [qrPolling, setQrPolling] = useState(false);
  const [qr2faRequired, setQr2faRequired] = useState(false);
  const pollingRef = useRef<number | null>(null);

  // Fetch QR token on mount
  const fetchQrToken = async () => {
    try {
      const res = await fetch(`${API_BASE}/telegram/auth/qr-token`);
      const data = await res.json();
      if (data.success) {
        setQrUrl(data.url);
        setQrToken(data.token);
        startPolling();
      } else {
        setError(data.error || 'Failed to get QR code');
      }
    } catch (e) {
      setError('Network error fetching QR code');
    }
  };

  const startPolling = () => {
    if (pollingRef.current) return;
    setQrPolling(true);

    pollingRef.current = window.setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/telegram/auth/qr-check`);
        const data = await res.json();
        if (data.loggedIn) {
          stopPolling();
          onSuccess();
          onClose();
        } else if (data.needsPassword) {
          stopPolling();
          setQr2faRequired(true);
          setError('');
        }
      } catch (e) {
        // Continue polling
      }
    }, 2000);
  };

  const stopPolling = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setQrPolling(false);
  };

  useEffect(() => {
    if (isOpen && loginMethod === 'qr') {
      fetchQrToken();
    }
    return () => stopPolling();
  }, [isOpen, loginMethod]);

  const handleSendCode = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/telegram/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const data = await res.json();
      if (data.success) {
        setStep('code');
      } else {
        setError(data.error || 'Failed to send code');
      }
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/telegram/auth/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, password: password || undefined })
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
        onClose();
      } else if (data.requires2FA) {
        setStep('password');
        setError('');
      } else {
        setError(data.error || 'Login failed. Check code or password.');
      }
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handler for QR 2FA password submission
  const handleQr2faPassword = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/telegram/auth/qr-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
        onClose();
      } else {
        setError(data.error || 'Password verification failed.');
      }
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const qrCodeImageUrl = qrToken
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrUrl)}`
    : '';

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass rounded-2xl p-6 w-full max-w-md relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/40 hover:text-white">
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="bg-accent/20 p-2 rounded-lg">
            <MessageCircle className="text-accent w-6 h-6" />
          </div>
          <div>
            <h2 className="font-bold text-lg">Telegram Login</h2>
            <p className="text-xs text-white/50">Connect your account for live ingestion</p>
          </div>
        </div>

        {/* Login Method Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => { setLoginMethod('qr'); stopPolling(); fetchQrToken(); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
              loginMethod === 'qr' ? "bg-accent/20 text-accent" : "glass text-white/60 hover:text-white"
            )}
          >
            <QrCode className="w-4 h-4" />
            QR Code
          </button>
          <button
            onClick={() => { setLoginMethod('phone'); stopPolling(); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all",
              loginMethod === 'phone' ? "bg-accent/20 text-accent" : "glass text-white/60 hover:text-white"
            )}
          >
            <Phone className="w-4 h-4" />
            Phone
          </button>
        </div>

        {error && (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 mb-4 text-sm text-danger">
            {error}
          </div>
        )}

        {/* QR Login */}
        {loginMethod === 'qr' && (
          <div className="text-center space-y-4">
            {qr2faRequired ? (
              /* 2FA Password Form for QR Login */
              <div className="space-y-4 text-left">
                <div className="text-center mb-4">
                  <div className="bg-success/20 p-3 rounded-full inline-block mb-2">
                    <Shield className="w-8 h-8 text-success" />
                  </div>
                  <p className="text-sm text-white/60">QR scan successful! Enter your 2FA password.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-white/60 font-mono uppercase">2FA Password</label>
                  <div className="flex items-center gap-2 glass rounded-lg p-3">
                    <Lock className="w-4 h-4 text-accent" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your 2FA password"
                      className="flex-1 bg-transparent outline-none text-sm"
                    />
                  </div>
                </div>
                <button
                  onClick={handleQr2faPassword}
                  disabled={!password || loading}
                  className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-black font-bold py-3 rounded-lg transition-colors"
                >
                  {loading ? 'Verifying...' : 'Complete Login'}
                </button>
              </div>
            ) : qrCodeImageUrl ? (
              <>
                <div className="bg-white p-4 rounded-xl inline-block relative">
                  <img src={qrCodeImageUrl} alt="Telegram Login QR Code" className="w-48 h-48" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm text-white/60">
                    <Smartphone className="w-4 h-4 inline mr-1" />
                    Scan with Telegram on your phone
                  </p>
                  <p className="text-xs text-white/40">
                    Open Telegram → Settings → Devices → Scan QR
                  </p>
                  {qrPolling && (
                    <p className="text-xs text-accent animate-pulse">
                      Waiting for scan...
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={() => { setQrToken(''); setQrUrl(''); fetchQrToken(); }}
                    className="text-xs text-white/40 hover:text-accent transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh QR
                  </button>
                  <a
                    href={qrUrl}
                    className="text-xs text-accent hover:underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open in Telegram →
                  </a>
                </div>
              </>
            ) : (
              <div className="py-8 text-white/40">Loading QR code...</div>
            )}
          </div>
        )}

        {/* Phone Login */}
        {loginMethod === 'phone' && (
          <div className="space-y-4">
            {step === 'phone' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs text-white/60 font-mono uppercase">Phone Number</label>
                  <div className="flex items-center gap-2 glass rounded-lg p-3">
                    <Phone className="w-4 h-4 text-accent" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1234567890"
                      className="flex-1 bg-transparent outline-none text-sm"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSendCode}
                  disabled={!phone || loading}
                  className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-black font-bold py-3 rounded-lg transition-colors"
                >
                  {loading ? 'Sending Code...' : 'Send Code'}
                </button>
                <p className="text-xs text-white/40 text-center">
                  Telegram will send you an authentication code
                </p>
              </>
            )}

            {step === 'code' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs text-white/60 font-mono uppercase">Verification Code</label>
                  <div className="flex items-center gap-2 glass rounded-lg p-3">
                    <Key className="w-4 h-4 text-accent" />
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="12345"
                      className="flex-1 bg-transparent outline-none text-sm font-mono tracking-widest"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSignIn}
                  disabled={!code || loading}
                  className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-black font-bold py-3 rounded-lg transition-colors"
                >
                  {loading ? 'Connecting...' : 'Sign In'}
                </button>
              </>
            )}

            {step === 'password' && (
              <>
                <div className="space-y-2">
                  <label className="text-xs text-white/60 font-mono uppercase">2FA Password</label>
                  <div className="flex items-center gap-2 glass rounded-lg p-3">
                    <Lock className="w-4 h-4 text-accent" />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Your 2FA password"
                      className="flex-1 bg-transparent outline-none text-sm"
                    />
                  </div>
                </div>
                <button
                  onClick={handleSignIn}
                  disabled={!password || loading}
                  className="w-full bg-accent hover:bg-accent/80 disabled:opacity-50 text-black font-bold py-3 rounded-lg transition-colors"
                >
                  {loading ? 'Verifying...' : 'Complete Login'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const SettingsModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
}> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'rss' | 'webhooks'>('rss');
  const [feeds, setFeeds] = useState<RSSFeed[]>([]);
  const [newFeedName, setNewFeedName] = useState('');
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchFeeds = async () => {
    try {
      const res = await fetch(`${API_BASE}/sources/rss`);
      const data = await res.json();
      if (data.feeds) setFeeds(data.feeds);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'rss') fetchFeeds();
  }, [isOpen, activeTab]);

  const handleAddFeed = async () => {
    if (!newFeedName || !newFeedUrl) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/sources/rss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newFeedName, url: newFeedUrl })
      });
      if (res.ok) {
        setNewFeedName('');
        setNewFeedUrl('');
        fetchFeeds();
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleDeleteFeed = async (id: string) => {
    if (!confirm('Remove this feed?')) return;
    try {
      await fetch(`${API_BASE}/sources/rss?id=${id}`, { method: 'DELETE' });
      fetchFeeds();
    } catch (e) { console.error(e); }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="glass rounded-2xl p-6 w-full max-w-2xl relative max-h-[80vh] overflow-hidden flex flex-col">
        <button onClick={onClose} className="absolute top-4 right-4 text-white/40 hover:text-white">
          <X className="w-5 h-5" />
        </button>

        <h2 className="font-bold text-xl mb-6 flex items-center gap-2">
          <Settings className="w-5 h-5 text-accent" />
          Source Management
        </h2>

        <div className="flex gap-4 border-b border-white/10 mb-6">
          <button
            onClick={() => setActiveTab('rss')}
            className={cn("pb-3 text-sm font-medium transition-colors border-b-2", activeTab === 'rss' ? "border-accent text-accent" : "border-transparent text-white/60 hover:text-white")}
          >
            RSS Feeds
          </button>
          <button
            onClick={() => setActiveTab('webhooks')}
            className={cn("pb-3 text-sm font-medium transition-colors border-b-2", activeTab === 'webhooks' ? "border-accent text-accent" : "border-transparent text-white/60 hover:text-white")}
          >
            Webhooks
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-2">
          {activeTab === 'rss' && (
            <div className="space-y-6">
              <div className="flex gap-2">
                <input
                  value={newFeedName}
                  onChange={(e) => setNewFeedName(e.target.value)}
                  placeholder="Feed Name (e.g. Coindesk)"
                  className="glass px-3 py-2 rounded-lg text-sm bg-white/5 outline-none focus:ring-1 ring-accent flex-1"
                />
                <input
                  value={newFeedUrl}
                  onChange={(e) => setNewFeedUrl(e.target.value)}
                  placeholder="RSS URL"
                  className="glass px-3 py-2 rounded-lg text-sm bg-white/5 outline-none focus:ring-1 ring-accent flex-[2]"
                />
                <button
                  onClick={handleAddFeed}
                  disabled={loading}
                  className="bg-accent text-black font-bold px-4 rounded-lg hover:bg-accent/80 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3">
                {feeds.map(feed => (
                  <div key={feed.id} className="glass p-3 rounded-xl flex items-center justify-between group">
                    <div className="flex items-center gap-3">
                      <div className="bg-orange-500/20 p-2 rounded-lg text-orange-500">
                        <Rss className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-sm">{feed.name}</div>
                        <div className="text-xs text-white/40 font-mono truncate max-w-[300px]">{feed.feed_url}</div>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteFeed(feed.id)} className="text-white/20 hover:text-danger p-2 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {feeds.length === 0 && <div className="text-center text-white/20 text-sm py-8">No RSS feeds configured</div>}
              </div>
            </div>
          )}

          {activeTab === 'webhooks' && (
            <div className="space-y-6">
              {[
                { type: 'generic', name: 'Generic JSON', icon: Globe, color: 'text-blue-400', bg: 'bg-blue-400/20' },
                { type: 'discord', name: 'Discord', icon: MessageCircle, color: 'text-indigo-400', bg: 'bg-indigo-400/20' },
                { type: 'slack', name: 'Slack', icon: Hash, color: 'text-emerald-400', bg: 'bg-emerald-400/20' },
              ].map(hook => (
                <div key={hook.type} className="glass p-4 rounded-xl space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg", hook.bg, hook.color)}>
                      <hook.icon className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{hook.name} Webhook</h3>
                      <p className="text-xs text-white/50">Send POST requests to this endpoint</p>
                    </div>
                  </div>
                  <div className="font-mono text-xs bg-black/30 p-3 rounded-lg flex items-center justify-between text-white/60">
                    {`${API_BASE}/webhooks/${hook.type}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const RelationalView: React.FC = () => {
  const [data, setData] = useState({ nodes: [], links: [] });
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        setWidth(entries[0].contentRect.width);
        setHeight(entries[0].contentRect.height);
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/knowledge/graph`)
      .then(res => res.json())
      .then(setData)
      .catch(e => console.error(e));
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full glass rounded-3xl overflow-hidden relative min-h-[500px] lg:min-h-[600px]">
      <div className="absolute top-4 left-4 z-10 bg-black/50 p-3 rounded-xl backdrop-blur-md border border-white/10">
        <h3 className="font-bold text-accent flex items-center gap-2 text-sm lg:text-base">
          <Share2 className="w-4 h-4" /> Market Knowledge Graph
        </h3>
        <p className="text-[10px] lg:text-xs text-white/50 font-mono">Visualizing {data.nodes.length} nodes & {data.links.length} edges</p>
      </div>

      {data.nodes.length > 0 ? (
        <ForceGraph2D
          width={width}
          height={height}
          graphData={data}
          nodeLabel="label"
          nodeColor={() => "#4ade80"}
          nodeRelSize={6}
          linkColor={() => "rgba(255,255,255,0.1)"}
          backgroundColor="rgba(0,0,0,0)"
          d3AlphaDecay={0.02}
          d3VelocityDecay={0.3}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-white/20 font-mono text-sm">
          INITIALIZING GRAPH...
        </div>
      )}
    </div>
  );
};

const NarrativeCard: React.FC<{ narrative: Narrative }> = ({ narrative }) => {
  return (
    <div className="glass p-6 rounded-3xl border border-white/5 flex flex-col gap-4 hover:bg-white/[0.02] transition-all group animate-in slide-in-from-bottom-2 duration-500">
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-accent" />
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">Market Narrative</span>
        </div>
        <div className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full uppercase border font-mono",
          narrative.sentiment === 'positive' ? "text-success border-success/30 bg-success/10" :
            narrative.sentiment === 'negative' ? "text-danger border-danger/30 bg-danger/10" :
              "text-white/40 border-white/10"
        )}>
          {narrative.sentiment}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold tracking-tight mb-2 group-hover:text-accent transition-colors">
          {narrative.title}
        </h3>
        <p className="text-sm text-white/60 leading-relaxed font-medium">
          {narrative.summary}
        </p>
      </div>

      <div className="flex items-center justify-between mt-auto pt-4 border-t border-white/5">
        <div className="flex -space-x-2">
          {narrative.signals.slice(0, 3).map((_, i) => (
            <div key={i} className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur-md">
              <Zap className="w-3 h-3 text-white/40" />
            </div>
          ))}
          {narrative.signals.length > 3 && (
            <div className="w-6 h-6 rounded-full bg-white/10 border border-white/10 flex items-center justify-center backdrop-blur-md text-[8px] font-bold">
              +{narrative.signals.length - 3}
            </div>
          )}
        </div>
        <span className="text-[10px] font-mono text-white/20">
          {new Date(narrative.created_at).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
};

const BottomNav: React.FC<{
  viewMode: 'feed' | 'graph' | 'narratives';
  setViewMode: (v: 'feed' | 'graph' | 'narratives') => void;
  onSettings: () => void;
}> = ({ viewMode, setViewMode, onSettings }) => {
  return (
    <nav className="md:hidden fixed bottom-6 left-6 right-6 z-50 glass rounded-2xl p-2 px-4 flex justify-between items-center border border-white/10 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={() => setViewMode('feed')}
        className={cn("flex flex-col items-center gap-1 p-2 transition-all", viewMode === 'feed' ? "text-accent" : "text-white/40")}
      >
        <Zap className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-tighter">Feed</span>
      </button>
      <button
        onClick={() => setViewMode('narratives')}
        className={cn("flex flex-col items-center gap-1 p-2 transition-all", viewMode === 'narratives' ? "text-accent" : "text-white/40")}
      >
        <BookOpen className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-tighter">Stories</span>
      </button>
      <button
        onClick={() => setViewMode('graph')}
        className={cn("flex flex-col items-center gap-1 p-2 transition-all", viewMode === 'graph' ? "text-accent" : "text-white/40")}
      >
        <Share2 className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-tighter">Graph</span>
      </button>
      <button
        onClick={onSettings}
        className="flex flex-col items-center gap-1 p-2 text-white/40 active:text-accent transition-all"
      >
        <Settings className="w-5 h-5" />
        <span className="text-[10px] font-bold uppercase tracking-tighter">Setup</span>
      </button>
    </nav>
  );
};

const App: React.FC = () => {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [alphaNodes, setAlphaNodes] = useState<AlphaNode[]>([]);
  const [narratives, setNarratives] = useState<Narrative[]>([]);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>('unconfigured');
  const [showTelegramModal, setShowTelegramModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState<'feed' | 'graph' | 'narratives'>('feed');

  const fetchAlpha = async () => {
    try {
      const res = await fetch(`${API_BASE}/knowledge/alpha`);
      const data = await res.json();
      if (data.alphaNodes) setAlphaNodes(data.alphaNodes);
    } catch (e) { console.error(e); }
  };

  const fetchNarratives = async () => {
    try {
      const res = await fetch(`${API_BASE}/knowledge/narratives`);
      const data = await res.json();
      if (data.narratives) setNarratives(data.narratives);
    } catch (e) {
      console.error('Failed to fetch narratives:', e);
    }
  };

  useEffect(() => {
    fetchAlpha();
    fetchNarratives();
    const interval = setInterval(() => {
      fetchAlpha();
      fetchNarratives();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const checkTelegramStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/telegram/auth/status`);
      const data = await res.json();
      setTelegramStatus(data.status as TelegramStatus);
    } catch {
      setTelegramStatus('error');
    }
  };

  // Search & History State
  const [historyMode, setHistoryMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    source: '',
    sentiment: '',
    urgent: false
  });
  const [searchResults, setSearchResults] = useState<Signal[]>([]);
  const [availableSources, setAvailableSources] = useState<string[]>([]);

  const fetchSources = async () => {
    try {
      const res = await fetch(`${API_BASE}/signals/sources`);
      const data = await res.json();
      if (data.sources) setAvailableSources(data.sources);
    } catch (e) { console.error('Failed to fetch sources', e); }
  };

  const performSearch = async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.append('q', searchQuery);
      if (filters.source) params.append('source', filters.source);
      if (filters.sentiment) params.append('sentiment', filters.sentiment);
      if (filters.urgent) params.append('urgent', 'true');
      params.append('limit', '50');

      const res = await fetch(`${API_BASE}/signals/search?${params.toString()}`);
      const data = await res.json();

      setSearchResults(data.signals.map((s: any) => ({
        id: s.id,
        source: s.source_name,
        summary: s.processed_json?.summary || s.raw_text,
        relevance: s.processed_json?.relevance_score || 0,
        sentiment: s.sentiment || 'neutral',
        timestamp: s.created_at,
        urgent: s.processed_json?.is_urgent || false,
        tags: s.processed_json?.tags || []
      })));
    } catch (e) {
      console.error('Search failed', e);
    }
  };

  useEffect(() => {
    if (historyMode) {
      const timer = setTimeout(performSearch, 500);
      return () => clearTimeout(timer);
    }
  }, [historyMode, searchQuery, filters]);

  useEffect(() => {
    fetchSources();
  }, []);

  useEffect(() => {
    checkTelegramStatus();
  }, []);

  useEffect(() => {
    const ws = new WebSocket('wss://api.moecapital.com/ws');

    ws.onopen = () => setStatus('online');
    ws.onclose = () => setStatus('offline');
    ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'signal') {
        const intel = payload.data.intel;
        setSignals(prev => [{
          id: crypto.randomUUID(),
          source: payload.data.sourceName,
          summary: intel.summary,
          relevance: intel.relevance_score,
          sentiment: intel.sentiment,
          timestamp: Date.now(),
          urgent: intel.is_urgent,
          tags: intel.tags || []
        }, ...prev].slice(0, 50));
      }
    };

    return () => ws.close();
  }, []);

  return (
    <div className="min-h-screen p-4 lg:p-6 flex flex-col gap-4 lg:gap-6 pb-24 md:pb-6">
      <BottomNav
        viewMode={viewMode}
        setViewMode={setViewMode}
        onSettings={() => setShowSettings(true)}
      />
      <TelegramLoginModal
        isOpen={showTelegramModal}
        onClose={() => setShowTelegramModal(false)}
        onSuccess={checkTelegramStatus}
      />

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* Header */}
      <header className="flex justify-between items-center glass p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="bg-accent/20 p-2 rounded-lg">
            <Cpu className="text-accent w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-lg lg:text-xl tracking-tight leading-none">CONTENT REFINERY</h1>
            <p className="text-[10px] text-white/50 font-mono uppercase tracking-widest mt-1">Intelligence v1.5</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <nav className="hidden md:flex items-center gap-4 text-sm font-medium text-white/60">
            {/* View Switcher Desktop */}
            <div className="hidden md:flex glass p-1 rounded-xl items-center gap-1 border border-white/5">
              <button
                onClick={() => setViewMode('feed')}
                className={cn("px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all",
                  viewMode === 'feed' ? "bg-accent text-black shadow-lg" : "text-white/40 hover:text-white/60")}>
                Signal Feed
              </button>
              <button
                onClick={() => setViewMode('narratives')}
                className={cn("px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all",
                  viewMode === 'narratives' ? "bg-accent text-black shadow-lg" : "text-white/40 hover:text-white/60")}>
                Narratives
              </button>
              <button
                onClick={() => setViewMode('graph')}
                className={cn("px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all",
                  viewMode === 'graph' ? "bg-accent text-black shadow-lg" : "text-white/40 hover:text-white/60")}>
                Knowledge Graph
              </button>
            </div>
            <button onClick={() => setShowSettings(true)} className="hover:text-accent transition-colors">Settings</button>
          </nav>

          <button
            onClick={() => setShowTelegramModal(true)}
            className={cn(
              "flex items-center gap-2 glass px-3 py-1 rounded-full text-xs font-mono transition-all hover:bg-white/5",
              telegramStatus === 'online' ? "border border-success/30" : "border border-white/10"
            )}
          >
            <MessageCircle className="w-3 h-3" />
            <div className={cn("w-2 h-2 rounded-full",
              telegramStatus === 'online' ? "bg-success animate-pulse" :
                telegramStatus === 'offline' ? "bg-warning" :
                  telegramStatus === 'unconfigured' ? "bg-danger" : "bg-white/30"
            )} />
            {telegramStatus === 'online' ? 'TG LIVE' : telegramStatus === 'offline' ? 'TG READY' : 'TG SETUP'}
          </button>

          <div className="hidden sm:flex items-center gap-2 glass px-3 py-1 rounded-full text-[10px] font-mono border border-white/5">
            <div className={cn("w-1.5 h-1.5 rounded-full",
              status === 'online' ? "bg-success animate-pulse" : "bg-danger"
            )} />
            {status.toUpperCase()}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className={cn(
        "flex-1 overflow-hidden",
        viewMode === 'feed' ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : "flex flex-col"
      )}>
        {viewMode === 'feed' ? (
          <>
            {/* Feed Section - Col 1 & 2 */}
            <div className="lg:col-span-2 flex flex-col gap-6 overflow-hidden">
              <div className="flex justify-between items-center">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Zap className="text-accent w-4 h-4" />
                  Intelligence Feed
                </h2>
                <div className="flex gap-2 items-center">
                  {historyMode && (
                    <div className="flex gap-2 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/40" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search signals..."
                          className="glass pl-8 pr-3 py-1.5 rounded-lg text-xs bg-white/5 border-none outline-none focus:ring-1 ring-accent w-48"
                        />
                      </div>
                      <select
                        value={filters.source}
                        onChange={(e) => setFilters(prev => ({ ...prev, source: e.target.value }))}
                        className="glass px-2 py-1.5 rounded-lg text-xs bg-white/5 border-none outline-none focus:ring-1 ring-accent"
                      >
                        <option value="">All Sources</option>
                        {availableSources.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button
                        onClick={() => setFilters(prev => ({ ...prev, urgent: !filters.urgent }))}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-mono transition-all border",
                          filters.urgent ? "bg-danger/20 border-danger text-danger" : "glass border-transparent text-white/60"
                        )}
                      >
                        URGENT
                      </button>
                    </div>
                  )}
                  {!historyMode && (
                    <div className="flex gap-2">
                      <button className="glass p-2 rounded-xl hover:bg-white/5 transition-colors" onClick={() => setHistoryMode(true)}><Search className="w-4 h-4" /></button>
                      <button className="glass p-2 rounded-xl hover:bg-white/5 transition-colors"><Bell className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 glass rounded-3xl overflow-hidden flex flex-col border border-white/5">
                <div className="grid grid-cols-4 text-[10px] font-mono text-white/40 p-4 border-b border-white/5 bg-white/[0.02]">
                  <span>SOURCE</span>
                  <span className="col-span-2">SUMMARY</span>
                  <span className="text-right">ALPHA</span>
                </div>
                <div className="flex-1 overflow-y-auto terminal-scroll p-4 space-y-4">
                  {(historyMode ? searchResults : signals).length === 0 ? (
                    <div className="h-full flex items-center justify-center text-white/20 italic">
                      {historyMode ? (searchQuery ? 'No results found.' : 'Search for historical signals...') : 'Waiting for incoming signals...'}
                    </div>
                  ) : (
                    (historyMode ? searchResults : signals).map(s => (
                      <div key={s.id} className={cn(
                        "grid grid-cols-4 items-center p-3 rounded-lg border border-transparent transition-all",
                        s.urgent ? "bg-danger/5 border-danger/20" : "hover:bg-white/5"
                      )}>
                        <span className="text-xs font-mono font-bold text-accent">{s.source}</span>
                        <div className="col-span-2 space-y-1">
                          <span className="text-sm line-clamp-1 block">{s.summary}</span>
                          {s.tags && s.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {s.tags.slice(0, 3).map((tag, i) => (
                                <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-md bg-white/5 text-white/40 border border-white/5 font-mono uppercase">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className={cn("text-xs font-mono font-bold",
                            s.relevance > 80 ? "text-success" : "text-white/60"
                          )}>{s.relevance}%</span>
                          <div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full bg-accent" style={{ width: `${s.relevance}%` }} />
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Sidebar - Col 3 */}
            <div className="flex flex-col gap-6 overflow-y-auto pr-1">
              {/* Telegram Status Card */}
              <div className={cn(
                "glass p-5 rounded-2xl",
                telegramStatus === 'online' ? "bg-gradient-to-br from-success/10 to-transparent" : "bg-gradient-to-br from-accent/10 to-transparent"
              )}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold flex items-center gap-2">
                    <MessageCircle className={cn("w-5 h-5", telegramStatus === 'online' ? "text-success" : "text-accent")} />
                    Telegram Feed
                  </h3>
                  <div className={cn("w-2 h-2 rounded-full",
                    telegramStatus === 'online' ? "bg-success animate-pulse" : "bg-warning"
                  )} />
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-white/40">Status</span>
                    <span className={cn("font-mono font-bold uppercase",
                      telegramStatus === 'online' ? "text-success" : "text-warning"
                    )}>{telegramStatus}</span>
                  </div>
                  {telegramStatus !== 'online' && (
                    <button
                      onClick={() => setShowTelegramModal(true)}
                      className="w-full bg-accent/20 hover:bg-accent/30 text-accent font-bold py-2 rounded-lg transition-colors text-sm"
                    >
                      Connect Telegram
                    </button>
                  )}
                </div>
              </div>

              {/* Alpha Forecast Card */}
              <div className="glass p-5 rounded-2xl bg-gradient-to-br from-accent/10 to-transparent">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold flex items-center gap-2">
                    <TrendingUp className="text-accent w-5 h-5" />
                    Alpha Engine
                  </h3>
                  <ArrowUpRight className="text-white/20 w-5 h-5" />
                </div>

                {alphaNodes.length > 0 ? (
                  <div className="space-y-4">
                    {alphaNodes.slice(0, 3).map((node, i) => (
                      <div key={node.id} className="flex items-center justify-between group">
                        <div className="flex items-center gap-2">
                          <span className={cn("text-xs font-bold font-mono w-4 h-4 flex items-center justify-center rounded",
                            i === 0 ? "bg-accent text-black" : "bg-white/10 text-white/60"
                          )}>{i + 1}</span>
                          <div>
                            <div className="font-bold text-sm leading-none">{node.label}</div>
                            <div className="text-[10px] text-white/40 font-mono mt-0.5">
                              Vel: {node.velocity.toFixed(0)} | Sent: {node.sentiment_score > 0 ? '+' : ''}{node.sentiment_score.toFixed(1)}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold font-mono text-accent">{node.alpha_score.toFixed(1)}</div>
                          <div className="text-[10px] text-white/30 uppercase">Alpha</div>
                        </div>
                      </div>
                    ))}

                    <div className="h-px bg-white/5 my-2" />

                    <div className="flex justify-between text-xs">
                      <span className="text-white/40">Market Confidence</span>
                      <span className="text-success font-mono font-bold">
                        {(80 + (alphaNodes[0]?.sentiment_score || 0) * 2).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 text-white/20">
                    <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-xs">Gathering Alpha Data...</p>
                  </div>
                )}
              </div>

              {/* Network Stats */}
              <div className="glass p-5 rounded-3xl flex-1 flex flex-col gap-4 border border-white/5">
                <h3 className="font-bold flex items-center gap-2 text-sm">
                  <Activity className="text-accent w-5 h-5" />
                  Network Data
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 glass rounded-2xl border border-white/5 bg-white/[0.02]">
                    <p className="text-[9px] text-white/30 uppercase font-bold mb-1 tracking-widest">Throughput</p>
                    <p className="text-xl font-mono font-bold">1.2k</p>
                  </div>
                  <div className="p-3 glass rounded-2xl border border-white/5 bg-white/[0.02]">
                    <p className="text-[9px] text-white/30 uppercase font-bold mb-1 tracking-widest">Latency</p>
                    <p className="text-xl font-mono font-bold text-success">42ms</p>
                  </div>
                </div>
                <div className="flex-1 flex flex-col justify-end">
                  <div className="flex items-center gap-3 text-xs text-white/40">
                    <History className="w-4 h-4" />
                    Last reset: 14h ago
                  </div>
                </div>
              </div>
            </aside>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="glass px-6 py-2 rounded-full flex justify-between items-center text-[10px] uppercase font-mono tracking-tighter text-white/30">
        <div className="flex gap-4">
          <span>&copy; 2026 Critical Insight</span>
          <span className="flex items-center gap-1"><Shield className="w-3 h-3 text-success" /> End-to-End Encrypted</span>
        </div>
        <div className="flex gap-4">
          <span>System: OPERATIONAL</span>
          <span>Region: CF-EDGE</span>
        </div>
      </footer>
    </div >
  );
};

export default App;
