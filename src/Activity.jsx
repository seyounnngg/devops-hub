import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDeployments } from './api';

export default function Activity() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all | failed | running
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const data = await getDeployments();
        const sorted = data.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setActivities(sorted);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchActivities();
  }, []);

  const getStatusColor = (status) => {
    if (status === 'failed') return 'bg-red-500/10 text-red-400';
    if (status === 'running' || status === 'completed') return 'bg-emerald-500/10 text-emerald-400';
    return 'bg-amber-500/10 text-amber-400';
  };

  const getServiceLabel = (type) => {
    if (type === 'web') return 'Web';
    if (type === 'apk') return 'APK';
    return 'Other';
  };

  if (loading) {
    return <div className="p-8 text-zinc-400">Loading activity...</div>;
  }

  // Filtering logic - unique to Activity page
  const filteredActivities = activities
    .filter(a => {
      if (filter === 'failed') return a.status === 'failed';
      if (filter === 'running') return a.status === 'running' || a.status === 'completed';
      return true;
    })
    .filter(a => 
      a.project_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.service_type.toLowerCase().includes(searchTerm.toLowerCase())
    );

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Activity</h1>
          <p className="text-zinc-400 mt-1">Detailed history and logs of all deployments</p>
        </div>
      </div>

      {/* Filters and Search - makes Activity distinct from Dashboard */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="flex gap-2">
          {[
            { label: 'All', value: 'all' },
            { label: 'Failed', value: 'failed' },
            { label: 'Active', value: 'running' },
          ].map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-4 py-1.5 text-sm rounded-xl border transition ${
                filter === f.value 
                  ? 'bg-blue-600 text-white border-blue-600' 
                  : 'border-zinc-700 hover:bg-zinc-800'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Search by project or type..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:border-blue-500"
        />
      </div>

      {filteredActivities.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 text-center">
          <div className="text-5xl mb-4">📭</div>
          <h3 className="text-lg font-medium mb-2">No activity yet</h3>
          <p className="text-zinc-400">Start by creating your first deployment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredActivities.map((activity) => (
            <div
              key={activity.id}
              onClick={() => {
                localStorage.setItem('currentProject', activity.project_name);
                navigate('/detail');
              }}
              className="bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-3xl p-5 flex items-center justify-between cursor-pointer transition group"
            >
              <div className="flex items-center gap-4">
                <div className="text-xs px-2.5 py-1 bg-zinc-800 text-zinc-400 rounded-md">{getServiceLabel(activity.service_type)}</div>
                <div>
                  <div className="font-semibold tracking-tight">{activity.project_name}</div>
                  <div className="text-sm text-zinc-400 mt-0.5">
                    {new Date(activity.created_at).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className={`text-xs px-3 py-1 rounded-full font-medium ${getStatusColor(activity.status)}`}>
                  {activity.status}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    localStorage.setItem('currentProject', activity.project_name);
                    navigate('/detail');
                  }}
                  className="text-sm px-4 py-2 border border-zinc-700 hover:bg-zinc-800 rounded-2xl transition opacity-0 group-hover:opacity-100"
                >
                  View
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
