import React, { useState, useEffect } from 'react';
import { Activity, Shield, Cpu, Zap, Search, Bell, History, ArrowUpRight, TrendingUp } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Signal {
  id: string;
  source: string;
  summary: string;
  relevance: number;
  sentiment: string;
  timestamp: number;
  urgent: boolean;
}

const App: React.FC = () => {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [status, setStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8787/ws');

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
          urgent: intel.is_urgent
        }, ...prev].slice(0, 50));
      }
    };

    return () => ws.close();
  }, []);

  return (
    <div className="min-h-screen p-6 flex flex-col gap-6">
      {/* Header */}
      <header className="flex justify-between items-center glass p-4 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="bg-accent/20 p-2 rounded-lg">
            <Cpu className="text-accent w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-xl tracking-tight">CONTENT REFINERY</h1>
            <p className="text-xs text-white/50 font-mono uppercase tracking-widest">Institutional Intelligence v1.5</p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <nav className="hidden md:flex items-center gap-4 text-sm font-medium text-white/60">
            <a href="#" className="text-white hover:text-accent transition-colors">Real-time</a>
            <a href="#" className="hover:text-accent transition-colors">Historical</a>
            <a href="#" className="hover:text-accent transition-colors">Relational</a>
            <a href="#" className="hover:text-accent transition-colors">Settings</a>
          </nav>

          <div className="flex items-center gap-2 glass px-3 py-1 rounded-full text-xs font-mono">
            <div className={cn("w-2 h-2 rounded-full",
              status === 'online' ? "bg-success animate-pulse" : "bg-danger"
            )} />
            {status.toUpperCase()}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Signal Feed */}
        <section className="col-span-2 flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <h2 className="flex items-center gap-2 font-semibold">
              <Zap className="text-accent w-4 h-4" />
              Intelligence Feed
            </h2>
            <div className="flex gap-2">
              <button className="glass p-2 rounded-lg hover:bg-white/5 transition-colors"><Search className="w-4 h-4" /></button>
              <button className="glass p-2 rounded-lg hover:bg-white/5 transition-colors"><Bell className="w-4 h-4" /></button>
            </div>
          </div>

          <div className="flex-1 glass rounded-2xl overflow-hidden flex flex-col">
            <div className="grid grid-cols-4 text-xs font-mono text-white/40 p-4 border-b border-white/5">
              <span>SOURCE</span>
              <span className="col-span-2">SUMMARY</span>
              <span className="text-right">IMPACT</span>
            </div>
            <div className="flex-1 overflow-y-auto terminal-scroll p-4 space-y-4">
              {signals.length === 0 ? (
                <div className="h-full flex items-center justify-center text-white/20 italic">
                  Waiting for incoming signals...
                </div>
              ) : (
                signals.map(s => (
                  <div key={s.id} className={cn(
                    "grid grid-cols-4 items-center p-3 rounded-lg border border-transparent transition-all",
                    s.urgent ? "bg-danger/5 border-danger/20" : "hover:bg-white/5"
                  )}>
                    <span className="text-xs font-mono font-bold text-accent">{s.source}</span>
                    <span className="col-span-2 text-sm line-clamp-1">{s.summary}</span>
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
        </section>

        {/* Sidebar Intelligence */}
        <aside className="flex flex-col gap-6">
          {/* Alpha Forecast Card */}
          <div className="glass p-5 rounded-2xl bg-gradient-to-br from-accent/10 to-transparent">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold flex items-center gap-2">
                <TrendingUp className="text-accent w-5 h-5" />
                Alpha Engine
              </h3>
              <ArrowUpRight className="text-white/20 w-5 h-5" />
            </div>
            <div className="space-y-4">
              <div className="flex justify-between text-xs">
                <span className="text-white/40">Market Confidence</span>
                <span className="text-success font-mono font-bold">87.4%</span>
              </div>
              <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-success" style={{ width: '87.4%' }} />
              </div>
              <p className="text-xs text-white/60 leading-relaxed italic">
                Predictive layer identified high-correlation Q1 precedent. $AAPL target impact 2.4% over 48h.
              </p>
            </div>
          </div>

          {/* Network Stats */}
          <div className="glass p-5 rounded-2xl flex-1 flex flex-col gap-4">
            <h3 className="font-bold flex items-center gap-2">
              <Activity className="text-accent w-5 h-5" />
              Network Metrics
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-[10px] text-white/40 uppercase font-bold mb-1">Total Signals</p>
                <p className="text-2xl font-mono font-bold">1.2k</p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                <p className="text-[10px] text-white/40 uppercase font-bold mb-1">Latency</p>
                <p className="text-2xl font-mono font-bold text-success">42ms</p>
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
    </div>
  );
};

export default App;
