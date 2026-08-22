import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getLogs } from "./api";

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
    // We take everything after the *last* "🚀 Deployment started" marker.
    // This is more robust than incremental reset when multiple deploys happen quickly
    // for the same project name (e.g. "demo-web" clicked several times).
    const startedMarkers = logs
        .map((log, idx) =>
            typeof log === 'string' &&
            (log.includes('🚀 Deployment started') || log.includes('Deployment started (serviceType'))
                ? idx
                : -1
        )
        .filter(idx => idx !== -1);

    const lastStartIdx = startedMarkers.length > 0 ? startedMarkers[startedMarkers.length - 1] : -1;

    const currentRunLogs = lastStartIdx >= 0
        ? logs.slice(lastStartIdx).filter(log => typeof log === 'string')
        : [];

    const hasFailed = currentRunLogs.some(log => {
        if (typeof log !== 'string') return false;
        const lower = log.toLowerCase();
        return log.includes('❌') ||
               lower.includes('deployment failed') ||
               lower.includes('error during deployment');
    });

    const hasSucceeded = currentRunLogs.some(log =>
        typeof log === 'string' && log.includes("Deployment process completed")
    );

    useEffect(() => {
        const projectName = localStorage.getItem("currentProject");
        let stopped = false;

        async function fetchLogs() {
            try {
                const data = await getLogs(projectName);
                if (stopped) return;
                setLogs(data);

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
        return () => { stopped = true; clearInterval(interval); };
    }, []);

    const projectName = localStorage.getItem("currentProject") || "your project";
    const isApk = currentRunLogs.some(log => log.includes("APK") || log.includes("apk"));

    // The most reliable service URL comes from the deployer's own final log line.
    let serviceUrl = null;
    if (!isApk) {
        for (let i = currentRunLogs.length - 1; i >= 0; i--) {
            const log = currentRunLogs[i];
            if (typeof log !== 'string') continue;
            const m = log.match(/Final access URL:\s*(https?:\/\/\S+)/i) ||
                      log.match(/accessible at:\s*(https?:\/\/\S+)/i);
            if (m) {
                serviceUrl = m[1];
                break;
            }
        }
        if (!serviceUrl) {
            serviceUrl = projectName ? `https://${projectName}.hgu.app` : null;
        }
    }

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
                    Real-time build logs. Builds usually take a few minutes.
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
                            {isApk ? (
                                <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-4">
                                    <div className="text-sm text-zinc-400 mb-2">APK Ready</div>
                                    <p className="text-zinc-400 text-sm">Open "View Deployment Details" below to download it.</p>
                                </div>
                            ) : serviceUrl && (
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
                            )}

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
