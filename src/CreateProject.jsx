import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject, getRepositories } from './api';

function CreateProject() {
    const navigate = useNavigate();

    const [step, setStep] = useState(1);

    const [serviceType, setServiceType] = useState('web');

    const [projectName, setProjectName] = useState('');
    const [repository, setRepository] = useState('');
    const [branch, setBranch] = useState('main');

    // Extra fields for Function and Cron
    const [handlerCode, setHandlerCode] = useState('');
    const [cronScript, setCronScript] = useState('');
    const [cronSchedule, setCronSchedule] = useState('*/10 * * * * *');  // Default every 10 seconds for easy demo & testing

    // Mode selection: 'repo' (primary) or 'inline' (Quick Test secondary)
    const [codeSource, setCodeSource] = useState('repo'); // 'repo' | 'inline'

    // File path inside the repo (for repo mode)
    const [handlerFilePath, setHandlerFilePath] = useState('');
    const [cronFilePath, setCronFilePath] = useState('');

    const [repositories, setRepositories] = useState([]);
    const [repoLoadError, setRepoLoadError] = useState(null);

    // Error shown only after user clicks Next with invalid input
    const [nameError, setNameError] = useState('');

    // Use functional updates to avoid stale closure bugs
    const nextStep = () => setStep((prev) => prev + 1);
    const prevStep = () => setStep((prev) => prev - 1);

    // Handle Next with validation (show error only on submit attempt)
    const handleNext = () => {
        if (step === 1) {
            if (!projectName.trim()) {
                setNameError('Please enter a project name.');
                return;
            }
            setNameError(''); // clear error if valid
        }
        // Add similar validation for other steps if needed later
        nextStep();
    };

    // Validation: prevent going next if required fields for current step are missing
    const canGoNext = () => {
        if (step === 1) return projectName.trim().length > 0;
        if (step === 2) return repository !== '';
        return true;
    };

    const handleDeploy = () => {
        // 1. Save project name immediately so Progress page can start polling logs
        localStorage.setItem('currentProject', projectName);

        // 2. Navigate to Progress page immediately (user wants to see live logs right away)
        navigate('/progress');

        // 3. Fire the actual deployment request in the background
        createProject({
            name: projectName,
            repository,
            branch,
            serviceType,
            // Code source mode
            codeSource, // 'repo' or 'inline'

            // Inline mode data
            handlerCode: (serviceType === 'function' && codeSource === 'inline') ? handlerCode : undefined,
            cronScript: (serviceType === 'cron' && codeSource === 'inline') ? cronScript : undefined,
            cronSchedule: serviceType === 'cron' ? cronSchedule : undefined,

            // Repo mode - file paths
            handlerFilePath: (serviceType === 'function' && codeSource === 'repo') ? handlerFilePath : undefined,
            cronFilePath: (serviceType === 'cron' && codeSource === 'repo') ? cronFilePath : undefined,
        }).catch((err) => {
            console.error('Deployment request failed:', err);
            // For now we just log it. 
            // The Progress page will keep polling logs.
            // In the future we can show a toast or error state on Progress.
        });
    };

    useEffect(() => {
        async function loadRepositories() {
            try {
                const response = await getRepositories();

                if (Array.isArray(response)) {
                    setRepositories(response);
                    setRepoLoadError(null);
                } else if (response?.error) {
                    // Backend returned a structured error
                    console.error("Repository load error from server:", response);
                    setRepositories([]);
                    setRepoLoadError(response.details || response.error || 'Unknown error');
                } else {
                    setRepositories([]);
                    setRepoLoadError('Failed to load repository list.');
                }
            } catch (err) {
                console.error("Error loading repositories:", err);
                setRepositories([]);
                setRepoLoadError('Error occurred while calling GitHub API.');
            }
        }

        loadRepositories();
    }, []);

    return (
        <div className="max-w-2xl mx-auto">
            {/* Premium Step Header - matches new Dashboard style */}
            <div className="mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <div className="uppercase tracking-[3px] text-[10px] font-semibold text-zinc-500 mb-1">DEPLOYMENT WIZARD</div>
                        <h1 className="text-4xl font-semibold tracking-[-1.5px]">New Deployment</h1>
                    </div>
                    <div className="text-right">
                        <div className="text-sm font-medium text-white">Step {step} of 4</div>
                        <div className="text-[10px] text-zinc-500 tracking-wide">PROGRESS</div>
                    </div>
                </div>
                
                {/* Progress Bar - dark premium */}
                <div className="w-full bg-zinc-900 border border-zinc-800 rounded-full h-2 overflow-hidden">
                    <div 
                        className="bg-white h-2 rounded-full transition-all duration-300" 
                        style={{ width: `${(step / 4) * 100}%` }}
                    />
                </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-xl">

                {step === 1 && (
                    <div>
                        <h3 className="text-xl font-semibold tracking-tight mb-2">Project Name</h3>
                        <p className="text-sm text-zinc-400 mb-4">This name will be used for your deployment URL and container.</p>

                        <input
                            type="text"
                            placeholder="my-awesome-project"
                            value={projectName}
                            onChange={(e) => {
                                setProjectName(e.target.value);
                                if (nameError) setNameError('');
                            }}
                            className={`w-full px-5 py-3.5 rounded-2xl text-lg bg-zinc-950 border border-zinc-800 text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/60 transition ${
                                nameError 
                                    ? 'border-red-500 focus:border-red-500' 
                                    : 'border-zinc-800'
                            }`}
                        />
                        {nameError && (
                            <p className="text-red-400 text-sm mt-2 font-medium">
                                {nameError}
                            </p>
                        )}
                    </div>
                )}

                {step === 2 && (
                    <div>
                        <h3 className="text-xl font-semibold tracking-tight mb-6">Select GitHub Repository</h3>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-semibold tracking-[1px] text-zinc-400 mb-2 uppercase">
                                    Repository
                                </label>
                                <select
                                    value={repository}
                                    onChange={(e) => setRepository(e.target.value)}
                                    className="w-full px-5 py-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 text-white text-lg focus:outline-none focus:border-white/60"
                                >
                                    <option value="">Select a repository...</option>
                                    {Array.isArray(repositories) && repositories.map((repo) => (
                                        <option key={repo.id} value={repo.name}>
                                            {repo.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {repoLoadError && (
                                <div className="p-5 bg-red-950/30 border border-red-900 rounded-2xl">
                                    <p className="text-red-400 text-sm mb-4 font-medium">
                                        Failed to load repositories from GitHub.<br />
                                        {repoLoadError}
                                    </p>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => {
                                                localStorage.removeItem('token');
                                                window.location.href = 'https://api.hgu.app/auth/github?force=true';
                                            }}
                                            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-xl transition"
                                        >
                                            Reconnect GitHub
                                        </button>
                                        <button
                                            onClick={() => window.location.reload()}
                                            className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl transition"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-semibold tracking-[1px] text-zinc-400 mb-2 uppercase">
                                    Branch
                                </label>
                                <input
                                    type="text"
                                    value={branch}
                                    onChange={(e) => setBranch(e.target.value)}
                                    placeholder="main"
                                    className="w-full px-5 py-3.5 rounded-2xl bg-zinc-950 border border-zinc-800 text-white text-lg placeholder:text-zinc-500 focus:outline-none focus:border-white/60"
                                />
                            </div>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div>
                        <h3 className="text-xl font-semibold tracking-tight mb-6">What kind of project are you deploying?</h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {[
                                { type: 'web', label: 'Web Service', desc: 'React, Next.js, Express, etc.', accent: 'sky' },
                                { type: 'apk', label: 'APK Build', desc: 'Flutter, React Native, Android', accent: 'violet' },
                                { type: 'function', label: 'Serverless Function', desc: 'API endpoints or background jobs', accent: 'emerald' },
                                { type: 'cron', label: 'Cron Job', desc: 'Scheduled tasks and periodic jobs', accent: 'amber' },
                            ].map((item) => {
                                const isActive = serviceType === item.type;
                                return (
                                    <div
                                        key={item.type}
                                        onClick={() => setServiceType(item.type)}
                                        className={`group p-5 border-2 rounded-3xl cursor-pointer transition-all ${
                                            isActive 
                                                ? `border-${item.accent}-500 bg-zinc-950` 
                                                : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/60'
                                        }`}
                                    >
                                        <div className={`inline-block text-xs font-semibold tracking-widest mb-3 px-2.5 py-0.5 rounded-full ${
                                            isActive 
                                                ? `bg-${item.accent}-500/10 text-${item.accent}-400` 
                                                : 'bg-zinc-800 text-zinc-500 group-hover:bg-zinc-700'
                                        }`}>
                                            {item.label.toUpperCase()}
                                        </div>
                                        <div className="font-semibold text-lg tracking-tight text-white">{item.label}</div>
                                        <div className="text-sm text-zinc-400 mt-1.5 leading-snug">{item.desc}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {step === 4 && (
                    <div>
                        <h3 className="text-xl font-semibold tracking-tight mb-6">Final Review</h3>
                        
                        <div className="mb-6">
                            <div className="text-xs font-semibold tracking-[1px] text-zinc-400 mb-1.5 uppercase">Service Type</div>
                            <div className="text-3xl font-semibold capitalize tracking-tight">{serviceType}</div>
                        </div>

                        {/* Function / Cron - Code Source Selection */}
                        {(serviceType === 'function' || serviceType === 'cron') && (
                            <div className="mb-6">
                                <div className="mb-3">
                                    <div className="text-xs font-semibold tracking-[1px] text-zinc-400 mb-2 uppercase">
                                        Code Source
                                    </div>

                                    {/* Primary: From Repository */}
                                    <div
                                        onClick={() => setCodeSource('repo')}
                                        className={`p-4 border-2 rounded-2xl cursor-pointer mb-2 transition-all ${
                                            codeSource === 'repo'
                                                ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30'
                                                : 'border-zinc-300 dark:border-zinc-600 hover:border-zinc-400'
                                        }`}
                                    >
                                        <div className="font-semibold flex items-center gap-2">
                                            <span className="text-blue-600">★ Recommended</span>
                                            <span>Use code from my GitHub repository</span>
                                        </div>
                                        <div className="text-sm text-zinc-500 mt-1">
                                            The proper way. Your code lives in the repo you selected above.
                                        </div>

                                        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800">
                                            <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
                                                {serviceType === 'function' 
                                                    ? 'Add handler.js to the repository root.' 
                                                    : 'Add cron.js (or cron.sh) to the repository root.'}
                                            </p>

                                            {/* File path input (advanced) */}
                                            <div className="mt-2">
                                                <div className="text-xs text-blue-600 dark:text-blue-400 mb-1">Custom path (optional)</div>
                                                <input
                                                    type="text"
                                                    value={serviceType === 'function' ? handlerFilePath : cronFilePath}
                                                    onChange={(e) => {
                                                        if (serviceType === 'function') setHandlerFilePath(e.target.value);
                                                        else setCronFilePath(e.target.value);
                                                    }}
                                                    placeholder={serviceType === 'function' ? 'handler.js' : 'cron.js'}
                                                    className="w-full px-3 py-1.5 text-sm rounded-lg bg-white dark:bg-zinc-800 border border-blue-300 dark:border-blue-700 text-zinc-900 dark:text-white font-mono"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                </div>

                                {/* Schedule selector - shown for ALL Cron projects */}
                                {serviceType === 'cron' && (
                                    <div className="mt-5 p-4 bg-zinc-50 dark:bg-zinc-900/60 rounded-2xl border border-zinc-200 dark:border-zinc-700">
                                        <label className="block text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-2">
                                            Execution Schedule (Cron)
                                        </label>

                                        {/* Quick presets - common real-world schedules */}
                                        <div className="flex flex-wrap gap-2 mb-3">
                                            {[
                                                { label: 'Every minute', value: '* * * * *' },
                                                { label: 'Every 5 min', value: '*/5 * * * *' },
                                                { label: 'Every 10 min', value: '*/10 * * * *' },
                                                { label: 'Every 30 min', value: '*/30 * * * *' },
                                                { label: 'Every hour', value: '0 * * * *' },
                                                { label: 'Daily 00:00', value: '0 0 * * *' },
                                                { label: 'Weekdays 9am', value: '0 9 * * 1-5' },
                                            ].map(p => (
                                                <button
                                                    key={p.value}
                                                    type="button"
                                                    onClick={() => setCronSchedule(p.value)}
                                                    className={`px-3 py-1.5 text-sm rounded-xl border transition ${
                                                        cronSchedule === p.value
                                                            ? 'bg-blue-600 text-white border-blue-600'
                                                            : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 dark:hover:bg-zinc-700'
                                                    }`}
                                                >
                                                    {p.label}
                                                </button>
                                            ))}
                                        </div>

                                        <input
                                            type="text"
                                            value={cronSchedule}
                                            onChange={(e) => setCronSchedule(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-sm font-mono text-zinc-900 dark:text-white"
                                            placeholder="*/10 * * * * *"
                                        />
                                        <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1.5">
                                            Standard cron format (5 or 6 fields). Select a common schedule above or enter your own.
                                        </p>
                                    </div>
                                )}

                                {/* Quick Test option - for both Function and Cron */}
                                {(serviceType === 'function' || serviceType === 'cron') && (
                                    <div
                                        onClick={() => setCodeSource('inline')}
                                        className={`mt-3 p-4 border-2 rounded-2xl cursor-pointer transition-all ${
                                            codeSource === 'inline'
                                                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                                                : 'border-zinc-300 dark:border-zinc-600 hover:border-zinc-400'
                                        }`}
                                    >
                                        <div className="font-semibold text-amber-600 dark:text-amber-400">
                                            Quick Test — Paste code directly
                                        </div>
                                        <div className="text-sm text-zinc-500 mt-1">
                                            For quick testing only. Use the repository option for real projects.
                                        </div>
                                    </div>
                                )}

                                {/* Inline code input area (only visible in inline mode) */}
                                {codeSource === 'inline' && serviceType === 'function' && (
                                    <div className="mt-2">
                                        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">
                                            Handler Code (JavaScript)
                                        </label>
                                        <textarea
                                            value={handlerCode}
                                            onChange={(e) => setHandlerCode(e.target.value)}
                                            placeholder={`module.exports = async (req) => {\n  return { message: "Hello from quick test", time: new Date() };\n};`}
                                            className="w-full h-28 font-mono text-sm px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-white"
                                        />
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                            This is Quick Test mode. For real projects, use the repository option above.
                                        </p>
                                    </div>
                                )}

                                {codeSource === 'inline' && serviceType === 'cron' && (
                                    <div className="mt-2">
                                        <label className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-1">Script (Quick Test)</label>
                                        <textarea
                                            value={cronScript}
                                            onChange={(e) => setCronScript(e.target.value)}
                                            placeholder="console.log('Hello from quick test cron at', new Date());"
                                            className="w-full h-20 font-mono text-sm px-4 py-3 rounded-2xl bg-zinc-800 border border-zinc-700 text-white"
                                        />
                                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                            Quick Test mode. For real projects, put the script in your repository.
                                        </p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                <div className="flex justify-between items-center pt-8 mt-8 border-t border-zinc-800">
                    {step > 1 ? (
                        <button
                            onClick={prevStep}
                            className="px-6 py-2.5 text-sm font-medium border border-zinc-700 hover:bg-zinc-800 text-zinc-300 rounded-2xl transition"
                        >
                            Back
                        </button>
                    ) : (
                        <div />
                    )}

                    {step < 4 ? (
                        <button
                            onClick={handleNext}
                            disabled={!canGoNext()}
                            className={`px-7 py-2.5 text-sm font-semibold rounded-2xl transition flex items-center gap-2 ${
                                canGoNext() 
                                    ? 'bg-white text-black hover:bg-zinc-100 active:bg-zinc-200' 
                                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                            }`}
                        >
                            Continue
                        </button>
                    ) : (
                        <button
                            onClick={handleDeploy}
                            className="px-7 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-sm font-semibold rounded-2xl transition flex items-center gap-2"
                        >
                            Deploy Now
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default CreateProject;