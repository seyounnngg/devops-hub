import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject, getRepositories, githubLoginUrl } from './api';

function CreateProject() {
    const navigate = useNavigate();

    const [step, setStep] = useState(1);

    const [serviceType, setServiceType] = useState('web');

    const [projectName, setProjectName] = useState('');
    const [repository, setRepository] = useState('');
    const [branch, setBranch] = useState('main');

    const [repositories, setRepositories] = useState([]);
    const [repoLoadError, setRepoLoadError] = useState(null);

    // Error shown only after user clicks Next with invalid input
    const [nameError, setNameError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

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
        nextStep();
    };

    // Validation: prevent going next if required fields for current step are missing
    const canGoNext = () => {
        if (step === 1) return projectName.trim().length > 0;
        if (step === 2) return repository !== '';
        return true;
    };

    const handleDeploy = () => {
        if (isSubmitting) return;
        setIsSubmitting(true);

        // 1. Save project name immediately so Progress page can start polling logs
        localStorage.setItem('currentProject', projectName);

        // 2. Navigate to Progress page immediately (user wants to see live logs right away)
        navigate('/progress');

        // 3. Fire the actual deployment request in the background (only once)
        createProject({
            name: projectName,
            repository,
            branch,
            serviceType,
        }).catch((err) => {
            console.error('Deployment request failed:', err);
            // The Progress page keeps polling logs and will show the failure there.
        }).finally(() => {
            setIsSubmitting(false);
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
                        <div className="text-sm font-medium text-white">Step {step} of 3</div>
                        <div className="text-[10px] text-zinc-500 tracking-wide">PROGRESS</div>
                    </div>
                </div>

                {/* Progress Bar - dark premium */}
                <div className="w-full bg-zinc-900 border border-zinc-800 rounded-full h-2 overflow-hidden">
                    <div
                        className="bg-white h-2 rounded-full transition-all duration-300"
                        style={{ width: `${(step / 3) * 100}%` }}
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
                                            onClick={() => { window.location.href = githubLoginUrl(true); }}
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
                        <h3 className="text-xl font-semibold tracking-tight mb-2">What kind of project are you deploying?</h3>
                        <p className="text-sm text-zinc-400 mb-6">Review your selection, then deploy.</p>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                            {[
                                { type: 'web', label: 'Web Service', desc: 'React, Next.js, Node, Python, Java, Go — or bring your own Dockerfile', accent: 'sky' },
                                { type: 'apk', label: 'APK Build', desc: 'Flutter or basic Android (Gradle)', accent: 'violet' },
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

                        <div className="text-xs font-semibold tracking-[1px] text-zinc-400 mb-1.5 uppercase">Summary</div>
                        <div className="text-sm text-zinc-300 space-y-1">
                            <div><span className="text-zinc-500">Project:</span> {projectName}</div>
                            <div><span className="text-zinc-500">Repository:</span> {repository || '—'}</div>
                            <div><span className="text-zinc-500">Branch:</span> {branch}</div>
                        </div>
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

                    {step < 3 ? (
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
                            disabled={isSubmitting}
                            className={`px-7 py-2.5 text-sm font-semibold rounded-2xl transition flex items-center gap-2 ${
                                isSubmitting
                                    ? 'bg-emerald-800 text-white/60 cursor-not-allowed'
                                    : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white'
                            }`}
                        >
                            {isSubmitting ? 'Deploying...' : 'Deploy Now'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

export default CreateProject;
