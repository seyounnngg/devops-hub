import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";

function DeploymentDetail() {

    const navigate = useNavigate();
    const logContainerRef = useRef(null);

    const [logs, setLogs] = useState([]);
    const [deployment, setDeployment] = useState(null);
    const [isFailed, setIsFailed] = useState(false);

    const projectName = localStorage.getItem("currentProject");

    if (!projectName) {
        return (
            <div className="max-w-2xl mx-auto py-12 text-center">
                <div className="text-2xl font-semibold mb-3 tracking-tight">No project selected</div>
                <p className="text-zinc-400 mb-6">Please start a deployment from the New Deployment page.</p>
                <button 
                    onClick={() => navigate("/dashboard")}
                    className="px-6 py-3 bg-white text-black font-semibold rounded-2xl hover:bg-zinc-100 transition"
                >
                    Back to Dashboard
                </button>
            </div>
        );
    }

    useEffect(() => {
        if (!projectName) return;

        async function fetchData() {
            const token = localStorage.getItem('token');
            const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

            try {
                const logsRes = await fetch(`https://api.hgu.app/deployments/${projectName}/logs`, { headers: authHeaders });
                if (logsRes.status === 401) { localStorage.removeItem('token'); window.location.reload(); return; }
                const logsData = await logsRes.json();
                const newLogs = Array.isArray(logsData) ? logsData : [];
                setLogs(newLogs);

                // Detect failure from logs (more reliable, including early validation errors)
                const hasFailure = newLogs.some(l => {
                    if (typeof l !== 'string') return false;
                    const lower = l.toLowerCase();
                    return l.includes('❌') ||
                           lower.includes('failed') ||
                           lower.includes('error') ||
                           l.includes('no Flutter project files') ||
                           l.includes('Clone succeeded but') ||
                           l.includes('Check token scopes');
                });
                setIsFailed(hasFailure);

                const listRes = await fetch('https://api.hgu.app/deployments', { headers: authHeaders });
                if (listRes.status === 401) { localStorage.removeItem('token'); window.location.reload(); return; }
                const allDeps = await listRes.json();
                const current = allDeps.find(d => d.project_name === projectName);
                
                if (current) {
                    try {
                        const detailRes = await fetch(`https://api.hgu.app/deployments/${current.id}`, { headers: authHeaders });
                        if (detailRes.ok) {
                            const detailData = await detailRes.json();
                            setDeployment(detailData);
                        } else {
                            setDeployment(current);
                        }
                    } catch {
                        setDeployment(current);
                    }

                    // Also mark as failed if the backend reports failed status
                    if (current.status === 'failed') {
                        setIsFailed(true);
                    }
                }
            } catch (error) {
                console.error(error);
            }
        }

        fetchData();
        const interval = setInterval(fetchData, 3500);
        return () => clearInterval(interval);

    }, [projectName]);

    // Reliable auto-scroll using a bottom anchor (much more stable for live logs)
    const bottomRef = useRef(null);

    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
    }, [logs.length]);

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

    const serviceUrl = getDemoDisplayUrl(deployment);

    const isApk = deployment?.service_type === 'apk' || logs.some(l => typeof l === 'string' && l.includes('APK Build'));

    // Simple and reliable: if any "❌" appears in the logs, treat it as failed immediately.
    // Especially treat the new clear "[Final] Deployment Failed" line the same way success "✅ Deployment process completed" lines work.
    const hasErrorLog = logs.some(l => typeof l === 'string' && l.includes('❌'));
    const effectiveIsFailed = isFailed || hasErrorLog || deployment?.status === 'failed';

    const isBuilding = !deployment || deployment.status === 'pending' || deployment.status === 'building' || (!effectiveIsFailed && logs.length > 0 && !logs.some(l => l.includes('✅') && l.includes('completed')));



    return (
        <div className="max-w-5xl mx-auto py-8">



            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
                <div>
                    <div className="uppercase tracking-[3px] text-[10px] font-semibold text-zinc-500 mb-1">DEPLOYMENT</div>
                    <h1 className="text-4xl font-semibold tracking-[-1.5px]">{projectName}</h1>
                    {isApk && (
                        <p className="text-sm text-amber-400 mt-2">
                            APK Build — first build can take 5–10 minutes
                        </p>
                    )}
                </div>
                <button
                    onClick={() => navigate("/dashboard")}
                    className="px-5 py-2 text-sm font-medium border border-zinc-700 hover:bg-zinc-800 text-zinc-300 rounded-2xl transition self-start sm:self-auto"
                >
                    Back to Dashboard
                </button>
            </div>



            {/* Failure Notice (clean, not overwhelming) */}
            {effectiveIsFailed && (
                <div className="mb-6 border border-red-900 bg-red-950/30 rounded-3xl p-5">
                    <div className="flex items-center gap-3">
                        <div className="font-semibold text-red-400">Deployment Failed</div>
                        <div className="text-sm text-red-400/80">— Check the logs below for details</div>
                    </div>
                </div>
            )}

            {/* Service Info Card */}
            {deployment && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
                        <div>
                            <div className="font-semibold text-2xl tracking-tight mb-2">{deployment.project_name}</div>
                            
                            <div className="flex items-center gap-3">
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold tracking-wide ${
                                    deployment.status === 'completed' || deployment.status === 'running'
                                        ? 'bg-emerald-500/10 text-emerald-400' 
                                        : effectiveIsFailed 
                                            ? 'bg-red-500/10 text-red-400'
                                            : 'bg-amber-500/10 text-amber-400'
                                }`}>
                                    {deployment.status || (effectiveIsFailed ? 'failed' : 'in progress')}
                                </span>
                                <span className="text-xs px-3 py-1 bg-zinc-800 rounded-full text-zinc-400">
                                    {deployment.service_type === 'apk' ? 'APK' : 
                                     deployment.service_type === 'function' ? 'Function' : 
                                     deployment.service_type === 'cron' ? 'Cron' : 'Web'}
                                </span>
                            </div>
                        </div>

                        {deployment.apk_url ? (
                            <a 
                                href={`https://api.hgu.app${deployment.apk_url}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-2xl transition"
                            >
                                Download APK
                            </a>
                        ) : serviceUrl && !isBuilding && (
                            <div className="text-left md:text-right">
                                <div className="text-xs text-zinc-500 mb-1">Service URL</div>
                                <a 
                                    href={serviceUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-lg font-semibold text-white hover:text-blue-400 break-all"
                                >
                                    {serviceUrl}
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Logs Section */}
            <div className="flex items-center justify-between mb-3 px-1">
                <div className="font-semibold tracking-tight">Live Logs</div>
                <span className="text-xs text-zinc-500 font-mono">{logs.length} lines</span>
            </div>

            <div 
                ref={logContainerRef}
                className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6 font-mono text-sm text-emerald-400 h-[450px] overflow-y-auto whitespace-pre-wrap"
            >
                {logs.length === 0 ? (
                    <div className="text-zinc-500">Waiting for logs...</div>
                ) : (
                    <>
                        {logs.map((log, index) => (
                            <div key={index} className="mb-1 leading-relaxed">{log}</div>
                        ))}
                        <div ref={bottomRef} />
                    </>
                )}
            </div>

            {/* Action Buttons */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                    onClick={() => window.location.reload()}
                    className="px-5 py-2.5 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-2xl transition"
                >
                    Refresh Logs
                </button>

                <button
                    onClick={async () => {
                        if (!confirm('Delete this deployment record?')) return;
                        try {
                            const token = localStorage.getItem('token');
                            const depId = deployment?.id;
                            if (depId) {
                                await fetch(`https://api.hgu.app/deployments/${depId}`, {
                                    method: 'DELETE',
                                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                                });
                            }
                        } catch (e) {
                            console.error(e);
                        }
                        navigate('/dashboard');
                    }}
                    className="px-5 py-2.5 text-sm font-medium bg-red-600 hover:bg-red-500 text-white rounded-2xl transition ml-auto"
                >
                    Delete Record
                </button>
            </div>

            {effectiveIsFailed && (
                <div className="mt-4 text-sm text-red-600 dark:text-red-400">
                    This deployment failed. Check the logs above for details.
                </div>
            )}

            {isApk && isBuilding && !isFailed && (
                <div className="mt-4 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
                    APK builds are faster after the first run thanks to Docker image and dependency caching. 
                    This is normal and only happens once. The build will continue in the background.
                </div>
            )}
        </div>
    );
}

export default DeploymentDetail;
