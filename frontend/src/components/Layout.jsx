import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: '📊' },
  { label: 'New Deployment', path: '/create', icon: '🚀' },
  { label: 'Activity', path: '/activity', icon: '📜' },
  { label: 'Settings', path: '/settings', icon: '⚙️' },
];

export default function Layout({ children, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col lg:flex-row">
      {/* Mobile Top Bar */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white rounded-xl flex items-center justify-center">
            <span className="text-zinc-900 font-bold text-[10px] tracking-[-0.5px]">HGU</span>
          </div>
          <div>
            <div className="font-semibold tracking-tight">DevOps Hub</div>
            <div className="text-[10px] text-zinc-500 -mt-0.5">Handong University</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onLogout && (
            <button
              onClick={onLogout}
              className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 rounded-lg transition"
            >
              Logout
            </button>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-zinc-800"
            aria-label="Toggle menu"
          >
            <span className="text-xl">☰</span>
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <div className={`
        ${sidebarOpen ? 'block' : 'hidden'} lg:block
        w-full lg:w-64 bg-zinc-900 border-b lg:border-r border-zinc-800 flex flex-col lg:h-screen
      `}>
        {/* Desktop Header */}
        <div className="hidden lg:block p-6 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white rounded-2xl flex items-center justify-center">
              <span className="text-zinc-900 font-bold text-sm tracking-[-0.5px]">HGU</span>
            </div>
            <div>
              <div className="font-semibold text-lg tracking-tight">DevOps Hub</div>
              <div className="text-[10px] text-zinc-500 -mt-0.5">Handong University</div>
            </div>
          </div>
        </div>

        <div className="p-3 flex-1 overflow-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path || 
                            (item.path === '/dashboard' && location.pathname === '/');
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium mb-1 transition-all
                  ${isActive 
                    ? 'bg-zinc-800 text-white' 
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-900'}`}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="hidden lg:block p-4 border-t border-zinc-800">
          {onLogout && (
            <button
              onClick={onLogout}
              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-800 rounded-xl transition flex items-center gap-2"
            >
              <span>⎋</span>
              <span>Logout</span>
            </button>
          )}
          <div className="mt-3 text-[10px] text-zinc-500 px-4">
            Team 8 • Software Engineering
          </div>
        </div>
      </div>

      {/* Main Content - constrained height on desktop so only this side scrolls, sidebar stays full h-screen */}
      <div className="flex-1 flex flex-col min-w-0 lg:h-screen">
        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
