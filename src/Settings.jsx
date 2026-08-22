import { githubLoginUrl, githubLogoutUrl, logout, deleteAllMyData } from './api';

export default function Settings() {
  const handleReconnect = () => {
    window.location.href = githubLoginUrl(true);
  };

  const handleLogoutAll = async () => {
    if (!confirm('Log out from all devices?')) return;
    await logout();
    window.location.href = githubLogoutUrl();
  };

  const handleDeleteAllData = async () => {
    if (!confirm('This will permanently delete ALL your deployment records and stop any running services. Are you sure?')) return;
    if (!confirm('This action cannot be undone. Really delete everything?')) return;

    try {
      await deleteAllMyData();
      window.location.href = githubLogoutUrl();
    } catch {
      alert('Failed to delete data. Please try again.');
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <div className="uppercase tracking-[3px] text-[10px] font-semibold text-zinc-500 mb-1">ACCOUNT</div>
        <h1 className="text-4xl font-semibold tracking-[-1.5px]">Settings</h1>
        <p className="text-zinc-400 mt-2">Manage your account and preferences</p>
      </div>

      <div className="space-y-5">
        {/* GitHub Connection */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
          <h2 className="text-lg font-semibold mb-4">GitHub Connection</h2>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-emerald-400 text-sm font-medium">Connected ✓</div>
              <div className="text-sm text-zinc-400 mt-1">
                You can deploy from private repositories.
              </div>
            </div>
            <button
              onClick={handleReconnect}
              className="px-4 py-2 text-sm border border-zinc-700 hover:bg-zinc-800 rounded-xl transition"
            >
              Re-authorize
            </button>
          </div>
        </div>

        {/* Account Actions */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5">
          <h2 className="text-lg font-semibold mb-4">Account</h2>
          <div className="space-y-3">
            <button
              onClick={handleLogoutAll}
              className="w-full text-left px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl transition text-sm"
            >
              Log out from all devices
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div className="bg-zinc-900 border border-red-900/50 rounded-3xl p-5">
          <h2 className="text-lg font-semibold text-red-400 mb-2">Danger Zone</h2>
          <p className="text-sm text-zinc-400 mb-4">
            Permanently delete all your deployment history and records, and stop any of your services still running.
          </p>
          <button
            onClick={handleDeleteAllData}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-xl transition"
          >
            Delete All My Data
          </button>
        </div>
      </div>
    </div>
  );
}
