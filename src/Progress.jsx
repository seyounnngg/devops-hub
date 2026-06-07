import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";

function Progress() {

    const navigate = useNavigate();

    const [logs, setLogs] = useState([]);
    const logContainerRef = useRef(null);
    const bottomRef = useRef(null);

    // Very reliable auto-scroll for live streaming logs
    useLayoutEffect(() => {
        const scrollToBottom = () => {
            if (bottomRef.current) {
                bottomRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
            }
            if (logContainerRef.current) {
                logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
            }
        };

        // Multiple attempts for reliability during rapid log streaming
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                scrollToBottom();
                setTimeout(scrollToBottom, 0);
            });
        });
    }, [logs.length]);

    // Extract only the logs belonging to the *current* deployment attempt.
    // We reset whenever we see the start of a new run.
    // This prevents the success banner from appearing based on *historical* persisted
    // logs for the same project_name (e.g. "demo-web", "studymate") that contain
    // old "Deployment process completed" strings.
    const currentRunLogs = [];
    let inCurrentRun = false;
    for (const log of logs) {
        if (typeof log === 'string') {
            if (log.includes('🚀 Deployment started') || log.includes('Deployment started (serviceType')) {
                inCurrentRun = true;
                currentRunLogs.length = 0;
            }
            if (inCurrentRun) {
                currentRunLogs.push(log);
            }
        }
    }

    // Failure on current run only
    const hasFailed = currentRunLogs.some(log => {
        if (typeof log !== 'string') return false;
        const lower = log.toLowerCase();
        return log.includes('❌') ||
               lower.includes('deployment failed') ||
               lower.includes('error during deployment') ||
               lower.includes('cron deployment failed') ||
               lower.includes('function deployment failed');
    });

    // Success if "Deployment process completed" has appeared anywhere in the current run.
    // We use .some() (not last-log only) because Function and Cron continue to append
    // runtime logs ([FUNCTION CALL]..., [Cron] executions...) *after* the initial deployment
    // finishes. Checking only the last log would make the success banner + URL + buttons
    // disappear every time a new runtime log arrives from the background streamer.
    // The currentRunLogs reset on "🚀 Deployment started" already protects against old persisted logs.
    const hasSucceeded = currentRunLogs.some(log =>
        typeof log === 'string' && log.includes("Deployment process completed")
    );

    useEffect(() => {

        const projectName =
            localStorage.getItem("currentProject");

        async function fetchLogs() {

            try {

                const token = localStorage.getItem('token');
                const response = await fetch(
                    `https://api.hgu.app/deployments/${projectName}/logs`,
                    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
                );
                if (response.status === 401) {
                    localStorage.removeItem('token');
                    window.location.reload();
                    return;
                }

                const data = await response.json();

                setLogs(data);

                // Explicit scroll trigger right after new logs arrive (helps when effect timing is delayed)
                requestAnimationFrame(() => {
                    if (bottomRef.current) {
                        bottomRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });
                    }
                    if (logContainerRef.current) {
                        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                    }
                });

            } catch (error) {

                console.error(error);
            }
        }

        fetchLogs();

        const interval = setInterval(fetchLogs, 1000);

        return () => clearInterval(interval);

    }, []);

    const projectName = localStorage.getItem("currentProject") || "your project";

    return (
        <div className="h-full flex flex-col max-w-4xl mx-auto">
            {/* Header - never shrinks */}
            <div className="flex-shrink-0 mb-6">
                <div className="uppercase tracking-[3px] text-[10px] font-semibold text-zinc-500 mb-1">
                    DEPLOYMENT IN PROGRESS
                </div>
                <h1 className="text-4xl font-semibold tracking-[-1.5px] mb-2">
                    {projectName}
                </h1>
                <p className="text-zinc-400">
                    Real-time build logs. APK builds usually take 1-5 minutes.
                </p>
            </div>

            {/* Scrollable right pane only - Sidebar stays fixed full height.
                Everything below header scrolls inside this container when needed. */}
            <div className="flex-1 min-h-0 overflow-auto">
                {/* Log Box - reasonable fixed size */}
                <div 
                    ref={logContainerRef}
                    className="bg-zinc-950 border border-zinc-800 rounded-3xl p-6 font-mono text-sm text-emerald-400 h-[380px] overflow-y-auto whitespace-pre-wrap flex-shrink-0"
                >
                {currentRunLogs.length === 0 ? (
                    <div className="text-zinc-500">Waiting for logs...</div>
                ) : (
                    currentRunLogs.map((log, index) => (
                        <div key={index} className="mb-1 leading-relaxed">
                            {log}
                        </div>
                    ))
                )}

                {/* Bottom anchor for auto-scroll - always inside the fixed box */}
                <div ref={bottomRef} />
            </div>

            {/* Action area (failure or success) - compact version */}
            {(hasFailed || hasSucceeded) && (
                <div className="flex-shrink-0 mt-4">
                    {hasFailed && (
                        <div className="w-full space-y-4">
                            {/* Failed Status */}
                            <div className="border border-red-900 bg-red-950/30 rounded-3xl p-4">
                                <div className="font-semibold text-red-400 mb-0.5">Deployment Failed</div>
                                <p className="text-red-300 text-sm">Check the logs above for details.</p>
                            </div>

                            {/* Buttons */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                    onClick={() => navigate("/dashboard")}
                                    className="flex-1 px-5 py-2.5 border border-zinc-700 hover:bg-zinc-800 text-zinc-200 rounded-2xl text-sm font-medium transition"
                                >
                                    Go to Dashboard
                                </button>
                                <button
                                    onClick={() => navigate("/detail")}
                                    className="flex-1 px-5 py-2.5 bg-white text-black font-semibold rounded-2xl text-sm hover:bg-zinc-100 active:bg-zinc-200 transition"
                                >
                                    View Deployment Details
                                </button>
                            </div>
                        </div>
                    )}

                    {!hasFailed && hasSucceeded && (
                        <div className="w-full space-y-4">
                            {/* Success Status */}
                            <div className="border border-emerald-900 bg-emerald-950/30 rounded-3xl p-4">
                                <div className="font-semibold text-emerald-400 mb-0.5">Deployment Successful</div>
                                <p className="text-emerald-300 text-sm">Your service is now running.</p>
                            </div>

                            {/* Secondary Info (URL or APK) */}
                            {(() => {
                                const isApk = currentRunLogs.some(log => log.includes("APK") || log.includes("apk"));

                                if (isApk) {
                                    // Try to find explicit /apks/ path in logs (preferred, from updated apkBuilder)
                                    let downloadPath = null;
                                    const apkLog = currentRunLogs.find(log => log.includes("/apks/"));
                                    if (apkLog) {
                                        const match = apkLog.match(/\/apks\/[\w-]+\.apk/);
                                        if (match) downloadPath = match[0];
                                    }

                                    // Fallback: parse the build directory from clone log (e.g. /tmp/apk-builds/demo-app-17808...)
                                    // and construct the expected APK path. This makes the button appear reliably.
                                    if (!downloadPath) {
                                        const buildDirLog = currentRunLogs.find(log => log.includes('/tmp/apk-builds/'));
                                        if (buildDirLog) {
                                            const dirMatch = buildDirLog.match(/\/tmp\/apk-builds\/([^\s\/]+)/);
                                            if (dirMatch) {
                                                downloadPath = `/apks/${dirMatch[1]}.apk`;
                                            }
                                        }
                                    }

                                    const downloadUrl = downloadPath ? `https://api.hgu.app${downloadPath}` : null;

                                    return (
                                        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
                                            <div className="text-sm text-zinc-400 mb-2">APK Ready</div>
                                            {downloadUrl ? (
                                                <a 
                                                    href={downloadUrl} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="inline-flex items-center justify-center px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-2xl transition"
                                                >
                                                    Download APK
                                                </a>
                                            ) : (
                                                <p className="text-zinc-400 text-sm">Check logs for the download link.</p>
                                            )}
                                        </div>
                                    );
                                } else {
                                    // Prefer the actual final URL logged by the deployer (after NPM proxy + SSL)
                                    // e.g. "✅ Function running at https://..." or "🌐 Final access URL: https://..."
                                    // Falls back to the projectName-based subdomain if no explicit URL in logs.
                                    let serviceUrl = null;
                                    for (let i = currentRunLogs.length - 1; i >= 0; i--) {
                                        const log = currentRunLogs[i];
                                        if (typeof log !== 'string') continue;
                                        const m = log.match(/Final access URL:\s*(https?:\/\/\S+)/i) ||
                                                  log.match(/running at\s*(https?:\/\/\S+)/i) ||
                                                  log.match(/accessible at:\s*(https?:\/\/\S+)/i);
                                        if (m) {
                                            serviceUrl = m[1];
                                            break;
                                        }
                                    }
                                    if (!serviceUrl) {
                                        serviceUrl = projectName ? `https://${projectName}.hgu.app` : null;
                                    }
                                    if (serviceUrl) {
                                        return (
                                            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
                                                <div className="text-xs text-zinc-500 mb-1">Service URL</div>
                                                <a 
                                                    href={serviceUrl} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    className="text-base font-semibold text-white hover:text-emerald-400 break-all"
                                                >
                                                    {serviceUrl}
                                                </a>
                                            </div>
                                        );
                                    }
                                }
                                return null;
                            })()}

                            {/* Buttons */}
                            <div className="flex flex-col sm:flex-row gap-3">
                                <button
                                    onClick={() => navigate("/dashboard")}
                                    className="flex-1 px-5 py-2.5 border border-zinc-700 hover:bg-zinc-800 text-zinc-200 rounded-2xl text-sm font-medium transition"
                                >
                                    Go to Dashboard
                                </button>
                                <button
                                    onClick={() => navigate("/detail")}
                                    className="flex-1 px-5 py-2.5 bg-white text-black font-semibold rounded-2xl text-sm hover:bg-zinc-100 active:bg-zinc-200 transition"
                                >
                                    View Deployment Details
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
            </div> {/* end scrollable right pane */}
        </div>
    );
}

export default Progress;
