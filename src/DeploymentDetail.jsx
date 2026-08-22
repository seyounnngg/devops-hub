import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getLogs, getDeployments, getDeployment, deleteDeployment, apkDownloadUrl, aabDownloadUrl, updateEnvVars, addCustomDomain, removeCustomDomain, redeployProject, rollbackToBuild, getBuildHistory } from "./api";

function DeploymentDetail() {

    const navigate = useNavigate();
    const logContainerRef = useRef(null);
    const bottomRef = useRef(null);

    const [logs, setLogs] = useState([]);
    const [deployment, setDeployment] = useState(null);

    const [envVarRows, setEnvVarRows] = useState([]);
    const [envVarsLoadedFor, setEnvVarsLoadedFor] = useState(null);
    const [savingEnvVars, setSavingEnvVars] = useState(false);
    const [envSaveMessage, setEnvSaveMessage] = useState('');

    const [domainInput, setDomainInput] = useState('');
    const [domainBusy, setDomainBusy] = useState(false);
    const [domainMessage, setDomainMessage] = useState('');

    const [builds, setBuilds] = useState([]);
    const [redeploying, setRedeploying] = useState(false);
    const [redeployMessage, setRedeployMessage] = useState('');
    // Bumping this restarts the polling loop below — needed because that loop
    // stops once the deployment reaches 'running' (nothing left to watch), but
    // a fresh redeploy needs live progress again even though the *old*
    // container is still reporting 'running' right up until the swap happens.
    const [redeployNonce, setRedeployNonce] = useState(0);

    const projectName = localStorage.getItem("currentProject");

    useEffect(() => {
        if (!projectName) return;

        const TERMINAL_STATUSES = ['running', 'completed', 'failed', 'stopped'];
        let interval = null;

        async function fetchData() {
            try {
                const newLogs = await getLogs(projectName);
                setLogs(Array.isArray(newLogs) ? newLogs : []);

                const allDeps = await getDeployments();
                const current = allDeps.find(d => d.project_name === projectName);

                if (current) {
                    let detailData = current;
                    try {
                        detailData = await getDeployment(current.id);
                    } catch {
                        // fall back to the list entry
                    }
                    setDeployment(detailData);

                    // Once the deployment reaches a terminal state there's nothing new to
                    // poll for (an APK's status won't flip back to "building").
                    if (TERMINAL_STATUSES.includes(detailData.status) && interval) {
                        clearInterval(interval);
                        interval = null;
                    }
                }
            } catch (error) {
                console.error(error);
            }
        }

        fetchData();
        interval = setInterval(fetchData, 3500);
        return () => { if (interval) clearInterval(interval); };

    }, [projectName, redeployNonce]);

    // Reliable auto-scroll using a bottom anchor (much more stable for live logs)
    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
        }
    }, [logs.length]);

    // Refresh build history whenever the deployment status changes (covers both the
    // initial load and each time a redeploy/rollback finishes).
    useEffect(() => {
        if (!deployment?.id || deployment.service_type !== 'web') return;
        getBuildHistory(deployment.id).then(setBuilds).catch(() => {});
    }, [deployment?.id, deployment?.status, deployment?.service_type]);

    async function handleRedeploy() {
        if (!deployment?.id || redeploying) return;
        if (!confirm(`Redeploy ${deployment.project_name} from the latest commit on ${deployment.branch || 'its branch'}?`)) return;
        setRedeploying(true);
        setRedeployMessage('');
        setLogs([]);
        setRedeployNonce(n => n + 1);
        try {
            await redeployProject(deployment.id);
        } catch (e) {
            setRedeployMessage(e.message || 'Redeploy failed to start.');
        } finally {
            setRedeploying(false);
        }
    }

    async function handleRollback(build) {
        if (!deployment?.id || redeploying) return;
        if (!confirm(`Roll back ${deployment.project_name} to commit ${build.commit_hash}? This rebuilds and swaps in that version.`)) return;
        setRedeploying(true);
        setRedeployMessage('');
        setLogs([]);
        setRedeployNonce(n => n + 1);
        try {
            await rollbackToBuild(deployment.id, build.id);
        } catch (e) {
            setRedeployMessage(e.message || 'Rollback failed to start.');
        } finally {
            setRedeploying(false);
        }
    }

    // Load saved env vars into the editable rows once per deployment id — not on every
    // poll tick, so it doesn't overwrite whatever the user is currently typing.
    useEffect(() => {
        if (!deployment || deployment.id === envVarsLoadedFor) return;
        let parsed;
        try {
            parsed = deployment.env_vars ? JSON.parse(deployment.env_vars) : {};
        } catch {
            parsed = {};
        }
        setEnvVarRows(Object.entries(parsed).map(([key, value]) => ({ key, value })));
        setEnvVarsLoadedFor(deployment.id);
    }, [deployment, envVarsLoadedFor]);

    async function handleSaveEnvVars() {
        if (!deployment?.id) return;
        setSavingEnvVars(true);
        setEnvSaveMessage('');
        try {
            const envVars = envVarRows.reduce((acc, row) => {
                if (row.key.trim()) acc[row.key.trim()] = row.value;
                return acc;
            }, {});
            await updateEnvVars(deployment.id, Object.keys(envVars).length > 0 ? envVars : null);
            setEnvSaveMessage('Saved. Redeploy this project to apply the new values.');
        } catch {
            setEnvSaveMessage('Failed to save.');
        } finally {
            setSavingEnvVars(false);
        }
    }

    async function handleConnectDomain() {
        if (!deployment?.id || !domainInput.trim()) return;
        setDomainBusy(true);
        setDomainMessage('');
        try {
            const result = await addCustomDomain(deployment.id, domainInput.trim());
            setDeployment(d => ({ ...d, custom_domain: domainInput.trim() }));
            setDomainInput('');
            setDomainMessage(result.url?.startsWith('https') ? 'Connected with SSL.' : 'Connected over HTTP (SSL not attached — check DNS and try again).');
        } catch (e) {
            setDomainMessage(e.message || 'Failed to connect domain. Make sure its DNS points to this server.');
        } finally {
            setDomainBusy(false);
        }
    }

    async function handleRemoveDomain() {
        if (!deployment?.id) return;
        setDomainBusy(true);
        setDomainMessage('');
        try {
            await removeCustomDomain(deployment.id);
            setDeployment(d => ({ ...d, custom_domain: null }));
        } catch (e) {
            setDomainMessage(e.message || 'Failed to remove domain.');
        } finally {
            setDomainBusy(false);
        }
    }

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

    const isApk = deployment?.service_type === 'apk';

    // The DB record's status is the source of truth once it exists. Scanning log
    // text for "❌"/"error" is only a fallback for the brief window before the
    // deployment row has been created (e.g. an early validation failure).
    const effectiveIsFailed = deployment
        ? deployment.status === 'failed'
        : logs.some(l => typeof l === 'string' && l.includes('❌'));

    const isBuilding = !deployment || deployment.status === 'pending' || deployment.status === 'building';

    return (
        <div className="max-w-5xl mx-auto py-8">



            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
                <div>
                    <div className="uppercase tracking-[3px] text-[10px] font-semibold text-zinc-500 mb-1">DEPLOYMENT</div>
                    <h1 className="text-4xl font-semibold tracking-[-1.5px]">{projectName}</h1>
                    {isApk && (
                        <p className="text-sm text-amber-400 mt-2">
                            APK Build — first build can take 1-5 minutes
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
                                    {deployment.service_type === 'apk' ? 'APK' : 'Web'}
                                </span>
                                {deployment.service_type === 'web' && deployment.branch && (
                                    <button
                                        onClick={handleRedeploy}
                                        disabled={redeploying}
                                        className="text-xs px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-full transition disabled:opacity-60"
                                    >
                                        {redeploying ? 'Redeploying...' : '↻ Redeploy'}
                                    </button>
                                )}
                            </div>
                            {redeployMessage && <p className="text-xs text-red-400 mt-2">{redeployMessage}</p>}
                        </div>

                        {deployment.apk_url ? (
                            <div className="flex flex-wrap gap-2">
                                <a
                                    href={apkDownloadUrl(deployment.id)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-2xl transition"
                                >
                                    Download APK
                                </a>
                                {deployment.aab_url && (
                                    <a
                                        href={aabDownloadUrl(deployment.id)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center justify-center px-6 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-2xl transition"
                                        title="Android App Bundle — for Play Store upload"
                                    >
                                        Download AAB
                                    </a>
                                )}
                            </div>
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

            {/* Environment Variables (Web only) */}
            {deployment && deployment.service_type !== 'apk' && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-6">
                    <div className="flex items-center justify-between mb-1">
                        <div className="font-semibold tracking-tight">Environment Variables</div>
                        <button
                            type="button"
                            onClick={() => setEnvVarRows(rows => [...rows, { key: '', value: '' }])}
                            className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition"
                        >
                            + Add variable
                        </button>
                    </div>
                    <p className="text-xs text-zinc-500 mb-4">Changes apply on the next redeploy of this project, not to the currently running container.</p>

                    {envVarRows.length === 0 ? (
                        <p className="text-xs text-zinc-500">None set.</p>
                    ) : (
                        <div className="space-y-2 mb-4">
                            {envVarRows.map((row, i) => (
                                <div key={i} className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="KEY"
                                        value={row.key}
                                        onChange={(e) => setEnvVarRows(rows => rows.map((r, ri) => ri === i ? { ...r, key: e.target.value } : r))}
                                        className="w-2/5 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-white/60"
                                    />
                                    <input
                                        type="text"
                                        placeholder="value"
                                        value={row.value}
                                        onChange={(e) => setEnvVarRows(rows => rows.map((r, ri) => ri === i ? { ...r, value: e.target.value } : r))}
                                        className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-white/60"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setEnvVarRows(rows => rows.filter((_, ri) => ri !== i))}
                                        className="px-3 text-zinc-500 hover:text-red-400 transition"
                                        aria-label="Remove variable"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSaveEnvVars}
                            disabled={savingEnvVars}
                            className="px-5 py-2 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition disabled:opacity-60"
                        >
                            {savingEnvVars ? 'Saving...' : 'Save'}
                        </button>
                        {envSaveMessage && <span className="text-xs text-zinc-400">{envSaveMessage}</span>}
                    </div>
                </div>
            )}

            {/* Custom Domain (Web only) */}
            {deployment && deployment.service_type !== 'apk' && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-6">
                    <div className="font-semibold tracking-tight mb-1">Custom Domain</div>

                    {deployment.custom_domain ? (
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <a
                                href={`https://${deployment.custom_domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm font-mono text-white hover:text-blue-400 break-all"
                            >
                                {deployment.custom_domain}
                            </a>
                            <button
                                onClick={handleRemoveDomain}
                                disabled={domainBusy}
                                className="px-4 py-1.5 text-sm font-medium bg-red-500/10 hover:bg-red-500/15 text-red-400 rounded-xl transition disabled:opacity-60"
                            >
                                Remove
                            </button>
                        </div>
                    ) : (
                        <>
                            <p className="text-xs text-zinc-500 mb-4">
                                Point a DNS A record for your domain to this server's IP first, then connect it here.
                            </p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="myapp.com"
                                    value={domainInput}
                                    onChange={(e) => setDomainInput(e.target.value)}
                                    className="flex-1 px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-white/60"
                                />
                                <button
                                    onClick={handleConnectDomain}
                                    disabled={domainBusy || !domainInput.trim()}
                                    className="px-5 py-2 text-sm font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition disabled:opacity-60"
                                >
                                    {domainBusy ? 'Connecting...' : 'Connect'}
                                </button>
                            </div>
                        </>
                    )}
                    {domainMessage && <p className="text-xs text-zinc-400 mt-3">{domainMessage}</p>}
                </div>
            )}

            {/* Deployment History (Web only) */}
            {deployment && deployment.service_type === 'web' && builds.length > 0 && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 mb-6">
                    <div className="font-semibold tracking-tight mb-1">Deployment History</div>
                    <p className="text-xs text-zinc-500 mb-4">Roll back to any previous successful build.</p>

                    <div className="divide-y divide-zinc-800">
                        {builds.map((build, i) => {
                            const isCurrent = i === 0 && build.status === 'success';
                            return (
                                <div key={build.id} className="py-3 flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-sm text-white">{build.commit_hash || '—'}</span>
                                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                                build.status === 'success' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                            }`}>
                                                {build.status}
                                            </span>
                                            {build.triggered_by !== 'manual' && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">{build.triggered_by}</span>
                                            )}
                                            {isCurrent && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">current</span>}
                                        </div>
                                        <div className="text-xs text-zinc-500 mt-0.5">{new Date(build.created_at).toLocaleString()}</div>
                                    </div>
                                    {!isCurrent && build.status === 'success' && (
                                        <button
                                            onClick={() => handleRollback(build)}
                                            disabled={redeploying}
                                            className="shrink-0 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg transition disabled:opacity-60"
                                        >
                                            Rollback to this
                                        </button>
                                    )}
                                </div>
                            );
                        })}
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
                            if (deployment?.id) {
                                await deleteDeployment(deployment.id);
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

            {isApk && isBuilding && !effectiveIsFailed && (
                <div className="mt-4 text-xs text-zinc-500 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4">
                    APK builds are faster after the first run thanks to Docker image and dependency caching.
                    This is normal and only happens once. The build will continue in the background.
                </div>
            )}
        </div>
    );
}

export default DeploymentDetail;
