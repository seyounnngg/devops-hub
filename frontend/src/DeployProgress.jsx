import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

function DeployProgress() {
    const navigate = useNavigate();
    const [currentStep, setCurrentStep] = useState(0);

    const deploySteps = [
        "Cloning repository from GitHub",
        "Installing dependencies",
        "Building the project",
        "Creating Docker container",
        "Applying SSL / networking",
        "Deployment complete"
    ];

    useEffect(() => {
        if (currentStep < deploySteps.length - 1) {
            const timer = setTimeout(() => {
                setCurrentStep((prev) => prev + 1);
            }, 1600);
            return () => clearTimeout(timer);
        }
    }, [currentStep, deploySteps.length]);

    const projectName = localStorage.getItem("currentProject") || "your project";

    return (
        <div className="max-w-2xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <div className="uppercase tracking-[3px] text-[10px] font-semibold text-zinc-500 mb-1">
                    DEPLOYMENT PIPELINE
                </div>
                <h1 className="text-4xl font-semibold tracking-[-1.5px] mb-2">
                    Deploying {projectName}
                </h1>
                <p className="text-zinc-400">
                    Please keep this page open while we build and deploy your service.
                </p>
            </div>

            {/* Progress Card */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8">
                <div className="flex items-center justify-between mb-6">
                    <div className="text-sm font-medium text-zinc-400">Build Progress</div>
                    <div className="text-sm font-mono text-zinc-500">
                        {currentStep + 1} / {deploySteps.length}
                    </div>
                </div>

                {/* Step List */}
                <div className="space-y-3">
                    {deploySteps.map((stepText, index) => {
                        const isDone = index < currentStep;
                        const isActive = index === currentStep;
                        const isPending = index > currentStep;

                        return (
                            <div
                                key={index}
                                className={`flex items-center gap-4 px-5 py-3.5 rounded-2xl border transition-all ${
                                    isActive 
                                        ? 'border-white bg-zinc-950' 
                                        : isDone 
                                            ? 'border-emerald-900/50 bg-zinc-950/60' 
                                            : 'border-zinc-800 bg-zinc-950/40'
                                }`}
                            >
                                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                    isDone 
                                        ? 'bg-emerald-500 text-black' 
                                        : isActive 
                                            ? 'bg-white text-black' 
                                            : 'bg-zinc-800 text-zinc-500'
                                }`}>
                                    {isDone ? '✓' : index + 1}
                                </div>

                                <div className={`flex-1 text-base ${
                                    isDone ? 'text-emerald-400 line-through' : 
                                    isActive ? 'text-white font-medium' : 
                                    'text-zinc-500'
                                }`}>
                                    {stepText}
                                </div>

                                {isActive && (
                                    <div className="text-xs px-3 py-1 bg-white/10 text-white rounded-full tracking-wide">
                                        IN PROGRESS
                                    </div>
                                )}
                                {isDone && (
                                    <div className="text-xs px-3 py-1 bg-emerald-500/10 text-emerald-400 rounded-full">
                                        DONE
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Progress Bar */}
                <div className="mt-8">
                    <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                            className="h-1 bg-white transition-all duration-500"
                            style={{ width: `${((currentStep + 1) / deploySteps.length) * 100}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Completion Action */}
            {currentStep === deploySteps.length - 1 && (
                <div className="mt-8 flex justify-center">
                    <button
                        onClick={() => navigate('/detail')}
                        className="px-8 py-3 bg-white text-black font-semibold rounded-2xl hover:bg-zinc-100 active:bg-zinc-200 transition flex items-center gap-3 text-sm"
                    >
                        View Deployment Details & Logs
                        <span aria-hidden>→</span>
                    </button>
                </div>
            )}
        </div>
    );
}

export default DeployProgress;