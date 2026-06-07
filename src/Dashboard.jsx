import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

function Dashboard() {
    const navigate = useNavigate();
    const [deployments, setDeployments] = useState([]);
    const [activeFilter, setActiveFilter] = useState('all');

    async function loadDeployments() {
        try {
            const token = localStorage.getItem('token');
            const response = await fetch('https://api.hgu.app/deployments', {
                headers: token ? { Authorization: `Bearer ${token}` } : {}
            });
            if (response.status === 401) {
                localStorage.removeItem('token');
                window.location.reload();
                return;
            }
            const data = await response.json();
            setDeployments(data);
        } catch (error) {
            console.error(error);
        }
    }

    const getServiceLabel = (serviceType) => {
        const t = (serviceType || 'web').toLowerCase();
        if (t === 'apk') return 'APK';
        if (t === 'function') return 'Function';
        if (t === 'cron') return 'Cron';
        return 'Web';
    };

    const getServiceType = (serviceType) => (serviceType || 'web').toLowerCase();

    // Premium time formatter for "deployed X ago"
    function formatRelativeTime(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}d ago`;
    }

    // Service visual configuration for distinct yet cohesive cards
    const SERVICE_CONFIG = {
        web: { label: 'Web', color: 'sky', icon: '◆' },
        apk: { label: 'APK', color: 'violet', icon: '◆' },
        function: { label: 'Function', color: 'emerald', icon: '◆' },
        cron: { label: 'Cron', color: 'amber', icon: '◆' },
    };

    // Color the summary card dots according to what the metric represents
    function getSummaryDotColor(label) {
        const l = (label || '').toLowerCase();
        if (l.includes('failed')) return 'bg-red-400';
        if (l.includes('running') || l.includes('active')) return 'bg-emerald-400';
        if (l.includes('completed') || l.includes('successful')) return 'bg-emerald-400';
        if (l.includes('in progress')) return 'bg-amber-400';
        // Total / everything else → neutral
        return 'bg-zinc-400';
    }

    async function stopDeployment(id) {
        const token = localStorage.getItem('token');
        await fetch(`https://api.hgu.app/deployments/${id}/stop`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        loadDeployments();
    }

    async function deleteDeployment(id) {
        if (!confirm("Delete this deployment?")) return;
        const token = localStorage.getItem('token');
        await fetch(`https://api.hgu.app/deployments/${id}`, {
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        loadDeployments();
    }

    async function restartDeployment(id) {
        const token = localStorage.getItem('token');
        await fetch(`https://api.hgu.app/deployments/${id}/restart`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        loadDeployments();
    }

    const filterOptions = [
        { label: 'All', value: 'all' },
        { label: 'Web Services', value: 'web' },
        { label: 'APK Builds', value: 'apk' },
        { label: 'Functions', value: 'function' },
        { label: 'Cron Jobs', value: 'cron' },
    ];

    useEffect(() => {
        loadDeployments();
    }, []);

    const filteredDeployments = activeFilter === 'all' 
        ? deployments 
        : deployments.filter(d => d.service_type === activeFilter);

    const getSummaryCards = (filter, items) => {
        const total = items.length;
        const running = items.filter(d => d.status === 'running').length;
        const failed = items.filter(d => d.status === 'failed').length;
        const completed = items.filter(d => d.status === 'completed').length;

        if (filter === 'web') {
            return [
                { label: "Total Web Deployments", value: total },
                { label: "Running Services", value: running },
                { label: "Failed", value: failed },
                { label: "Completed", value: completed },
            ];
        }
        if (filter === 'cron') {
            return [
                { label: "Total Cron Jobs", value: total },
                { label: "Active Jobs", value: running },
                { label: "Failed", value: failed },
                { label: "Completed", value: completed },
            ];
        }
        if (filter === 'function') {
            return [
                { label: "Total Functions", value: total },
                { label: "Active", value: running },
                { label: "Failed", value: failed },
                { label: "Completed", value: completed },
            ];
        }
        if (filter === 'apk') {
            return [
                { label: "Total APK Builds", value: total },
                { label: "Successful", value: completed },
                { label: "Failed", value: failed },
                { label: "In Progress", value: running },
            ];
        }
        return [
            { label: "Total Deployments", value: total },
            { label: "Running", value: running },
            { label: "Failed", value: failed },
            { label: "Completed", value: completed },
        ];
    };

    const summaryCards = getSummaryCards(activeFilter, filteredDeployments);

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
                <div>
                    <div className="uppercase tracking-[3px] text-[10px] font-semibold text-zinc-500 mb-1">
                        DEVOPS HUB
                    </div>
                    <h1 className="text-4xl font-semibold tracking-[-1.5px] text-white">
                        {activeFilter === 'all' ? 'Dashboard' : filterOptions.find(f => f.value === activeFilter)?.label}
                    </h1>
                    <p className="text-zinc-400 mt-2 text-[15px]">
                        {activeFilter === 'all' 
                            ? 'All deployments across your projects' 
                            : `Your ${activeFilter} deployments`}
                    </p>
                </div>
                <button
                    onClick={() => navigate("/create")}
                    className="px-6 py-3 bg-white text-black rounded-2xl font-semibold text-sm hover:bg-zinc-100 active:bg-zinc-200 transition flex items-center gap-2 shadow-sm"
                >
                    <span>+</span> New Deployment
                </button>
            </div>

            {/* Filter Tabs - Professional segmented control (horizontal scroll on mobile) */}
            <div className="mb-8">
                <div className="overflow-x-auto scrollbar-hide -mx-1 px-1 lg:overflow-visible lg:mx-0 lg:px-0">
                    <div className="inline-flex bg-zinc-900/80 border border-zinc-800 rounded-2xl p-1 min-w-max lg:min-w-0">
                        {filterOptions.map(option => {
                        const isActive = activeFilter === option.value;
                        const count = option.value === 'all' 
                            ? deployments.length 
                            : deployments.filter(d => d.service_type === option.value).length;
                        return (
                            <button
                                key={option.value}
                                onClick={() => setActiveFilter(option.value)}
                                className={`px-5 py-2 text-sm font-medium rounded-[14px] transition-all flex items-center gap-2 ${
                                    isActive
                                        ? 'bg-white text-black shadow'
                                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                                }`}
                            >
                                {option.label}
                                <span className={`text-[10px] px-1.5 py-px rounded font-mono ${isActive ? 'bg-black/10 text-black/60' : 'bg-zinc-800 text-zinc-500'}`}>
                                    {count}
                                </span>
                            </button>
                        );
                    })}
                    </div>
                </div>
            </div>

            {/* Summary Cards - Elevated, filter-aware design */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
                {summaryCards.map((card, index) => {
                    const dotColor = getSummaryDotColor(card.label);

                    return (
                        <div 
                            key={index} 
                            className="group bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-3xl p-6 transition-all hover:-translate-y-px"
                        >
                            <div className="flex items-center gap-2 mb-3">
                                <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
                                <div className="text-[10px] font-semibold tracking-[1.5px] text-zinc-500 uppercase">
                                    {card.label}
                                </div>
                            </div>
                            <div className="text-5xl font-semibold tracking-[-2px] text-white tabular-nums">
                                {card.value}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Deployments Grid - Completely redesigned card anatomy */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {filteredDeployments.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center py-16 text-center border border-zinc-800 rounded-3xl bg-zinc-900/40">
                        <div className="w-10 h-10 rounded-2xl bg-zinc-800 flex items-center justify-center mb-5">
                            <span className="text-zinc-400 text-xl">∅</span>
                        </div>
                        <h3 className="text-xl font-semibold tracking-tight mb-2">
                            {activeFilter === 'all' ? 'No deployments yet' : `No ${activeFilter} deployments`}
                        </h3>
                        <p className="text-zinc-400 max-w-sm text-[15px]">
                            {activeFilter === 'all' 
                                ? "Click the '+ New Deployment' button in the header to get started." 
                                : "Switch filters or use the '+ New Deployment' button above."}
                        </p>
                    </div>
                ) : (
                    filteredDeployments.map((deployment) => {
                        const t = getServiceType(deployment.service_type);
                        const config = SERVICE_CONFIG[t] || SERVICE_CONFIG.web;

                        // Always show using project name as subdomain (demo visual cleanliness)
                        const getDemoDisplayUrl = (dep) => {
                            if (!dep) return null;

                            const name = (dep.project_name || 'project')
                                .toLowerCase()
                                .replace(/[^a-z0-9]/g, '-')
                                .replace(/-+/g, '-')
                                .replace(/^-|-$/g, '');

                            return `https://${name}.hgu.app`;
                        };

                        let primaryInfo = '';
                        const demoUrl = getDemoDisplayUrl(deployment);
                        if (t === 'web') primaryInfo = demoUrl;
                        else if (t === 'function') primaryInfo = demoUrl;
                        else if (t === 'cron') primaryInfo = demoUrl;
                        else if (t === 'apk') primaryInfo = deployment.apk_url ? 'APK ready for download' : 'Build in progress';

                        const isFailed = deployment.status === 'failed';
                        const isRunning = deployment.status === 'running' || deployment.status === 'completed';
                        const statusColor = isFailed ? 'red' : isRunning ? 'emerald' : 'amber';

                        return (
                            <div
                                key={deployment.id}
                                onClick={() => {
                                    localStorage.setItem('currentProject', deployment.project_name);
                                    navigate('/detail');
                                }}
                                className="group bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-3xl overflow-hidden cursor-pointer transition-all flex flex-col hover:shadow-xl hover:shadow-black/20"
                            >
                                {/* Card Header */}
                                <div className="px-6 pt-6 pb-4">
                                    <div className="flex items-center justify-between">
                                        {/* Service Type Pill - static Tailwind classes */}
                                        {t === 'web' && (
                                            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-sky-500/10 text-sky-400 tracking-wide">
                                                <span className="opacity-75">{config.icon}</span>
                                                {config.label}
                                            </div>
                                        )}
                                        {t === 'apk' && (
                                            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-violet-500/10 text-violet-400 tracking-wide">
                                                <span className="opacity-75">{config.icon}</span>
                                                {config.label}
                                            </div>
                                        )}
                                        {t === 'function' && (
                                            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 tracking-wide">
                                                <span className="opacity-75">{config.icon}</span>
                                                {config.label}
                                            </div>
                                        )}
                                        {t === 'cron' && (
                                            <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 tracking-wide">
                                                <span className="opacity-75">{config.icon}</span>
                                                {config.label}
                                            </div>
                                        )}

                                        {/* Status Badge - static classes */}
                                        {isFailed && (
                                            <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full bg-red-500/10 text-red-400">
                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                                {deployment.status}
                                            </div>
                                        )}
                                        {isRunning && (
                                            <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400">
                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                {deployment.status}
                                            </div>
                                        )}
                                        {!isFailed && !isRunning && (
                                            <div className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full bg-amber-500/10 text-amber-400">
                                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                                {deployment.status}
                                            </div>
                                        )}
                                    </div>

                                    {/* Title Block */}
                                    <div className="mt-5">
                                        <div className="font-semibold text-[21px] leading-none tracking-[-0.8px] text-white group-hover:text-white transition">
                                            {deployment.project_name}
                                        </div>
                                        <div className="mt-2 text-sm text-zinc-500 font-mono tracking-tight">
                                            {deployment.repository_name || '—'}
                                        </div>
                                    </div>

                                    {/* Primary Info Row */}
                                    {primaryInfo && (
                                        <div className="mt-4 text-[13px] text-zinc-400 truncate pr-2">
                                            {primaryInfo}
                                        </div>
                                    )}

                                    {/* Timestamp */}
                                    {deployment.created_at && (
                                        <div className="mt-3 text-[11px] text-zinc-500 font-medium">
                                            Deployed {formatRelativeTime(deployment.created_at)}
                                        </div>
                                    )}
                                </div>

                                {/* Actions Footer - Distinct visual section */}
                                <div className="mt-auto border-t border-zinc-800 bg-zinc-950/70 px-4 py-3.5 flex flex-wrap gap-2">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            localStorage.setItem('currentProject', deployment.project_name);
                                            navigate('/detail');
                                        }}
                                        className="flex-1 min-w-[92px] py-2 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition"
                                    >
                                        View Logs
                                    </button>

                                    {/* APK Download */}
                                    {t === 'apk' && deployment.apk_url && (
                                        <a
                                            href={`https://api.hgu.app${deployment.apk_url}`}
                                            target="_blank"
                                            onClick={(e) => e.stopPropagation()}
                                            className="flex-1 min-w-[92px] py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white text-center rounded-xl transition"
                                        >
                                            Download APK
                                        </a>
                                    )}

                                    {/* Web-specific controls */}
                                    {t === 'web' && deployment.status !== 'failed' && (
                                        deployment.status === 'running' ? (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); stopDeployment(deployment.id); }}
                                                className="flex-1 min-w-[92px] py-2 text-sm font-medium bg-yellow-500/10 hover:bg-yellow-500/15 text-yellow-400 rounded-xl transition"
                                            >
                                                Stop
                                            </button>
                                        ) : (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); restartDeployment(deployment.id); }}
                                                className="flex-1 min-w-[92px] py-2 text-sm font-medium bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-400 rounded-xl transition"
                                            >
                                                Restart
                                            </button>
                                        )
                                    )}

                                    {/* Failed state Retry */}
                                    {isFailed && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                localStorage.setItem('currentProject', deployment.project_name);
                                                navigate('/create');
                                            }}
                                            className="flex-1 min-w-[92px] py-2 text-sm font-medium bg-amber-500/10 hover:bg-amber-500/15 text-amber-400 rounded-xl transition"
                                        >
                                            Retry
                                        </button>
                                    )}

                                    {/* Delete - always available, subtle destructive */}
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (confirm(`Delete ${deployment.project_name}?`)) {
                                                deleteDeployment(deployment.id);
                                            }
                                        }}
                                        className="px-4 py-2 text-sm font-medium bg-red-500/10 hover:bg-red-500/15 text-red-400 rounded-xl transition"
                                        aria-label="Delete deployment"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export default Dashboard;
