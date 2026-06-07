import React, { useState, useEffect } from 'react';
import {
    BrowserRouter,
    Routes,
    Route
} from "react-router-dom";

import Layout from "./components/Layout";
import Dashboard from "./Dashboard";
import CreateProject from "./CreateProject";
import Progress from "./Progress";
import DeploymentDetail from "./DeploymentDetail";
import { setSessionInvalidatedHandler } from "./api";

// New pages for the updated sidebar
import Activity from "./Activity";
import Services from "./Services";
import Settings from "./Settings";

// Simple professional login landing (enforces login-first for Plan B per-user isolation)
function LoginLanding() {
    const handleGitHubLogin = () => {
        window.location.href = 'https://api.hgu.app/auth/github';
    };

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
            <div className="max-w-md w-full text-center">
                <div className="inline-flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center">
                        <span className="text-zinc-900 font-bold text-lg tracking-[-0.5px]">HGU</span>
                    </div>
                    <div className="text-left">
                        <div className="font-semibold text-3xl tracking-tighter">DevOps Hub</div>
                        <div className="text-xs text-zinc-500 -mt-1">Handong University</div>
                    </div>
                </div>

                <h1 className="text-4xl font-semibold tracking-tighter mb-3">
                    Deploy your projects.<br />Privately.
                </h1>
                <p className="text-zinc-400 mb-8">
                    Sign in with GitHub to manage your own Web, APK, Function, and Cron deployments.
                    Your data is isolated — only you can see and control what you deploy.
                </p>

                <button
                    onClick={handleGitHubLogin}
                    className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white text-black rounded-2xl font-semibold text-lg hover:bg-zinc-200 active:scale-[0.985] transition shadow-sm"
                >
                    <span>Sign in with GitHub</span>
                    <span className="text-xl">→</span>
                </button>

                <p className="mt-6 text-xs text-zinc-500">
                    We only request repo read access so we can clone your private repositories during builds.
                </p>
            </div>
        </div>
    );
}

function AppContent() {
    const [isAuthed, setIsAuthed] = useState(false);
    const [checking, setChecking] = useState(true);
    const [showSessionExpiredModal, setShowSessionExpiredModal] = useState(false);

    useEffect(() => {
        // Capture JWT from OAuth callback (backend redirects with ?token=xxx)
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get('token');

        if (urlToken) {
            localStorage.setItem('token', urlToken);
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        const token = localStorage.getItem('token');
        setIsAuthed(!!token);
        setChecking(false);

        // Register handler for when session is killed from another device
        setSessionInvalidatedHandler(() => {
            localStorage.removeItem('token');
            setIsAuthed(false);
            setShowSessionExpiredModal(true);
        });
    }, []);

    const handleLogout = async () => {
        const token = localStorage.getItem('token');

        // Call backend to invalidate ALL sessions for this user (cross-device logout)
        if (token) {
            try {
                await fetch('https://api.hgu.app/auth/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            } catch (e) {
                // Ignore network errors — we still want to log out locally
            }
        }

        localStorage.removeItem('token');
        setIsAuthed(false);

        // Redirect to GitHub logout page (clears GitHub browser session) then back to login
        window.location.href = 'https://api.hgu.app/auth/logout';
    };

    if (checking) {
        return <div className="min-h-screen bg-zinc-950" />;
    }

    if (!isAuthed) {
        return <LoginLanding />;
    }

    // Authenticated: show full app (Layout + routes)
    return (
        <BrowserRouter>
            <Layout onLogout={handleLogout}>
                <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/create" element={<CreateProject />} />
                    <Route path="/progress" element={<Progress />} />
                    <Route path="/detail" element={<DeploymentDetail />} />
                    {/* New routes */}
                    <Route path="/activity" element={<Activity />} />
                    <Route path="/services" element={<Services />} />
                    <Route path="/settings" element={<Settings />} />
                </Routes>
            </Layout>

            {/* Session Expired Modal (triggered when logged out from another device) */}
            {showSessionExpiredModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-3xl max-w-md w-full p-8 text-center">
                        <div className="text-5xl mb-4">🔒</div>
                        <h2 className="text-2xl font-semibold mb-3">Logged out from another device</h2>
                        <p className="text-zinc-400 mb-6">
                            You have been logged out because your session was ended from another device or browser.
                        </p>
                        <button
                            onClick={() => {
                                setShowSessionExpiredModal(false);
                                window.location.href = '/';
                            }}
                            className="w-full py-3 bg-white text-black rounded-2xl font-semibold hover:bg-zinc-200 transition"
                        >
                            Go to Login
                        </button>
                    </div>
                </div>
            )}
        </BrowserRouter>
    );
}

export default function App() {
    return <AppContent />;
}
